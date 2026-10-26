#!/usr/bin/env bash
# Secret scan (CLAUDE.md hard rule 1).
#   --staged : before a commit, scan only what is about to be committed (pre-commit hook)
#   (none)   : scan the whole working folder and the full git history (CI and by hand)
# Findings are printed REDACTED: the secret itself is never shown.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "secret-scan: gitleaks is not installed. Commit blocked." >&2
  echo "Install it with: brew install gitleaks" >&2
  exit 1
fi

# Files that must never be committed, whatever they contain.
blocked_names='(^|/)\.env($|\.)|\.pem$|\.p12$|\.key$|service-?account.*\.json$|credentials.*\.json$|oksy-data-cleanse-.*\.json$'

if [[ "${1:-}" == "--staged" ]]; then
  bad_files=$(git diff --cached --name-only --diff-filter=ACMR | grep -E "$blocked_names" | grep -v -E '(^|/)\.env\.example$' || true)
  if [[ -n "$bad_files" ]]; then
    echo "secret-scan: these files must never be committed:" >&2
    echo "$bad_files" >&2
    exit 1
  fi
  gitleaks git --pre-commit --staged --redact --no-banner --config .gitleaks.toml
else
  bad_files=$(git ls-files | grep -E "$blocked_names" | grep -v -E '(^|/)\.env\.example$' || true)
  if [[ -n "$bad_files" ]]; then
    echo "secret-scan: these tracked files must not be in the repo:" >&2
    echo "$bad_files" >&2
    exit 1
  fi
  # Every file git could commit (tracked, or new and not ignored). Git-ignored files such
  # as apps/web/.env.local are where secrets belong; they can never be committed.
  found=0
  while IFS= read -r -d '' f; do
    [[ -f "$f" ]] || continue
    gitleaks dir "$f" --redact --no-banner --log-level error --config .gitleaks.toml || found=1
  done < <(git ls-files -z --cached --others --exclude-standard)
  if [[ $found -ne 0 ]]; then
    echo "secret-scan: secrets found in files git could commit (see above)." >&2
    exit 1
  fi
  if git rev-parse --verify HEAD >/dev/null 2>&1; then
    gitleaks git . --redact --no-banner --config .gitleaks.toml
  fi
fi
echo "secret-scan: no secrets found."
