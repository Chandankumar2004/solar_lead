import { UserRole } from "@prisma/client";
import { NextFunction, Request, Response } from "express";
import { fail } from "../lib/http.js";

export type RbacRole = "SUPER_ADMIN" | "ADMIN" | "DISTRICT_MANAGER" | "FIELD_EXECUTIVE";

const ROLE_TO_DB: Record<RbacRole, UserRole> = {
  SUPER_ADMIN: "SUPER_ADMIN",
  ADMIN: "ADMIN",
  DISTRICT_MANAGER: "MANAGER",
  FIELD_EXECUTIVE: "EXECUTIVE"
};

export const ROLE_LABEL: Record<RbacRole, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  DISTRICT_MANAGER: "District Manager",
  FIELD_EXECUTIVE: "Field Executive"
};

export function toRbacRole(role: UserRole): RbacRole {
  if (role === "SUPER_ADMIN") return "SUPER_ADMIN";
  if (role === "ADMIN") return "ADMIN";
  if (role === "MANAGER") return "DISTRICT_MANAGER";
  return "FIELD_EXECUTIVE";
}

export function allowRoles(...roles: RbacRole[]) {
  const allowedDbRoles = roles.map((r) => ROLE_TO_DB[r]);
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return fail(res, 401, "UNAUTHORIZED", "Login required");
    }
    if (!allowedDbRoles.includes(req.user.role)) {
      return fail(res, 403, "FORBIDDEN", "Insufficient role");
    }
    return next();
  };
}

