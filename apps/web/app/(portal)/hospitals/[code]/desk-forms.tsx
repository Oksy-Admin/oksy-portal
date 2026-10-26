"use client";

import { useActionState } from "react";
import { addDeskAccount, removeDeskAccount } from "./actions";

export function AddDeskAccount({ hospitalCode }: { hospitalCode: string }) {
  const [state, action, pending] = useActionState(addDeskAccount, null);
  return (
    <form action={action} className="filters" style={{ marginBottom: 0 }}>
      <input type="hidden" name="hospital_code" value={hospitalCode} />
      <label style={{ flex: 1 }}>
        Desk Google account
        <input name="email" type="email" placeholder="name@gmail.com" required disabled={pending} />
      </label>
      <button className="btn" type="submit" disabled={pending}>
        Add
      </button>
      {state && <span role={state.ok ? "status" : "alert"}>{state.message}</span>}
    </form>
  );
}

export function RemoveDeskAccount({ id, hospitalCode, email }: { id: string; hospitalCode: string; email: string }) {
  const [state, action, pending] = useActionState(removeDeskAccount, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Remove ${email} from this hospital's desk accounts? The record is kept.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="hospital_code" value={hospitalCode} />
      <button className="btn secondary" type="submit" disabled={pending}>
        Remove
      </button>
      {state && !state.ok && <span role="alert"> {state.message}</span>}
    </form>
  );
}
