import { describe, expect, it } from "vitest";
import { Decimal } from "../src/index.ts";

// Guard for hard rule 7: the money library must not behave like floating point.
describe("decimal arithmetic", () => {
  it("adds 0.1 and 0.2 exactly", () => {
    expect(new Decimal("0.1").plus("0.2").equals("0.3")).toBe(true);
    expect(0.1 + 0.2 === 0.3).toBe(false);
  });

  it("divides settled by 0.90 exactly for the file 04 worked example", () => {
    expect(new Decimal("85500").div("0.90").equals("95000")).toBe(true);
  });
});
