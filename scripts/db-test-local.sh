#!/usr/bin/env bash
# Run the database migrations and security tests on this computer, with no Supabase
# account and no login: a throwaway Supabase Postgres container (needs Docker/colima).
# Same image as the Supabase CLI uses for Postgres 17. Fake data only.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# The same image (identical digests) is published on Docker Hub and Amazon ECR.
# Docker Hub first: GitHub's shared runners hit ECR's anonymous "Data limit exceeded".
tag="supabase/postgres:17.11.0.006"
mirrors=("docker.io/$tag" "public.ecr.aws/$tag")
name="oksy-db-test"
pw="$(openssl rand -hex 16)" # throwaway, lives only inside this container

image=""
for attempt in 1 2 3; do
  for m in "${mirrors[@]}"; do
    if docker pull -q "$m" >/dev/null 2>&1; then image="$m"; break 2; fi
    echo "could not download $m (attempt $attempt)"
  done
  sleep $((attempt * 10))
done
if [[ -z "$image" ]]; then
  echo "DATABASE TESTS NOT RUN: the database image could not be downloaded" >&2
  exit 1
fi
echo "database image: $image"

docker rm -f "$name" >/dev/null 2>&1 || true
docker run -d --name "$name" -e POSTGRES_PASSWORD="$pw" "$image" >/dev/null
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT

for _ in $(seq 1 60); do
  docker exec "$name" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break
  sleep 2
done
sleep 3 # init scripts finish after the server first accepts connections

psql_as() { docker exec -i -e PGPASSWORD="$pw" "$name" psql -h localhost -U "$1" -d postgres -v ON_ERROR_STOP=1 -q "${@:2}"; }

# Match the live project (found 25-Oct): new public tables get NO automatic rights for
# anon, authenticated or service_role. The local image grants them by default; remove that,
# so every right must be granted in a migration and the tests see the same as live.
psql_as postgres <<'SQL'
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
SQL

for f in supabase/migrations/*.sql; do
  echo "migration: $f"
  psql_as postgres < "$f"
done

failed=0
for t in supabase/tests/*.sql; do
  echo "test file: $t"
  out=$(psql_as postgres -t -A < "$t" 2>&1) || failed=1
  echo "$out" | grep -E '^(ok|not ok|#)' || true
  if echo "$out" | grep -qE '^not ok|Looks like|ERROR'; then
    echo "$out" | grep -E 'ERROR|Looks like' || true
    failed=1
  fi
done

if [[ $failed -ne 0 ]]; then
  echo "DATABASE TESTS FAILED"
  exit 1
fi
echo "All database tests passed."
