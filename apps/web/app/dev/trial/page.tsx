// Dev only (Playwright, Stage 2e): the Rule trial / check-set panel with fake data (no patient
// data, no real Supabase read). Not built into production: notFound() outside `next dev`. Every
// run, approve, pick or accept here goes through the real server actions, which refuse because
// nobody is logged in -- the same pattern as /dev/rules and /dev/dictionary.
import { notFound } from "next/navigation";
import type { CheckSetRow } from "../../(portal)/hospitals/[code]/trial/actions";
import { TrialPanel } from "../../(portal)/hospitals/[code]/trial/trial-panel";

const checkSets: CheckSetRow[] = [
  {
    id: "cs1",
    recordUid: "fixture-1",
    claimNumber: "CL1001",
    pickedAt: "2026-10-28T00:00:00Z",
    pass: true,
    changedFields: [],
    openIssues: [],
  },
  {
    id: "cs2",
    recordUid: "fixture-2",
    claimNumber: "CL1002",
    pickedAt: "2026-10-28T00:00:00Z",
    pass: false,
    changedFields: ["settled_amount"],
    openIssues: [{ ruleId: "R-A05", severity: "E" }],
  },
];

export default function TrialPreview() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <main style={{ padding: 24 }}>
      <h1>Rule trial preview (dev only, fixture data)</h1>
      <TrialPanel hospitalCode="HOSPPVTP0001" canRunTrial canApprove initialCheckSets={checkSets} />
    </main>
  );
}
