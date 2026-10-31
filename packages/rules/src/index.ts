// Rule engine and money helper. Built in M5, tests first (CLAUDE.md "Working method").
// All money uses Decimal, never JavaScript numbers (hard rule 7).
import Decimal from "decimal.js";

export { Decimal };
export * from "./money.ts";
export * from "./selection.ts";
export * from "./normalise.ts";
export * from "./mapping.ts";
export * from "./decisions.ts";
export * from "./clean.ts";
export * from "./tabs.ts";
export * from "./engine.ts";
export * from "./initial-rules.ts";
export * from "./dictionary.ts";
