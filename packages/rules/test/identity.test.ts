import { describe, expect, it } from "vitest";
import { openKeyOf, recordKeyFor, type HospitalProfile } from "../src/index.ts";

// Claim identity (decision section 7, 30-Oct night). Invented claim numbers and names only.
const p = { hospitalCode: "HOSPTEST0001", scheme: "PRIVATE" } as HospitalProfile;

describe("claim identity: claim number + admission date + discharge date", () => {
  it("the same claim number with other dates is another claim", () => {
    const a = recordKeyFor(p, "fake 001", "Fake Patient", "2026-10-01", "2026-10-04");
    const b = recordKeyFor(p, "FAKE001", "Fake Patient", "2026-10-01", "2026-10-04");
    const c = recordKeyFor(p, "FAKE001", "Fake Patient", "2026-10-20", "2026-10-22");
    expect(a).toEqual({ key: "HOSPTEST0001|PRIVATE|C:FAKE001|2026-10-01|2026-10-04", type: "CLAIM_NO" });
    expect(b.key).toBe(a.key); // spacing and case of the claim number do not matter
    expect(c.key).not.toBe(a.key);
  });

  it("still in hospital: the discharge date is '-' until known; the open key finds the same claim", () => {
    const open = recordKeyFor(p, "FAKE002", "Fake Patient", "2026-10-01", null);
    const done = recordKeyFor(p, "FAKE002", "Fake Patient", "2026-10-01", "2026-10-06");
    expect(open.key).toBe("HOSPTEST0001|PRIVATE|C:FAKE002|2026-10-01|-");
    expect(openKeyOf(done.key!)).toBe(open.key);
    expect(openKeyOf(open.key!)).toBeNull();
  });

  it("without a claim number: patient name + admission date (FALLBACK); never an open key", () => {
    const f = recordKeyFor(p, null, "Fake  Patient", "2026-10-01", "2026-10-03");
    expect(f.type).toBe("FALLBACK");
    expect(openKeyOf(f.key!)).toBeNull();
    expect(recordKeyFor(p, null, "Fake Patient", null).key).toBeNull();
  });

  it("the scheme is part of the key (one hospital, two schemes, two claims)", () => {
    const kasp = recordKeyFor({ ...p, scheme: "KASP" } as HospitalProfile, "FAKE003", null, "2026-10-01", "2026-10-02");
    expect(kasp.key).toBe("HOSPTEST0001|KASP|C:FAKE003|2026-10-01|2026-10-02");
  });
});
