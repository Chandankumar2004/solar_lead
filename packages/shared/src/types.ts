export type Role = "SUPER_ADMIN" | "ADMIN" | "MANAGER" | "EXECUTIVE";

export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data?: T;
  error?: {
    code: string;
    details?: unknown;
  };
}

export interface JwtPayload {
  sub: string;
  role: Role;
  email: string;
}
