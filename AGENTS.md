# AGENTS.md – Oksy Data Cleanse portal (for Codex, Antigravity and other coding agents)

All rules, the reading order and the current-stage line live in `CLAUDE.md`. Read that file first — this file adds only what is specific to a non-Claude-Code coding agent.

**Current stage: Stage 2 approved 31-Oct-2026, built on branch `stage-2-rule-library` (not merged to `main`). 2a and 2b done 31-Oct-2026, 2c, 2d and 2e done 1-Nov-2026 (2a: rule engine as data, money rules rewritten; 2b: dictionary_entries replaces hard-coded status words/colours/names, hms-profile.ts retired; 2c: cross-row rules, two-part approval combining, value-is-correct confirmations; 2d: Rule Library page rewritten — 3-part form, plain-words box, save-time conflict check, test before save, CSV/Excel upload; 2e: rule trial (Run Trial job, per-rule summary, Owner/Admin approval) and check sets (pick up to 5 claims per hospital, live pass/fail, Accept new values)). The four earlier migrations (`20261031060500_rule_engine_data.sql`, `20261031070000_dictionary_entries.sql`, `20261101120000_claim_checks_two_part.sql`, `20261101130000_rule_library_page.sql`) are applied to live by Anoop, 1-Nov-2026; the 2e migration (`20261101140000_rule_trials_check_sets.sql`) is tested locally, waiting for his OK before live. Next: `/build-substage 2f`.**
(Kept here too only so this line stays in sync across tools, per `CLAUDE.md`'s closing checklist — the content of the line is defined in `CLAUDE.md`.)

## Agent-specific notes
- One tool (Claude Code, Codex or Antigravity) works on one file at a time; commit, then switch tools.
- The skills in `.claude/skills/` are written for Claude Code; a different agent follows the same steps by reading the `SKILL.md` files directly.
