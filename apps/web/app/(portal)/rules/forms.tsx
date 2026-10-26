"use client";

import { useActionState } from "react";
import { approveRuleVersion } from "./actions";

export function ApproveRuleForm(props: {
  ruleVersionId: string;
  ruleId: string;
  canApprove: boolean;
}) {
  const [state, action, pending] = useActionState(approveRuleVersion, null);

  if (!props.canApprove) {
    return (
      <button className="btn btn-sm" disabled title="Only ADMIN or APPROVER can approve or activate (G9)">
        Activate (G9)
      </button>
    );
  }

  return (
    <form action={action} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <input type="hidden" name="rule_version_id" value={props.ruleVersionId} />
      <input type="hidden" name="rule_id" value={props.ruleId} />
      <input type="hidden" name="activate" value="true" />
      <button type="submit" className="btn btn-sm" disabled={pending} title="Approve and activate this rule (G9)">
        {pending ? "Activating…" : "Activate (G9)"}
      </button>
      {state && (
        <span
          role={state.ok ? "status" : "alert"}
          style={{ fontSize: "0.85rem", color: state.ok ? "var(--color-green, #16a34a)" : "var(--color-red, #dc2626)" }}
        >
          {state.message}
        </span>
      )}
    </form>
  );
}
