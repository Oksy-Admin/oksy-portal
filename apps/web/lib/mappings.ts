// Column Mappings helpers shared by the page and its tests (no server imports).
import { IGNORE_FIELD } from "@oksy/rules/fields";

/** What the Status column shows for a stored row. Read from the saved row, never the dropdown. */
export type MappingStatusLabel = "Ignored" | "APPROVED" | "PROPOSED" | "RETIRED";

export function mappingStatusLabel(row: { status: string; canonical_field: string | null }): MappingStatusLabel {
  if (row.status === "APPROVED" && row.canonical_field === IGNORE_FIELD) return "Ignored";
  if (row.status === "APPROVED" || row.status === "PROPOSED" || row.status === "RETIRED") return row.status;
  return "PROPOSED";
}

/**
 * A dropdown choice that is a decision on its own and is saved at once (Item 1, 27-Oct-2026):
 * Ignore. Before, Ignore only changed the dropdown (and faded the row), so after a page
 * refresh the column was back to "not decided yet". Other choices still wait for Approve.
 */
export function savesAtOnce(choice: string): boolean {
  return choice === IGNORE_FIELD;
}

/**
 * Applies a dropdown choice: Ignore is saved on the server through save (the approve
 * action), anything else only changes the page until Approve is pressed.
 */
export async function applyChoice(
  id: string,
  choice: string,
  save: (id: string, field: string | null) => Promise<{ ok: boolean; error?: string }>,
): Promise<{ saved: boolean; ok: boolean; error?: string }> {
  if (!savesAtOnce(choice)) return { saved: false, ok: true };
  const res = await save(id, choice);
  return { saved: res.ok, ok: res.ok, error: res.error };
}
