"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { can, type Permission, type Role } from "@/lib/roles";
import { icons, Logo } from "./icons";

type NavItem = { href: string; label: string; icon: keyof typeof icons; need?: Permission; match: string[] };

// Menu of the mockups. Items a role may not use are hidden; each page checks the role again
// and the database (RLS) is what actually enforces access.
const NAV: NavItem[] = [
  { href: "/", label: "Home", icon: "home", match: ["/"] },
  { href: "/hospitals", label: "Hospitals", icon: "hospital", need: "helper_work", match: ["/hospitals", "/admin/tabs"] },
  { href: "/mappings", label: "Column Mappings (G1)", icon: "sheet", need: "helper_work", match: ["/mappings"] },
  { href: "/claims", label: "Claims & Payments", icon: "claims", need: "see_cleaned_data", match: ["/claims"] },
  { href: "/questions", label: "Questions", icon: "questions", need: "helper_work", match: ["/questions"] },
  { href: "/reports", label: "Reports", icon: "reports", need: "see_cleaned_data", match: ["/reports"] },
  { href: "/rules", label: "Rule Library", icon: "rules", need: "view_rule_library", match: ["/rules"] },
  { href: "/admin/users", label: "Settings", icon: "settings", need: "manage_users", match: ["/admin/users"] },
];

function isCurrent(pathname: string, item: NavItem) {
  return item.match.some((m) => (m === "/" ? pathname === "/" : pathname === m || pathname.startsWith(`${m}/`)));
}

export function Sidebar({ role }: { role: Role | null }) {
  const pathname = usePathname();
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
        {NAV.filter((item) => role !== null && (!item.need || can(role, item.need))).map((item) => (
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
