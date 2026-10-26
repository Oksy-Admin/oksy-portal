// In-memory stand-in for the PostgREST paths the worker uses. Test only; fake data only.
import { randomUUID } from "node:crypto";
import type { Db } from "../src/db.ts";

type Row = Record<string, unknown>;

const DEFAULT_IDS: Record<string, string> = { claims_staging: "record_uid", payments: "payment_id" };

function parse(path: string): { table: string; filters: Array<[string, string, string]> } {
  const [table, q = ""] = path.split("?");
  const filters: Array<[string, string, string]> = [];
  for (const part of q.split("&")) {
    const [k, v] = part.split("=");
    if (!k || v === undefined || ["select", "order", "limit", "on_conflict"].includes(k)) continue;
    const dot = v.indexOf(".");
    filters.push([k, v.slice(0, dot), decodeURIComponent(v.slice(dot + 1))]);
  }
  return { table: table!, filters };
}

function match(r: Row, filters: Array<[string, string, string]>): boolean {
  return filters.every(([k, op, v]) => {
    const x = r[k];
    if (op === "eq") return String(x) === v;
    if (op === "neq") return String(x) !== v;
    if (op === "is") return v === "null" ? x == null : String(x) === v;
    if (op === "in") return v.replace(/^\(|\)$/g, "").split(",").includes(String(x));
    throw new Error(`fake db: op ${op}`);
  });
}

export function fakeDb(seed: Record<string, Row[]> = {}): Db & { tables: Record<string, Row[]> } {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const t = (name: string) => (tables[name] ??= []);
  return {
    tables,
    async select<T>(path: string) {
      const { table, filters } = parse(path);
      return t(table).filter((r) => match(r, filters)).map((r) => ({ ...r })) as T[];
    },
    async insert<T>(table: string, rows: object[], opts: { onConflict?: string; ignoreDuplicates?: boolean; returning?: boolean } = {}) {
      const out: Row[] = [];
      for (const row of rows as Row[]) {
        const keys = opts.onConflict?.split(",") ?? [];
        const existing = keys.length ? t(table).find((r) => keys.every((k) => String(r[k]) === String(row[k]))) : undefined;
        if (existing) {
          if (!opts.ignoreDuplicates) Object.assign(existing, row);
          out.push({ ...existing });
          continue;
        }
        const idCol = DEFAULT_IDS[table] ?? "id";
        const fresh = { [idCol]: randomUUID(), first_seen_at: new Date().toISOString(), ...row };
        t(table).push(fresh);
        out.push({ ...fresh });
      }
      return (opts.returning ? out : []) as T[];
    },
    async update(path: string, patch: object) {
      const { table, filters } = parse(path);
      for (const r of t(table)) if (match(r, filters)) Object.assign(r, patch);
    },
  };
}
