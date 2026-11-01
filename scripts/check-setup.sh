#!/usr/bin/env bash
# Setup check: is every row of claude/setup-checklist.md actually wired up?
# Read only. No Claude, no network, no secrets printed.
# Run from anywhere inside the repo:  bash scripts/check-setup.sh
# Prints PASS/FAIL per row; exits 1 if any row FAILs.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

fail=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; fail=1; }
check_file() { [[ -f "$1" ]]; }

# 1. settings.json deny list
settings=".claude/settings.json"
if check_file "$settings" \
  && grep -q 'rm -rf' "$settings" \
  && grep -q 'git push' "$settings"; then
  pass "settings.json deny list blocks rm -rf and git push"
else
  fail "settings.json deny list missing rm -rf and/or git push"
fi

# 2. Stop hook present
if check_file "$settings" && grep -q '"Stop"' "$settings"; then
  pass "Stop hook configured in settings.json"
else
  fail "Stop hook not found in settings.json"
fi

# 3. Both review agents exist
if check_file ".claude/agents/design-reviewer.md" && check_file ".claude/agents/code-reviewer.md"; then
  pass "design-reviewer and code-reviewer agents exist"
else
  fail "one or both of design-reviewer.md / code-reviewer.md missing"
fi

# 4. /build-substage mentions scope-lock
if check_file ".claude/skills/build-substage/SKILL.md" && grep -qi 'scope-lock' ".claude/skills/build-substage/SKILL.md"; then
  pass "/build-substage mentions scope-lock"
else
  fail "/build-substage does not mention scope-lock"
fi

# 5. /close-substage mentions advisors and "Anoop must do now"
close_skill=".claude/skills/close-substage/SKILL.md"
if check_file "$close_skill" \
  && grep -qi 'advisors' "$close_skill" \
  && grep -q 'Anoop must do now' "$close_skill"; then
  pass "/close-substage mentions advisors and the Anoop-must-do-now block"
else
  fail "/close-substage missing the advisors check and/or the Anoop-must-do-now block"
fi

# 6. .mcp.json has supabase and context7
if check_file ".mcp.json" && grep -q '"supabase"' ".mcp.json" && grep -q '"context7"' ".mcp.json"; then
  pass ".mcp.json has supabase and context7"
else
  fail ".mcp.json missing supabase and/or context7"
fi

# 7. .husky/pre-commit runs the secret scan
if check_file ".husky/pre-commit" && grep -q 'secret-scan' ".husky/pre-commit"; then
  pass ".husky/pre-commit runs the secret scan"
else
  fail ".husky/pre-commit does not run the secret scan"
fi

# 8. claude/my-tasks.md exists
if check_file "claude/my-tasks.md"; then
  pass "claude/my-tasks.md exists"
else
  fail "claude/my-tasks.md is missing"
fi

# 9. Vercel deploy-hook Action exists on main (it only runs from there; a feature
#    branch legitimately doesn't carry it yet, so check main's git history, not
#    the current working tree).
if check_file ".github/workflows/vercel-deploy-hook.yml" \
  || git show main:.github/workflows/vercel-deploy-hook.yml >/dev/null 2>&1; then
  pass ".github/workflows/vercel-deploy-hook.yml exists (working tree or main)"
else
  fail ".github/workflows/vercel-deploy-hook.yml is missing from both the working tree and main"
fi

# 10. apps/web/vercel.json does not have deploymentEnabled: false
vj="apps/web/vercel.json"
if check_file "$vj" && grep -Eq '"deploymentEnabled"[[:space:]]*:[[:space:]]*false' "$vj"; then
  fail "apps/web/vercel.json has deploymentEnabled: false (blocks Vercel auto-deploy)"
elif check_file "$vj"; then
  pass "apps/web/vercel.json does not block Git deployments"
else
  fail "apps/web/vercel.json is missing"
fi

# 11. Session-start files (handoff.md, claude/my-tasks.md, CLAUDE.md) stay small together
total_bytes=0
missing=0
for f in handoff.md claude/my-tasks.md CLAUDE.md; do
  if check_file "$f"; then
    total_bytes=$((total_bytes + $(wc -c < "$f")))
  else
    missing=1
  fi
done
limit_bytes=$((25 * 1024))
if [[ $missing -eq 1 ]]; then
  fail "session-start files: one of handoff.md / claude/my-tasks.md / CLAUDE.md is missing"
elif [[ $total_bytes -le $limit_bytes ]]; then
  pass "session-start files (handoff.md + my-tasks.md + CLAUDE.md) = ${total_bytes} bytes, under 25 KB"
else
  fail "session-start files = ${total_bytes} bytes, over the 25 KB target"
fi

printf '\n'
if [[ $fail -eq 0 ]]; then
  printf 'check-setup: all rows PASS\n'
else
  printf 'check-setup: at least one FAIL above\n'
fi
exit $fail
