import { describe, expect, it } from "vitest";
import { effectivePolicy, policyForNewTab, type TabPolicy } from "../src/policy.ts";
import { createReadPath, LIST_TABS_FIELDS, READ_TAB_FIELDS, type SheetsReader, type SpreadsheetData } from "../src/read.ts";
import type { GoogleEvent } from "../src/log.ts";

// A FAKE hospital sheet. Names and values are invented; no real data.
const FAKE_ID = "fake-sheet-0001";
const TABS: Record<string, string[][]> = {
  PAID: [["Patient Name", "Bill"], ["Fake Patient A", "1000"]],
  PENDING: [["Patient Name", "Bill"], ["Fake Patient B", "2000"]],
  "PORTAL LIST": [["Portal", "User", "Password"], ["fakeportal", "fakeuser", "FAKE-SECRET-123"]],
  "Staff Login Details": [["user", "pass"], ["x", "FAKE-SECRET-456"]],
  "NEW TAB 2026": [["Patient Name"], ["Fake Patient C"]],
  "O'Brien Ward": [["Patient Name"], ["Fake Patient D"]],
};

function fakeClient() {
  const calls: Array<{ fields: string; ranges?: string[] }> = [];
  const client: SheetsReader = {
    spreadsheets: {
      async get(params) {
        calls.push({ fields: params.fields, ranges: params.ranges });
        if (!params.ranges) {
          const data: SpreadsheetData = {
            sheets: Object.keys(TABS).map((title, index) => ({ properties: { title, index, hidden: false } })),
          };
          return { data };
        }
        // Like Google: return only the tabs that were asked for.
        const asked = params.ranges.map((r) => r.slice(1, -1).replace(/''/g, "'"));
        const data: SpreadsheetData = {
          sheets: asked.map((title) => ({
            properties: { title },
            data: [{ rowData: (TABS[title] ?? []).map((row) => ({ values: row.map((v) => ({ formattedValue: v })) })) }],
          })),
        };
        return { data };
      },
    },
  };
  return { client, calls };
}

const SAVED: Record<string, TabPolicy> = {
  PAID: "ALLOW",
  PENDING: "ALLOW",
  "O'Brien Ward": "ALLOW",
  "PORTAL LIST": "ALLOW", // a mistake on purpose: must still never be fetched
};

describe("tab policy (default deny)", () => {
  it("new tabs start as REVIEW, never ALLOW", () => {
    expect(policyForNewTab("NEW TAB 2026")).toBe("REVIEW");
    expect(policyForNewTab("PAID")).toBe("REVIEW");
  });
  it("credential-like tab names are DENY automatically", () => {
    for (const name of ["PORTAL LIST", "portal list", "PortalList", "Staff Login Details", "passwords", "Credentials 2024"]) {
      expect(policyForNewTab(name)).toBe("DENY");
    }
  });
  it("PORTAL LIST stays DENY even if saved as ALLOW", () => {
    expect(effectivePolicy("PORTAL LIST", SAVED)).toBe("DENY");
  });
});

describe("read path with a fake sheet", () => {
  it("lists tab names with a metadata-only field mask", async () => {
    const { client, calls } = fakeClient();
    const tabs = await createReadPath(client, () => {}).listTabs(FAKE_ID, SAVED);
    expect(tabs.map((t) => t.title)).toEqual(Object.keys(TABS));
    expect(calls).toEqual([{ fields: LIST_TABS_FIELDS, ranges: undefined }]);
    expect(tabs.find((t) => t.title === "PORTAL LIST")?.policy).toBe("DENY");
    expect(tabs.find((t) => t.title === "NEW TAB 2026")?.policy).toBe("REVIEW");
  });

  it("fetches only ALLOW tabs; DENY and REVIEW tabs are never requested", async () => {
    const { client, calls } = fakeClient();
    const data = await createReadPath(client, () => {}).readAllowedTabs(FAKE_ID, SAVED);
    const requested = calls.flatMap((c) => c.ranges ?? []);
    expect(requested).toEqual(["'PAID'", "'PENDING'", "'O''Brien Ward'"]);
    expect(requested.join()).not.toMatch(/PORTAL|Login|NEW TAB/);
    expect([...data.keys()]).toEqual(["PAID", "PENDING", "O'Brien Ward"]);
    expect(calls[1]?.fields).toBe(READ_TAB_FIELDS);
  });

  it("requests nothing when no tab is ALLOW", async () => {
    const { client, calls } = fakeClient();
    const data = await createReadPath(client, () => {}).readAllowedTabs(FAKE_ID, {});
    expect(calls).toHaveLength(1); // the tab list only
    expect(data.size).toBe(0);
  });

  it("logs every read and skip, by name only, with no cell content", async () => {
    const { client } = fakeClient();
    const events: GoogleEvent[] = [];
    await createReadPath(client, (e) => events.push(e)).readAllowedTabs(FAKE_ID, SAVED);
    expect(events.filter((e) => e.kind === "READ_TAB").map((e) => (e as { tab: string }).tab)).toEqual([
      "PAID",
      "PENDING",
      "O'Brien Ward",
    ]);
    expect(events.filter((e) => e.kind === "SKIP_TAB")).toHaveLength(3);
    const text = JSON.stringify(events);
    expect(text).not.toContain("Fake Patient");
    expect(text).not.toContain("FAKE-SECRET");
  });

  it("drops anything Google returns that was not asked for", async () => {
    const { client } = fakeClient();
    const leaky: SheetsReader = {
      spreadsheets: {
        async get(params) {
          const res = await client.spreadsheets.get(params);
          if (params.ranges) {
            res.data.sheets?.push({
              properties: { title: "PORTAL LIST" },
              data: [{ rowData: [{ values: [{ formattedValue: "FAKE-SECRET-123" }] }] }],
            });
          }
          return res;
        },
      },
    };
    const data = await createReadPath(leaky, () => {}).readAllowedTabs(FAKE_ID, SAVED);
    expect(data.has("PORTAL LIST")).toBe(false);
  });
});

describe("header probe for tab discovery (Stage 3)", () => {
  it("asks only rows 1 to 10 of the named tabs", async () => {
    const { client, calls } = fakeClient();
    const read = createReadPath(client, () => {});
    await read.readHeaderRows(FAKE_ID, ["PAID", "O'Brien Ward"]);
    expect(calls).toEqual([{ fields: READ_TAB_FIELDS, ranges: ["'PAID'!1:10", "'O''Brien Ward'!1:10"] }]);
  });

  it("refuses a credential-like tab before any Google call", async () => {
    const { client, calls } = fakeClient();
    const read = createReadPath(client, () => {});
    await expect(read.readHeaderRows(FAKE_ID, ["PAID", "PORTAL LIST"])).rejects.toThrow(/DENY/);
    expect(calls).toHaveLength(0);
  });
});
