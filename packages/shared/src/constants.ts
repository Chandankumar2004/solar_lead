export const JWT_ACCESS_TTL = "15m";
export const JWT_REFRESH_TTL_DAYS = 7;

export const ROLE = {
  SUPER_ADMIN: "SUPER_ADMIN",
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  EXECUTIVE: "EXECUTIVE"
} as const;

export const LEAD_TERMINAL_FLAGS = {
  NON_TERMINAL: false,
  TERMINAL: true
} as const;

export const API_RESPONSE_DEFAULT_MESSAGE = "OK";
