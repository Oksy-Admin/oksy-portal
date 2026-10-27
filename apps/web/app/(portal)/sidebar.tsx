"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { can, hasTick, isNavItemVisible, type AccessTicks, type Role } from "@/lib/roles";
import { icons, Logo } from "./icons";

type NavItem = {
  href: string;
  label: string;
  icon: keyof typeof icons;
  tick?: keyof AccessTicks;
  requireAdminOrOwner?: boolean;
  match: string[];
};

// 7 pages from requirements_v2 section 2:
// 1. Dashboard (/)
// 2. Hospitals (/hospitals)
// 3. Questions (/questions)
// 4. Clean Data (/claims or /reports)
// 5. Rule Library (/rules)
// 6. Audit & Runs (currently /reports until stage 8)
// 7. Settings › Users and Access (/settings/users-and-access)
const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "home", tick: "dashboard_view", match: ["/"] },
  { href: "/hospitals", label: "Hospitals", icon: "hospital", tick: "hospitals_view", match: ["/hospitals", "/admin/tabs"] },
  { href: "/mappings", label: "Column Mappings", icon: "sheet", tick: "hospitals_view", match: ["/mappings"] },
  // Field list for column mapping: Owner and Admin only (decision 27-Oct-2026).
  { href: "/fields", label: "Fields", icon: "fields", requireAdminOrOwner: true, match: ["/fields"] },
  { href: "/claims", label: "Clean Data", icon: "claims", tick: "clean_data_view", match: ["/claims"] },
  { href: "/questions", label: "Questions", icon: "questions", tick: "questions_view", match: ["/questions"] },
  { href: "/reports", label: "Audit & Runs", icon: "reports", tick: "audit_runs_view", match: ["/reports"] },
  { href: "/rules", label: "Rule Library", icon: "rules", tick: "rule_library_view", match: ["/rules"] },
  {
    href: "/settings/users-and-access",
    label: "Settings",
    icon: "settings",
    requireAdminOrOwner: true,
    match: ["/settings/users-and-access", "/admin/users"],
  },
];

function isCurrent(pathname: string, item: NavItem) {
  return item.match.some((m) => (m === "/" ? pathname === "/" : pathname === m || pathname.startsWith(`${m}/`)));
}

export function Sidebar({ role, ticks }: { role: Role | null; ticks?: AccessTicks }) {
  const pathname = usePathname();

  const isVisible = (item: NavItem) => isNavItemVisible(item, role, ticks);

  return (
    <aside className="sidebar">
      <Link href="/" className="brand">
        <Logo />
        <span>
          <strong>OKSY</strong>
          <small>Healthcare LLP</small>
        </span>
      </Link>
      <nav className="nav" aria-label="Main">
        {NAV.filter(isVisible).map((item) => (
          <Link key={item.href} href={item.href} aria-current={isCurrent(pathname, item) ? "page" : undefined}>
            {icons[item.icon]}
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="tagline">Better Claims. Healthier Tomorrow.</div>
    </aside>
  );
}
