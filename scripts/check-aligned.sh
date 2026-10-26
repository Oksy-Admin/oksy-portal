#!/usr/bin/env bash
# Alignment check: is this Mac folder the same as GitHub, Supabase and Vercel?
# Read only. Logs in to nothing, deploys nothing, prints no secret values.
# Run from anywhere inside the repo:  bash scripts/check-aligned.sh
# Optional: --no-remote skips GitHub fetch, Supabase and Vercel (offline check).
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

no_remote=0
[[ "${1:-}" == "--no-remote" ]] && no_remote=1

section() { printf '\n== %s ==\n' "$1"; }

section "Mac folder and GitHub"
echo "branch: $(git branch --show-current)"
if [[ $no_remote -eq 1 ]]; then
  echo "git fetch skipped (--no-remote): GitHub numbers below may be old"
elif GIT_SSH_COMMAND="ssh -o BatchMode=yes" git fetch origin --prune --quiet; then
  echo "git fetch origin: ok"
else
  echo "git fetch origin: FAILED (no network, or the SSH key is not loaded). GitHub numbers below may be old."
fi
git status -sb
echo "commits on this Mac, not on GitHub (git log origin/main..main):"
git log --oneline origin/main..main | sed 's/^/  /'
echo "  total: $(git rev-list --count origin/main..main)"
echo "commits on GitHub, not on this Mac (git log main..origin/main):"
git log --oneline main..origin/main | sed 's/^/  /'
echo "  total: $(git rev-list --count main..origin/main)"
echo "other branches on GitHub:"
git branch -r | grep -v -e 'origin/main$' -e 'origin/HEAD' | sed 's/^ */  /' || true

section "Supabase"
local_count=$(find supabase/migrations -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')
echo "local migration files: $local_count (last: $(find supabase/migrations -maxdepth 1 -name '*.sql' | sort | tail -1 | xargs basename))"
if [[ -f supabase/.temp/project-ref ]]; then
  echo "linked project ref: $(cat supabase/.temp/project-ref)"
else
  echo "linked project ref: none (supabase/.temp/project-ref not found)"
fi
echo "Compare with:  supabase migration list --linked   (every Local version must also show under Remote)"
supabase_logged_in=0
if [[ -n "${SUPABASE_ACCESS_TOKEN:-}" || -f "$HOME/.supabase/access-token" ]]; then
  supabase_logged_in=1
elif [[ "$(uname)" == "Darwin" ]] && security find-generic-password -s "Supabase CLI" >/dev/null 2>&1; then
  supabase_logged_in=1 # only checks that a login exists; the token itself is not read here
fi
if [[ $no_remote -eq 1 ]]; then
  echo "supabase migration list skipped (--no-remote)"
elif ! command -v supabase >/dev/null 2>&1; then
  echo "supabase CLI not found"
elif [[ $supabase_logged_in -eq 0 ]]; then
  echo "supabase CLI is not logged in: skipped. Log in yourself, then run the command above."
else
  supabase migration list --linked 2>&1 | grep -v -i -e 'password' -e 'token' || echo "supabase migration list --linked FAILED"
fi

section "Vercel"
for f in .vercel/project.json apps/web/.vercel/project.json; do
  if [[ -f "$f" ]]; then
    name=$(sed -n 's/.*"projectName"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$f")
    echo "linked Vercel project ($f): ${name:-name not in file}"
  fi
done
[[ -f .vercel/project.json || -f apps/web/.vercel/project.json ]] || echo "linked Vercel project: none (.vercel/project.json not found)"
echo "committed config: vercel.json git.deploymentEnabled = $(grep -o '"deploymentEnabled"[^,}]*' vercel.json | sed 's/.*: *//' | tr -d ' ')," \
  "apps/web/vercel.json = $(grep -o '"deploymentEnabled"[^,}]*' apps/web/vercel.json | sed 's/.*: *//' | tr -d ' ')"
vercel_logged_in=0
for f in "$HOME/Library/Application Support/com.vercel.cli/auth.json" "$HOME/.local/share/com.vercel.cli/auth.json"; do
  [[ -f "$f" ]] && grep -q '"token"' "$f" && vercel_logged_in=1
done
[[ -n "${VERCEL_TOKEN:-}" ]] && vercel_logged_in=1
if [[ $no_remote -eq 1 ]]; then
  echo "vercel commands skipped (--no-remote)"
elif ! command -v vercel >/dev/null 2>&1; then
  echo "vercel CLI not found"
elif [[ $vercel_logged_in -eq 0 ]]; then
  echo "vercel CLI found but not logged in: skipped (this script never logs in)."
else
  echo "-- vercel project ls"
  CI=1 vercel project ls </dev/null 2>&1 || echo "vercel project ls FAILED"
  echo "-- vercel ls"
  CI=1 vercel ls </dev/null 2>&1 || echo "vercel ls FAILED"
fi

section "Summary"
dirty=$(git status --porcelain | wc -l | tr -d ' ')
ahead=$(git rev-list --count origin/main..main)
behind=$(git rev-list --count main..origin/main)
echo "uncommitted changes: $dirty | ahead of GitHub: $ahead | behind GitHub: $behind | local migrations: $local_count"
if [[ $dirty -eq 0 && $ahead -eq 0 && $behind -eq 0 ]]; then
  echo "Mac folder and GitHub: ALIGNED"
else
  echo "Mac folder and GitHub: NOT aligned"
fi
