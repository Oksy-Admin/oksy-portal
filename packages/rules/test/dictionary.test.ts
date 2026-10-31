import { describe, expect, it } from "vitest";
import { guessColourMeaning, guessStage, isSimilarSpelling, newDictionarySuggestions } from "../src/index.ts";

// Stage 2b (decisions.md section 9, question 4 31-Oct): confirmed word applied (clean.test.ts
// covers the apply side); here, which new spellings get listed, and only once.
describe("newDictionarySuggestions", () => {
  it("STATUS_WORD: every new spelling is asked, even with no similar word", () => {
    const out = newDictionarySuggestions("STATUS_WORD", ["Paid", "paid", "Rejected"], [], (w) => guessStage(w) ?? "");
    expect(out.map((o) => o.spellingKey).sort()).toEqual(["paid", "rejected"]);
  });

  it("a spelling already in the table (any status) is never asked again", () => {
    const out = newDictionarySuggestions("INSURER", ["Star Health"], [{ spellingKey: "starhealth" }], (r) => r);
    expect(out).toEqual([]);
  });

  it("DOCTOR: a name with no similar spelling is kept as written, no question", () => {
    const out = newDictionarySuggestions("DOCTOR", ["Dr. Anoop"], [], (r) => r);
    expect(out).toEqual([]);
  });

  it("DOCTOR: a group of similar spellings is asked (the HMS Rajesh/Rajeesh case)", () => {
    const out = newDictionarySuggestions("DOCTOR", ["Dr. Rajesh", "Dr Rajeesh"], [], (r) => r);
    expect(out.map((o) => o.spellingRaw).sort()).toEqual(["Dr Rajeesh", "Dr. Rajesh"]);
  });

  it("DOCTOR: a new spelling similar to an already-known one is asked (tells them apart)", () => {
    const out = newDictionarySuggestions("DOCTOR", ["Dr Rajeesh"], [{ spellingKey: "drrajesh" }], (r) => r);
    expect(out.map((o) => o.spellingRaw)).toEqual(["Dr Rajeesh"]);
  });

  it("a spelling seen twice in one run is suggested only once", () => {
    const out = newDictionarySuggestions("TPA", ["Vidal", "vidal", "VIDAL"], [], (r) => r);
    expect(out).toHaveLength(1);
  });
});

describe("isSimilarSpelling", () => {
  it("a close typo is similar", () => expect(isSimilarSpelling("drrajesh", "drrajeesh")).toBe(true));
  it("unrelated names are not similar", () => expect(isSimilarSpelling("drrajesh", "drmohan")).toBe(false));
});

describe("guessStage", () => {
  it("guesses common words", () => {
    expect(guessStage("Fully Paid")).toBe("SETTLED");
    expect(guessStage("Claim Approved")).toBe("APPROVED");
    expect(guessStage("N/A")).toBe("NOT_WRITTEN");
  });
  it("returns null for a word it cannot guess", () => expect(guessStage("Xyzzy")).toBe(null));
});

describe("guessColourMeaning", () => {
  it("matches a legend label to a meaning", () => {
    expect(guessColourMeaning("Pre-Auth Initiated")).toBe("PREAUTH_INITIATED");
    expect(guessColourMeaning("Settled")).toBe("PAID");
  });
  it("returns null for an unrecognised label", () => expect(guessColourMeaning("Miscellaneous")).toBe(null));
});
