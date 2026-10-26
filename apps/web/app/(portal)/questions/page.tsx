import { can } from "@/lib/roles";
import { getMe } from "@/lib/supabase/server";
import { EmptyTable, NoAccess, NotBuilt, PageHead } from "../ui";
import { withTiming } from "@/lib/timing";

// Questions (module D). Question Sheets are written automatically after the daily run (D-041);
// message drafts are copied and sent by helper staff by hand (G4); the portal never sends them.
async function QuestionsPage() {
  const me = await getMe();
  if (!can(me?.role, "helper_work")) return <NoAccess title="Questions" who="HELPER, APPROVER or ADMIN" />;

  return (
    <>
      <PageHead title="Questions" subtitle="Question Sheet status per hospital and reminder drafts for helper staff." />
      <NotBuilt milestone="M8">
        Each hospital gets one Question Sheet (tabs HOW TO ANSWER, SETUP QUESTIONS, ROW FIXES, HISTORY), at most 25
        questions shown, the rest queued. It is shared only with the named Google accounts of the hospital&apos;s desk
        team.
      </NotBuilt>
      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 3fr) minmax(0, 1fr)", alignItems: "start" }}>
        <div>
          <div className="filters">
            <label>
              Hospital
              <select disabled>
                <option>All hospitals</option>
              </select>
            </label>
            <label>
              Question type
              <select disabled>
                <option>All types</option>
              </select>
            </label>
            <label style={{ flex: 1 }}>
              Search
              <input disabled placeholder="Search hospital name" />
            </label>
          </div>
          <EmptyTable
            columns={["#", "Hospital", "Setup Qs", "Row fixes", "Queued", "Answered", "Cannot find it", "Oldest open (working days)"]}
            message="No Question Sheets yet."
          />
        </div>
        <div className="stack">
          <div className="card">
            <h2>Question types</h2>
            <span className="pill tone-blue">SETUP QUESTIONS</span>{" "}
            <span className="pill tone-amber">ROW FIXES</span>
          </div>
          <div className="card">
            <h2>Reminder draft (WhatsApp / email)</h2>
            <p className="muted" style={{ margin: 0 }}>
              Helper staff copy the draft and send it themselves. The system never sends messages.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

export default withTiming("/questions", QuestionsPage);
