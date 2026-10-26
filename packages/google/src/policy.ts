// Tab allow-list (file 05 section 2, brief A4.2; CLAUDE.md hard rule 3). Default deny:
// only a tab a helper marked ALLOW is ever fetched. A new tab is REVIEW; tabs that look
// like credential lists are DENY automatically and are never fetched, stored or logged
// with content.
export type TabPolicy = "ALLOW" | "DENY" | "REVIEW";
export type TabKind = "DATA" | "LOOKUP" | "LEGEND" | "EXCLUDED";

const AUTO_DENY = /portal\s*list|password|passwd|login|credential/i;

/** Policy for a tab seen for the first time. Never ALLOW: a person decides that. */
export function policyForNewTab(tabName: string): TabPolicy {
  return AUTO_DENY.test(tabName) ? "DENY" : "REVIEW";
}

/**
 * The effective policy of a tab. A tab missing from the saved policies is treated as
 * new. An auto-deny name stays DENY even if someone saved ALLOW for it by mistake.
 */
export function effectivePolicy(tabName: string, saved: Readonly<Record<string, TabPolicy>>): TabPolicy {
  if (AUTO_DENY.test(tabName)) return "DENY";
  return saved[tabName] ?? policyForNewTab(tabName);
}

export class TabNotAllowedError extends Error {
  constructor(tabName: string, policy: TabPolicy) {
    super(`Tab "${tabName}" is ${policy}; only ALLOW tabs may be read`);
    this.name = "TabNotAllowedError";
  }
}
