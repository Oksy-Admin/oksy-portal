#!/usr/bin/env bash
# Schema drift check (Stage 1c): replays every migration on a throwaway Supabase Postgres
# (Docker / colima, no login, fake data only) and prints the schema names
# (scripts/schema-names.sql) to supabase/.temp/schema-repo.txt. Compare with the same query
# run read-only on live, saved as supabase/.temp/schema-live.txt:
#   bash scripts/schema-drift.sh            # replay + compare if the live list exists
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
tag="supabase/postgres:17.11.0.006"
name="oksy-schema-drift"
pw="$(openssl rand -hex 16)"
docker pull -q "docker.io/$tag" >/dev/null 2>&1 || docker pull -q "public.ecr.aws/$tag" >/dev/null
image="$(docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -m1 "$tag")"
docker rm -f "$name" >/dev/null 2>&1 || true
docker run -d --name "$name" -e POSTGRES_PASSWORD="$pw" "$image" >/dev/null
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 60); do docker exec "$name" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break; sleep 2; done
sleep 3
psql_as() { docker exec -i -e PGPASSWORD="$pw" "$name" psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
psql_as <<'SQL'
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
SQL
for f in supabase/migrations/*.sql; do psql_as < "$f" >/dev/null; done
mkdir -p supabase/.temp
psql_as -t -A < scripts/schema-names.sql > supabase/.temp/schema-repo.txt
echo "repo schema: $(wc -l < supabase/.temp/schema-repo.txt) names -> supabase/.temp/schema-repo.txt"
# Fingerprint: equal to md5(string_agg(line, E'\n' order by line collate "C") || E'\n') over the
# same query on live (one read-only query) when live and the files match.
echo "repo fingerprint: $(LC_ALL=C sort supabase/.temp/schema-repo.txt | md5sum 2>/dev/null | cut -d' ' -f1 || LC_ALL=C sort supabase/.temp/schema-repo.txt | md5)"
if [[ -f supabase/.temp/schema-live.txt ]]; then
  if diff <(sort supabase/.temp/schema-live.txt) <(sort supabase/.temp/schema-repo.txt) > supabase/.temp/schema-drift.txt; then
    echo "No drift: live and the migration files match."
  else
    echo "DRIFT ('<' only on live, '>' only in the files): supabase/.temp/schema-drift.txt"
    grep -c '^[<>]' supabase/.temp/schema-drift.txt
    exit 1
  fi
fi
