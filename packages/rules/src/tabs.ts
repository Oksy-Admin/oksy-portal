// Tab discovery (requirements v2 section 5): the portal finds the month tabs of a linked
// Google Sheet itself. A tab named like a month ("OCT 2026", "SEP-2026", "October 2026",
// "OCT'26") is a MONTH tab; anything else ("TPA LIST", "COLOURS", "Sheet1") is a HELPER
// tab and is never read as data. A month tab after the current month is a pre-made FUTURE
// tab and waits until its month starts. Pure code, tab names only.

const MONTHS: Array<[RegExp, number]> = [
  [/^jan(uary)?$/, 1],
  [/^feb(ruary)?$/, 2],
  [/^mar(ch)?$/, 3],
  [/^apr(il)?$/, 4],
  [/^may$/, 5],
  [/^june?$/, 6],
  [/^july?$/, 7],
  [/^aug(ust)?$/, 8],
  [/^sep(t|tember)?$/, 9],
  [/^oct(ober)?$/, 10],
  [/^nov(ember)?$/, 11],
  [/^dec(ember)?$/, 12],
];

export interface TabMonth {
  year: number;
  month: number; // 1 to 12
}

/** The month a tab name stands for, or null when the name is not a month name with a year. */
export function monthOfTab(tabName: string): TabMonth | null {
  const m = tabName.trim().toLowerCase().match(/^([a-z]+)\.?\s*[-'’/ ]?\s*(\d{2}|\d{4})$/);
  if (!m || !m[1] || !m[2]) return null;
  const month = MONTHS.find(([re]) => re.test(m[1]!))?.[1];
  if (!month) return null;
  const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  if (year < 2000 || year > 2100) return null;
  return { year, month };
}

export type TabClass =
  | { tab: string; type: "MONTH"; month: TabMonth }
  | { tab: string; type: "FUTURE_MONTH"; month: TabMonth }
  | { tab: string; type: "HELPER" };

/** Classifies every tab; today is an ISO date (IST) and decides what counts as the future. */
export function classifyTabs(tabNames: string[], todayIso: string): TabClass[] {
  const [y, mo] = todayIso.split("-").map(Number) as [number, number];
  const now = y * 12 + mo;
  return tabNames.map((tab) => {
    const month = monthOfTab(tab);
    if (!month) return { tab, type: "HELPER" };
    return month.year * 12 + month.month > now ? { tab, type: "FUTURE_MONTH", month } : { tab, type: "MONTH", month };
  });
}

/** Month tabs newest first (the newest one is used to propose the column mapping). */
export function newestFirst<T extends { month: TabMonth }>(tabs: T[]): T[] {
  return [...tabs].sort((a, b) => b.month.year * 12 + b.month.month - (a.month.year * 12 + a.month.month));
}
