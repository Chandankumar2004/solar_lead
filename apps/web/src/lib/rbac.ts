import type { AdminRole } from "@/lib/auth-store";
import type { Route } from "next";

export const ALL_ADMIN_ROLES: AdminRole[] = [
  "SUPER_ADMIN",
  "ADMIN",
  "DISTRICT_MANAGER",
  "FIELD_EXECUTIVE"
];

export type NavItem = {
  href: Route;
  label: string;
  roles: AdminRole[];
};

export const ADMIN_NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", roles: ALL_ADMIN_ROLES },
  { href: "/leads", label: "Leads", roles: ALL_ADMIN_ROLES },
  { href: "/users", label: "Users", roles: ["SUPER_ADMIN", "ADMIN"] },
  { href: "/districts", label: "Districts", roles: ["SUPER_ADMIN"] },
  { href: "/workflow", label: "Workflow", roles: ["SUPER_ADMIN", "ADMIN"] },
  {
    href: "/documents-review",
    label: "Documents Review",
    roles: ["SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER"]
  },
  {
    href: "/payments-verification",
    label: "Payments Verification",
    roles: ["SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER"]
  },
  { href: "/notifications", label: "Notifications", roles: ALL_ADMIN_ROLES }
];

const ROUTE_ACCESS = [
  { pattern: /^\/dashboard$/, roles: ALL_ADMIN_ROLES },
  { pattern: /^\/leads(\/[^/]+)?$/, roles: ALL_ADMIN_ROLES },
  { pattern: /^\/users(\/.*)?$/, roles: ["SUPER_ADMIN", "ADMIN"] as AdminRole[] },
  { pattern: /^\/districts$/, roles: ["SUPER_ADMIN"] as AdminRole[] },
  { pattern: /^\/workflow$/, roles: ["SUPER_ADMIN", "ADMIN"] as AdminRole[] },
  {
    pattern: /^\/documents-review$/,
    roles: ["SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER"] as AdminRole[]
  },
  {
    pattern: /^\/payments-verification$/,
    roles: ["SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER"] as AdminRole[]
  },
  { pattern: /^\/notifications$/, roles: ALL_ADMIN_ROLES }
];

export function hasRouteAccess(pathname: string, role: AdminRole) {
  const rule = ROUTE_ACCESS.find((item) => item.pattern.test(pathname));
  if (!rule) {
    return false;
  }
  return rule.roles.includes(role);
}

export function pageTitle(pathname: string) {
  if (pathname.startsWith("/leads/")) return "Lead Detail";
  if (pathname === "/users/create") return "Create User";
  if (pathname.startsWith("/users/")) return "User Detail";
  const match = ADMIN_NAV_ITEMS.find((item) => item.href === pathname);
  if (match) return match.label;
  return "Admin";
}
