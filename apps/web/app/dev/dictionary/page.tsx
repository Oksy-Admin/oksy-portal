// Dev only (Playwright, Stage 2b): the Words & Names table with fake data (no patient data,
// no real spreadsheet read). Not built into production: notFound() outside `next dev`.
// Saving here goes through the real server actions, which refuse because nobody is logged in.
import { notFound } from "next/navigation";
import { dictionaryItems, type StoredBatch, type StoredEntry } from "@/lib/dictionary";
import { DictionaryTable } from "../../(portal)/dictionary/dictionary-table";

const entries: StoredEntry[] = [
  // HMS confirmed "paid" (the 25-Oct answers, moved to data by the Stage 2b migration).
  { id: "e1", kind: "STATUS_WORD", scheme: "PRIVATE", hospital_code: "HOSPPVTP0003", spelling_key: "paid", spelling_raw: "PAID", standard_value: "SETTLED", status: "CONFIRMED", evidence: { source: "25-Oct hospital answers" }, reason: null, decided_at: "2026-10-31T05:00:00Z" },
  // Badagara (fixture, a new hospital of the same scheme): pre-filled, needs one click.
  { id: "e2", kind: "STATUS_WORD", scheme: "PRIVATE", hospital_code: "HOSPPVTP0001", spelling_key: "paid", spelling_raw: "Paid", standard_value: "SETTLED", status: "SUGGESTED", evidence: { source: "pre-filled from HOSPPVTP0003 (same scheme)" }, reason: null, decided_at: null },
  // A genuinely new word, seen twice this run, with no cross-hospital match yet.
  { id: "e3", kind: "STATUS_WORD", scheme: "PRIVATE", hospital_code: "HOSPPVTP0001", spelling_key: "inprocess", spelling_raw: "In Process", standard_value: "UNDER_PROCESSING", status: "SUGGESTED", evidence: { count: 2, tabs: ["OCT 2026"] }, reason: null, decided_at: null },
  // A doctor-name spelling group (the HMS Rajesh / Rajeesh case).
  { id: "e4", kind: "DOCTOR", scheme: "PRIVATE", hospital_code: "HOSPPVTP0003", spelling_key: "drrajeesh", spelling_raw: "Dr Rajeesh", standard_value: "Dr. Rajesh", status: "SUGGESTED", evidence: { count: 1, tabs: ["PAID"] }, reason: null, decided_at: null },
  // Rejected: not a real insurer spelling.
  { id: "e5", kind: "INSURER", scheme: "PRIVATE", hospital_code: null, spelling_key: "testco", spelling_raw: "Test Co", standard_value: "Test Co", status: "REJECTED", evidence: null, reason: "not a real insurer", decided_at: "2026-10-31T05:00:00Z" },
];
const batches: StoredBatch[] = [
  { id: "00000000-0000-0000-0000-000000000000", kind: "STATUS_WORD", scheme: "PRIVATE", hospital_code: "HOSPPVTP0002", item_count: 4, created_at: "2026-10-31T05:00:00Z", undone_at: null },
];

export default function DictionaryPreview() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <main style={{ padding: 24 }}>
      <h1>Words &amp; Names preview (dev only, fixture data)</h1>
      <DictionaryTable
        items={dictionaryItems(entries)}
        batches={batches}
        hospitalNames={{ HOSPPVTP0001: "Badagara (fixture)", HOSPPVTP0002: "Tree G (fixture)", HOSPPVTP0003: "HMS (fixture)" }}
        canBulk
      />
    </main>
  );
}
