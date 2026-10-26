"use client";

import { useActionState } from "react";
import { setTabPolicy } from "./actions";

export function TabPolicyForm(props: { spreadsheetId: string; tabName: string; policy: string; kind: string | null }) {
  const [state, action, pending] = useActionState(setTabPolicy, null);
  return (
    <form action={action} style={{ display: "inline" }}>
      <input type="hidden" name="spreadsheet_id" value={props.spreadsheetId} />
      <input type="hidden" name="tab_name" value={props.tabName} />
      <select name="policy" defaultValue={props.policy} disabled={pending}>
        <option value="REVIEW">REVIEW</option>
        <option value="ALLOW">ALLOW</option>
        <option value="DENY">DENY</option>
      </select>{" "}
      <select name="kind" defaultValue={props.kind ?? ""} disabled={pending}>
        <option value="">(kind)</option>
        <option value="DATA">DATA</option>
        <option value="LOOKUP">LOOKUP</option>
        <option value="LEGEND">LEGEND</option>
        <option value="EXCLUDED">EXCLUDED</option>
      </select>{" "}
      <input name="note" placeholder="Note (optional)" disabled={pending} />{" "}
      <button type="submit" className="btn" disabled={pending}>
        Save
      </button>
      {state && <span role={state.ok ? "status" : "alert"}> {state.message}</span>}
    </form>
  );
}
