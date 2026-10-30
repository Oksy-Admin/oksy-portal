#!/usr/bin/env bash
# Claude Code Stop hook: before Claude finishes a turn, check changed code.
# Runs only when code under apps/ packages/ supabase/ has uncommitted changes.
# On failure, prints the last 40 lines and exits 2 so Claude fixes it in the same prompt.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 0

input="$(cat)"
active="$(printf '%s' "$input" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(String(JSON.parse(d).stop_hook_active||false))}catch{process.stdout.write("false")}})')"
# Avoid an endless loop: check at most once per stop chain.
[ "$active" = "true" ] && exit 0

if git diff --quiet HEAD -- apps packages supabase 2>/dev/null && [ -z "$(git ls-files --others --exclude-standard apps packages supabase)" ]; then
  exit 0
fi

log="$(mktemp)"
for step in typecheck lint test; do
  if ! pnpm -s "$step" >"$log" 2>&1; then
    echo "Stop check: 'pnpm $step' failed. Fix it before finishing. Last lines:" >&2
    tail -n 40 "$log" >&2
    rm -f "$log"
    exit 2
  fi
done
rm -f "$log"
exit 0
