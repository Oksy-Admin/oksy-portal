// Dev only (Playwright, Stage 1c): the Hospitals table with invented rows, to check the
// upload preview. Not built into production: notFound() outside `next dev`. Saving goes
// through the real server action, which refuses because nobody is logged in.
import { notFound } from "next/navigation";
import { HospitalTable, type HospitalRowData } from "../../(portal)/hospitals/hospital-table";

const rows: HospitalRowData[] = [
  {
    hospital_key: "00000000-0000-0000-0000-00000000d001",
    hospital_code: "HOSPTEST0001",
    hospital_name: "Test Hospital One (fixture)",
    district: "TESTDISTRICT",
    status: "ACTIVE",
    other_names: [],
    question_sheet_url: null,
    schemes: [],
  },
];

export default function HospitalsPreview() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <main style={{ padding: 24 }}>
      <h1>Hospitals preview (dev only, invented rows)</h1>
      <HospitalTable initialRows={rows} canEdit />
    </main>
  );
}
