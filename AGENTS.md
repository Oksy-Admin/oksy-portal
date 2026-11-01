# AGENTS.md – Oksy Data Cleanse portal (for Codex, Antigravity and other coding agents)

All rules, the reading order and the current-stage line live in `CLAUDE.md`. Read that file first — this file adds only what is specific to a non-Claude-Code coding agent.

**Current stage: see `CLAUDE.md`'s "Current stage" line — that is the one copy; this file no longer repeats it (1-Nov-2026 housekeeping, reduces drift and tokens).**

## Agent-specific notes
- One tool (Claude Code, Codex or Antigravity) works on one file at a time; commit, then switch tools.
- The skills in `.claude/skills/` are written for Claude Code; a different agent follows the same steps by reading the `SKILL.md` files directly.
