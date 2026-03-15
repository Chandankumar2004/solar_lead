export type UserRole = "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "EXECUTIVE";
export type UserStatus = "ACTIVE" | "PENDING" | "SUSPENDED" | "DEACTIVATED";

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
}
