// The worker's database access: Supabase REST with the worker key (service_role, least
// privilege, migrations 0004 to 0008). The key comes from the environment and is never
// printed. Errors carry status and code only, never a row (hard rule 10).
export interface Db {
  select<T>(path: string): Promise<T[]>;
  insert<T>(table: string, rows: object[], opts?: { onConflict?: string; ignoreDuplicates?: boolean; returning?: boolean }): Promise<T[]>;
  update(pathWithFilter: string, patch: object): Promise<void>;
  /** Calls a database function the worker may run (POST /rpc/<name>). */
  rpc<T>(name: string, args?: object): Promise<T>;
}

export class DbError extends Error {
  constructor(method: string, table: string, status: number, code: string) {
    super(`database ${method} ${table} failed: status ${status}, code ${code}`);
    this.name = "DbError";
  }
}

/** Rows of one batch must share the same keys (PostgREST PGRST102): missing keys become null. */
export function sameKeys(rows: object[]): Array<Record<string, unknown>> {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return rows.map((r) => Object.fromEntries(keys.map((k) => [k, (r as Record<string, unknown>)[k] ?? null])));
}

export function restDb(url: string, key: string, fetchFn: typeof fetch = fetch): Db {
  const base = `${url.replace(/\/$/, "")}/rest/v1`;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  async function call(method: string, path: string, body?: unknown, prefer?: string): Promise<unknown> {
    const res = await fetchFn(`${base}/${path}`, {
      method,
      headers: prefer ? { ...headers, Prefer: prefer } : headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const parsed = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) throw new DbError(method, path.split("?")[0] ?? path, res.status, (parsed as { code?: string } | null)?.code ?? "?");
    return parsed;
  }
  return {
    async select<T>(path: string) {
      return ((await call("GET", path)) ?? []) as T[];
    },
    async insert<T>(table: string, rows: object[], opts: { onConflict?: string; ignoreDuplicates?: boolean; returning?: boolean } = {}) {
      if (rows.length === 0) return [];
      const q = opts.onConflict ? `?on_conflict=${opts.onConflict}` : "";
      const res = opts.onConflict ? (opts.ignoreDuplicates ? "resolution=ignore-duplicates" : "resolution=merge-duplicates") : "";
      const ret = opts.returning ? "return=representation" : "return=minimal";
      return (((await call("POST", `${table}${q}`, sameKeys(rows), [res, ret].filter(Boolean).join(","))) ?? []) as T[]);
    },
    async update(pathWithFilter: string, patch: object) {
      await call("PATCH", pathWithFilter, patch, "return=minimal");
    },
    async rpc<T>(name: string, args: object = {}) {
      return (await call("POST", `rpc/${name}`, args)) as T;
    },
  };
}

export function dbFromEnv(): Db {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set");
  return restDb(url, key);
}

export function chunks<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}
