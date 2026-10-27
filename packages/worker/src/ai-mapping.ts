// AI column mapping (requirements v2 section 5, Stage 3). The alias list maps the usual
// headers; the AI is asked only about the columns it could not map, for example a damaged
// header (the TPA header replaced by a TPA name, #VALUE! in the TDS header). It sees the
// header texts, their positions and neighbours, and the SHAPE of each column (how many
// cells look like dates, numbers, text or formula errors). It never sees a cell value, so
// no patient data leaves the portal, and it cannot guess or change a UTR, date or amount:
// it only proposes which field a column is. Every suggestion is stored as PROPOSED with
// confidence below 1 and is used only after a person confirms the mapping.
import Anthropic from "@anthropic-ai/sdk";
import { CANONICAL_FIELDS, isBlank, type CanonicalField, type ColumnMap } from "@oksy/rules";
import type { RawTab, TabLayout } from "./sheet-data.ts";

export const AI_MODEL = "claude-opus-5-5";
/** The AI never gives a confirmed-looking score; a person confirms. */
export const AI_MAX_CONFIDENCE = 0.8;

const FIELD_HELP: Record<CanonicalField, string> = {
  serial_no: "row serial number",
  patient_name: "patient name",
  patient_ip_no: "IP number, UHID or MRD number",
  policy_or_card_no: "policy or insurance card number",
  preauth_or_claim_no: "pre-authorisation or claim number",
  insurer_name: "insurance company",
  tpa_name: "TPA (third party administrator)",
  admission_date: "date of admission",
  discharge_date: "date of discharge",
  treatment_or_surgery: "treatment, procedure or diagnosis",
  department: "department or speciality",
  doctor_name: "treating doctor",
  room_no: "room or bed number or room category",
  bill_amount: "final hospital bill amount",
  claimed_amount: "amount claimed from the insurer",
  approved_amount: "final approved amount",
  copay_amount: "co-pay amount",
  deduction_amount: "deduction amount",
  discount_amount: "hospital discount",
  casesheet_sent_date: "hard copy (case sheet) sent date",
  courier_no: "POD or courier number",
  followup_log: "follow-up date or remarks",
  status_text: "claim status words",
  rejection_reason: "rejection reason",
  cancellation_reason: "cancellation reason",
  payment_date: "settlement (payment) date",
  payment_amount: "settled (paid) amount",
  payment_utr: "UTR or NEFT reference of the payment",
  tds_amount_stated: "TDS amount",
  remarks: "general remarks",
};

export interface ColumnShape {
  column: number;
  header: string;
  left: string;
  right: string;
  filled: number;
  dates: number;
  numbers: number;
  text: number;
  errors: number;
}

const DATE_LIKE = /^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$|^\d{1,2}[\s-][A-Za-z]{3,9}[\s-]\d{2,4}$/;
const ERROR = /^#(VALUE|REF|N\/A|DIV\/0|NAME|NUM|NULL)[!?]?/i;

/** Shape of each column from the rows under the header: counts only, never a value. */
export function columnShapes(layout: TabLayout, probe: RawTab): ColumnShape[] {
  const below = layout.headerRow === null ? [] : probe.rows.slice(layout.headerRow + 1);
  return layout.map.map((m) => {
    const s: ColumnShape = {
      column: m.column,
      header: m.header,
      left: layout.headers[m.column - 1] ?? "",
      right: layout.headers[m.column + 1] ?? "",
      filled: 0,
      dates: 0,
      numbers: 0,
      text: 0,
      errors: 0,
    };
    for (const row of below) {
      const [text, num] = row[m.column] ?? [null, null];
      if (isBlank({ text, number: num })) continue;
      s.filled++;
      const t = (text ?? "").trim();
      if (ERROR.test(t)) s.errors++;
      else if (DATE_LIKE.test(t)) s.dates++;
      else if (num !== null || /^[\d,.\s₹/-]+$/.test(t)) s.numbers++;
      else s.text++;
    }
    return s;
  });
}

export interface AiSuggestion {
  column: number;
  field: string | null;
  confidence: number;
  reason: string;
}

/**
 * Keeps only safe suggestions: a column the alias list left unmapped, a known field that no
 * other column already has, confidence capped. Everything else stays unmapped (extra_fields).
 */
