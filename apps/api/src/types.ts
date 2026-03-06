import { UserRole, UserStatus } from "@prisma/client";

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
}

