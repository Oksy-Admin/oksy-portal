// Rule Library "plain-words box" (stage-plan 2d, decisions.md section 9): the AI fills the
// rule form from one English sentence, a person checks, tests and saves -- the AI never
// saves. No claim or patient data is ever part of the prompt, only the sentence the user
// typed and the fixed field list below. Pure prompt-building and response-parsing; the
// actual Anthropic call is made by the caller (apps/web, where ANTHROPIC_API_KEY lives).
import type { ConditionOperator, RuleAction, SimpleCondition } from "./engine.ts";
import { RULE_FIELD_KEYS, RULE_FIELDS } from "./rule-fields.ts";

export interface RuleDraftSuggestion {
  title: string;
  severity: "E" | "W";
  action: RuleAction;
  logic: "AND" | "OR";
  conditions: SimpleCondition[];
  issueField: string;
  staffMessage: string;
  hospitalFilter: string | null;
  schemeFilter: string | null;
  insurerFilter: string | null;
}

const OPERATORS: ConditionOperator[] = [
  "EMPTY",
  "NOT_EMPTY",
  "EQUALS",
  "NOT_EQUALS",
  "GREATER_THAN",
  "LESS_THAN",
  "BEFORE",
  "AFTER",
  "DIFFERS_BY_MORE_THAN",
  "FLAG_TRUE",
  "FLAG_FALSE",
];

export const RULE_DRAFT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    severity: { type: "string", enum: ["E", "W"] },
    action: { type: "string", enum: ["AUTOMATIC", "AI_SUGGESTION", "ASK_STAFF"] },
    logic: { type: "string", enum: ["AND", "OR"] },
    conditions: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          field: { type: "string", enum: RULE_FIELD_KEYS },
          operator: { type: "string", enum: OPERATORS },
          compareField: { anyOf: [{ type: "string", enum: RULE_FIELD_KEYS }, { type: "null" }] },
          compareValue: { anyOf: [{ type: "string" }, { type: "number" }, { type: "null" }] },
          offsetDays: { anyOf: [{ type: "integer" }, { type: "null" }] },
          toleranceAmount: { anyOf: [{ type: "number" }, { type: "null" }] },
        },
        required: ["field", "operator", "compareField", "compareValue", "offsetDays", "toleranceAmount"],
        additionalProperties: false,
      },
    },
    issueField: { type: "string", enum: RULE_FIELD_KEYS },
    staffMessage: { type: "string" },
    hospitalFilter: { anyOf: [{ type: "string" }, { type: "null" }] },
    schemeFilter: { anyOf: [{ type: "string" }, { type: "null" }] },
    insurerFilter: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: ["title", "severity", "action", "logic", "conditions", "issueField", "staffMessage", "hospitalFilter", "schemeFilter", "insurerFilter"],
  additionalProperties: false,
} as const;

export function buildRuleDraftPrompt(sentence: string): string {
  return [
    "Draft one hospital-claims cleaning rule from the English sentence at the end. No patient",
    "data is included; use only the fields listed below. A person will check, test and save",
    "this draft themselves -- you only propose it.",
    "",
    "Fields you may use (field: meaning, type):",
    ...RULE_FIELD_KEYS.map((k) => `  ${k}: ${RULE_FIELDS[k]!.label} (${RULE_FIELDS[k]!.type})`),
    "",
    "Operators: EMPTY, NOT_EMPTY (no compared value), EQUALS, NOT_EQUALS, GREATER_THAN,",
    "LESS_THAN, BEFORE, AFTER, DIFFERS_BY_MORE_THAN (amounts; give toleranceAmount), FLAG_TRUE,",
    "FLAG_FALSE (no compared value, for the boolean fields).",
    "A condition compares one field with another field (compareField), a fixed number or ISO",
    "date (compareValue), or today plus/minus a number of days (compareValue \"TODAY\",",
    "offsetDays). Use at most 5 conditions, all AND or all OR, never mixed.",
    "issueField is which field the issue is shown against; usually the field the sentence is",
    "actually about.",
    'staffMessage is the plain-English text shown to hospital staff; "{field_name}" inserts',
    "that field's value, for example \"Approved amount is {approved_amount}.\"",
    "severity is E (Error, cannot be confirmed away) or W (Warning, can be confirmed",
    'correct). action is AUTOMATIC only for a plain data fix with no judgement; otherwise',
    "ASK_STAFF (never AI_SUGGESTION -- that lane is not offered by this form).",
    "hospitalFilter / schemeFilter / insurerFilter are null unless the sentence names one",
    "hospital, scheme or insurer specifically.",
    "",
    `Sentence: "${sentence.replace(/"/g, "'")}"`,
  ].join("\n");
}

/** The API call validates the shape against RULE_DRAFT_SCHEMA; this only parses the JSON text. */
export function parseRuleDraftResponse(text: string): RuleDraftSuggestion {
  return JSON.parse(text) as RuleDraftSuggestion;
}
