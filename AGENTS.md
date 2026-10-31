# AGENTS.md – Oksy Data Cleanse portal (for Codex, Antigravity and other coding agents)

All rules, the reading order and the current-stage line live in `CLAUDE.md`. Read that file first — this file adds only what is specific to a non-Claude-Code coding agent.

**Current stage: Stage 2 approved 31-Oct-2026, built on branch `stage-2-rule-library` (not merged to `main`). 2a and 2b done 31-Oct-2026, 2c done 1-Nov-2026 (2a: rule engine as data, money rules rewritten; 2b: dictionary_entries replaces hard-coded status words/colours/names, hms-profile.ts retired; 2c: cross-row rules, two-part approval combining, value-is-correct confirmations). Migrations `20261031060500_rule_engine_data.sql`, `20261031070000_dictionary_entries.sql` and `20261101120000_claim_checks_two_part.sql` tested locally, waiting for Anoop's OK before live. Next: `/build-substage 2d`.**
(Kept here too only so this line stays in sync across tools, per `CLAUDE.md`'s closing checklist — the content of the line is defined in `CLAUDE.md`.)

## Agent-specific notes
- One tool (Claude Code, Codex or Antigravity) works on one file at a time; commit, then switch tools.
- The skills in `.claude/skills/` are written for Claude Code; a different agent follows the same steps by reading the `SKILL.md` files directly.
