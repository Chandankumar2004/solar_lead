import type { AdminRole } from "@/lib/auth-store";
import type { Route } from "next";

export const ALL_ADMIN_ROLES: AdminRole[] = [
  "SUPER_ADMIN",
  "ADMIN",
  "DISTRICT_MANAGER"
];

export type NavItem = {
  href: Route;
  label: string;
  labelKey: string;
  roles: AdminRole[];
};

export const ADMIN_NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", labelKey: "nav.dashboard", roles: ALL_ADMIN_ROLES },
  { href: "/leads", label: "Leads", labelKey: "nav.leads", roles: ALL_ADMIN_ROLES },
  { href: "/users", label: "Users", labelKey: "nav.users", roles: ["SUPER_ADMIN", "ADMIN"] },
  { href: "/districts", label: "Districts", labelKey: "nav.districts", roles: ["SUPER_ADMIN"] },
  { href: "/workflow", label: "Workflow", labelKey: "nav.workflow", roles: ["SUPER_ADMIN"] },
  {
    href: "/documents-review",
    label: "Documents Review",
    labelKey: "nav.documentsReview",
    roles: ["SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER"]
  },
  {
    href: "/payments-verification",
    label: "Payments Verification",
    labelKey: "nav.paymentsVerification",
    roles: ["SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER"]
  },
  { href: "/chat", label: "Chat", labelKey: "nav.chat", roles: ALL_ADMIN_ROLES },
  { href: "/notifications", label: "Notifications", labelKey: "nav.notifications", roles: ALL_ADMIN_ROLES },
  { href: "/reports", label: "Reports", labelKey: "nav.reports", roles: ALL_ADMIN_ROLES }
];

const ROUTE_ACCESS = [
  { pattern: /^\/dashboard$/, roles: ALL_ADMIN_ROLES },
  { pattern: /^\/leads(\/[^/]+)?$/, roles: ALL_ADMIN_ROLES },
  { pattern: /^\/users(\/.*)?$/, roles: ["SUPER_ADMIN", "ADMIN"] as AdminRole[] },
  { pattern: /^\/districts$/, roles: ["SUPER_ADMIN"] as AdminRole[] },
  { pattern: /^\/workflow$/, roles: ["SUPER_ADMIN"] as AdminRole[] },
  {
    pattern: /^\/documents-review$/,
    roles: ["SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER"] as AdminRole[]
  },
  {
    pattern: /^\/payments-verification$/,
    roles: ["SUPER_ADMIN", "ADMIN", "DISTRICT_MANAGER"] as AdminRole[]
  },
  {
    pattern: /^\/chat$/,
    roles: ALL_ADMIN_ROLES
  },
  {
    pattern: /^\/notifications$/,
    roles: ALL_ADMIN_ROLES
  },
  {
    pattern: /^\/reports$/,
    roles: ALL_ADMIN_ROLES
  }
];

export function hasRouteAccess(pathname: string, role: AdminRole) {
  const rule = ROUTE_ACCESS.find((item) => item.pattern.test(pathname));
  if (!rule) {
    return false;
  }
  return rule.roles.includes(role);
}

export function pageTitle(pathname: string) {
  if (pathname.startsWith("/leads/")) return "portal.leadDetail";
  if (pathname === "/users/create") return "portal.createUser";
  if (pathname.startsWith("/users/")) return "portal.userDetail";
  const match = ADMIN_NAV_ITEMS.find((item) => item.href === pathname);
  if (match) return match.labelKey;
  return "portal.admin";
}
