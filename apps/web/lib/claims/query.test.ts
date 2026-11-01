import { describe, expect, it } from "vitest";
import { cleanFilters } from "./query";

describe("cleanFilters hospital code", () => {
  it("accepts a real pilot hospital code", () => {
    expect(cleanFilters({ hospital: "HOSPPVTP0001" }).hospital).toBe("HOSPPVTP0001");
  });

  it("rejects an empty string", () => {
    expect(cleanFilters({ hospital: "" }).hospital).toBe("");
  });

  it("rejects a short junk value", () => {
    expect(cleanFilters({ hospital: "x" }).hospital).toBe("");
  });

  it("rejects a value with SQL-looking input", () => {
    expect(cleanFilters({ hospital: "HOSPPVTP0001; drop" }).hospital).toBe("");
  });
});