export function mergeSuggestions(map: ColumnMap[], suggestions: AiSuggestion[]): ColumnMap[] {
  const used = new Set(map.flatMap((m) => (m.field ? [m.field] : [])));
  const open = new Set(map.filter((m) => m.method === "UNMATCHED").map((m) => m.column));
  const out = map.map((m) => ({ ...m }));
  for (const s of suggestions) {
    if (!open.has(s.column) || !s.field) continue;
    if (!(CANONICAL_FIELDS as readonly string[]).includes(s.field)) continue;
    const field = s.field as CanonicalField;
    if (used.has(field)) continue;
    const target = out.find((m) => m.column === s.column)!;
    target.field = field;
    target.method = "AI";
    target.confidence = Math.max(0, Math.min(AI_MAX_CONFIDENCE, Number(s.confidence) || 0));
    used.add(field);
    open.delete(s.column);
  }
  return out;
}

const SCHEMA = {
  type: "object",
  properties: {
    columns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          column: { type: "integer" },
          field: { anyOf: [{ type: "string", enum: [...CANONICAL_FIELDS] }, { type: "null" }] },
          confidence: { type: "number" },
          reason: { type: "string" },
        },
        required: ["column", "field", "confidence", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["columns"],
  additionalProperties: false,
} as const;

export function buildPrompt(layout: TabLayout, shapes: ColumnShape[]): string {
  const open = new Set(layout.map.filter((m) => m.method === "UNMATCHED").map((m) => m.column));
  const mapped = layout.map.filter((m) => m.field).map((m) => `  column ${m.column}: "${m.header}" = ${m.field}`);
  const ask = shapes
    .filter((s) => open.has(s.column))
    .map(
      (s) =>
        `  column ${s.column}: header "${s.header}" (left "${s.left}", right "${s.right}"); ` +
        `${s.filled} filled cells: ${s.dates} date-like, ${s.numbers} numbers, ${s.text} text, ${s.errors} formula errors`,
    );
  return [
    "A Kerala hospital keeps its private health insurance claims in a Google Sheet, one row per claim.",
    "Some header cells are damaged (for example a TPA name typed over the TPA header, or #VALUE! in the TDS header).",
    "Map each unmapped column below to one field, using its header, its position, its neighbours and the shape of its cells.",
    "Use null when the column is none of the fields (for example length of stay or settlement delay, which the portal calculates itself).",
    "Use each field at most once and never a field that is already mapped. Confidence is 0 to 1.",
    "",
    "Fields:",
    ...CANONICAL_FIELDS.map((f) => `  ${f}: ${FIELD_HELP[f]}`),
    "",
    "Already mapped:",
    ...(mapped.length ? mapped : ["  (none)"]),
    "",
    "Unmapped columns:",
    ...ask,
  ].join("\n");
}

/** Calls Claude for one layout; returns the alias map unchanged if there is nothing to ask. */
export async function suggestWithClaude(layout: TabLayout, probe: RawTab, client: Anthropic = new Anthropic()): Promise<ColumnMap[]> {
  const shapes = columnShapes(layout, probe);
  const worthAsking = shapes.filter((s) => layout.map[s.column]?.method === "UNMATCHED" && (s.header !== "" || s.filled > 0));
  if (worthAsking.length === 0) return layout.map;

  const response = await client.beta.messages.create({
    model: AI_MODEL,
    max_tokens: 4096,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: buildPrompt(layout, shapes) }],
  });
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return layout.map;
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const parsed = JSON.parse(text) as { columns: AiSuggestion[] };
  return mergeSuggestions(layout.map, parsed.columns ?? []);
}

/**
 * The worker's suggest function: Claude when ANTHROPIC_API_KEY is set, otherwise the alias
 * list only. A failed AI call never stops a run; the layout is then proposed without it.
 */
export function suggestFromEnv(): ((layout: TabLayout, probe: RawTab) => Promise<ColumnMap[]>) | undefined {
  if (!process.env.ANTHROPIC_API_KEY) return undefined;
  const client = new Anthropic();
  return async (layout, probe) => {
    try {
      return await suggestWithClaude(layout, probe, client);
    } catch (e) {
      console.error(`AI mapping skipped for tab ${layout.tab}: ${e instanceof Error ? e.name : "error"}`);
      return layout.map;
    }
  };
}
