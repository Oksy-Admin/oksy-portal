---
name: plan-stage
description: Plan a whole stage (all its sub-stages) in one report for Anoop's single approval. Use at the start of a stage, e.g. /plan-stage 2.
---

# Plan a whole stage

1. Read `handoff.md`, `claude/decisions.md`, the stage's section of `claude/stage-plan.md`, and only the parts of `claude/requirements.md` the stage needs. Do not re-read files already in context.
2. Look at the existing code and migrations the stage touches (search, read only what is needed). Improve, do not rebuild.
3. Write the plan into the stage's section of `claude/stage-plan.md`: sub-stages in build order, for each one: what changes, files/tables touched, migrations (name + one-line purpose), tests, done-criteria, prompt budget (target: 1 prompt per sub-stage + 1 fix reserve).
4. **Design review (mandatory):** run the `design-reviewer` agent on the draft plan. Apply every "Must" finding to the plan; list "Should" findings for Anoop with a recommendation.
5. List decisions that are missing AND change what gets built: max 5, each with reason + recommendation, yes/no. Never ask what `decisions.md` already answers.
6. Commit the plan (`docs: plan Stage N`). Report to Anoop in Malayalam, short: sub-stages table, migrations to expect, design-review result (one line per finding), questions. Wait for approval.
