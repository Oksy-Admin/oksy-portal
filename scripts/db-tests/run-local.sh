#!/usr/bin/env bash
# Tests migration 20261027000028 on a throwaway local Postgres (the supabase/postgres image
# already on this Mac). Never touches the live project. Removes the container at the end.
set -euo pipefail
cd "$(dirname "$0")/../.."
name=oksy-mig-test-$$
docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=localtestonly supabase/postgres:17.11.0.006 >/dev/null
trap 'docker stop "$name" >/dev/null' EXIT
for _ in $(seq 1 60); do docker exec "$name" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break; sleep 1; done
psql() { docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 -q -P pager=off "$@"; }
psql < scripts/db-tests/0028_stubs.sql
psql < supabase/migrations/20261027000028_mapping_fields.sql >/dev/null
psql < scripts/db-tests/0028_checks.sql | sed -n '/check_name/,$p'
