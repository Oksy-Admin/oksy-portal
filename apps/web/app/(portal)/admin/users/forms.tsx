"use client";

import { useActionState } from "react";
import { ROLES } from "@/lib/roles";
import { retireUser, setUserRole } from "./actions";

export function UserRoleForm() {
  const [state, action, pending] = useActionState(setUserRole, null);
  return (
    <form action={action}>
      <fieldset disabled={pending}>
        <legend>Add a person or change a role</legend>
        <input name="email" type="email" placeholder="name@oksy.in" required />{" "}
        <input name="display_name" placeholder="Name (optional)" />{" "}
        <select name="role" defaultValue="HELPER">
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>{" "}
        <button type="submit" className="btn">
          Save
        </button>
      </fieldset>
      {state && <p role="status">{state.message}</p>}
    </form>
  );
}

export function RetireButton({ email }: { email: string }) {
  const [state, action, pending] = useActionState(retireUser, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Retire ${email}? They lose access now; the record is kept.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="email" value={email} />
      <button type="submit" className="btn secondary" disabled={pending}>
        Retire
      </button>
      {state && !state.ok && <span role="alert"> {state.message}</span>}
    </form>
  );
}
