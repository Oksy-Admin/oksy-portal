// In-memory stand-in for the PostgREST paths the worker uses. Test only; fake data only.
import { randomUUID } from "node:crypto";
import { autoIgnoreByHeader } from "@oksy/rules";
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
      const q = new URLSearchParams(path.split("?")[1] ?? "");
      let rows = t(table).filter((r) => match(r, filters));
      const order = q.get("order")?.match(/^(\w+)\.(asc|desc)$/);
      if (order) {
        const [, col, dir] = order as unknown as [string, string, string];
        rows = [...rows].sort((a, b) => String(a[col] ?? "").localeCompare(String(b[col] ?? "")) * (dir === "desc" ? -1 : 1));
      }
      const limit = q.get("limit");
      if (limit) rows = rows.slice(0, Number(limit));
      return rows.map((r) => ({ ...r })) as T[];
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
        const now = new Date().toISOString();
        const fresh = { [idCol]: randomUUID(), first_seen_at: now, ...(table === "snapshots" ? { taken_at: now } : {}), ...row };
        t(table).push(fresh);
        out.push({ ...fresh });
      }
      return (opts.returning ? out : []) as T[];
    },
    async update(path: string, patch: object) {
      const { table, filters } = parse(path);
      for (const r of t(table)) if (match(r, filters)) Object.assign(r, patch);
    },
    /** purge_old_snapshots: drops snapshots taken more than 12 months ago. */
    async rpc<T>(name: string) {
      if (name !== "purge_old_snapshots") throw new Error(`fake db: rpc ${name}`);
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 12);
      const before = t("snapshots").length;
      tables.snapshots = t("snapshots").filter((r) => !r.taken_at || new Date(String(r.taken_at)) > cutoff);
      return (before - tables.snapshots.length) as T;
    },
  };
}

/**
 * A person decides every stored column once, as proposed (the Column Mappings page,
 * decide_header): one header_decisions row per hospital + scheme + header; auto-Ignored
 * headers are never offered. Fake ids only.
 */
export function decideAll(db: { tables: Record<string, Row[]> }, over: Record<string, string | null> = {}, by = "fake-user-1"): void {
  const list = (db.tables.header_decisions ??= []);
  for (const m of db.tables.column_mappings ?? []) {
    const key = String(m.header_key ?? "");
    if (!key || autoIgnoreByHeader(String(m.source_header)) || list.some((d) => d.hospital_code === m.hospital_code && d.scheme === m.scheme && d.header_key === key)) continue;
    const canonical_field = key in over ? over[key]! : ((m.canonical_field as string | null) ?? null);
    list.push({ hospital_code: m.hospital_code, scheme: m.scheme, header_key: key, canonical_field, accept_any_shape: false, decided_by: by, decided_at: "2026-10-27T05:00:00Z" });
  }
}
