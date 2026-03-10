import type { User as SupabaseAuthUser } from "@supabase/supabase-js";
import { UserRole, UserStatus } from "../types.js";
import {
  getMissingSupabaseEnvKeys,
  getSupabaseAdminClient,
  getSupabaseAnonClient,
  isSupabaseAuthConfigured
} from "../lib/supabase.js";

const SUPABASE_USERS_PAGE_SIZE = 200;
const MAX_SUPABASE_USER_SCAN_PAGES = 200;

type PublicUser = {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
};

type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
};

type AppUserRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: string | null;
  status: string | null;
};

export type LoginFailureReason =
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_PENDING"
  | "ACCOUNT_SUSPENDED"
  | "APP_PROFILE_NOT_FOUND"
  | "AUTH_CONFIG_ERROR"
  | "AUTH_BACKEND_ERROR";

export type LoginResult =
  | {
      ok: true;
      user: PublicUser;
      accessToken: string;
      refreshToken: string;
    }
  | {
      ok: false;
      reason: LoginFailureReason;
      userId?: string;
    };

export type SessionResolveResult =
  | {
      ok: true;
      user: SessionUser;
      supabaseUserId: string;
    }
  | {
      ok: false;
      reason:
        | "MISSING_SESSION"
        | "INVALID_SESSION"
        | "APP_PROFILE_NOT_FOUND"
        | "AUTH_CONFIG_ERROR"
        | "AUTH_BACKEND_ERROR";
    };

export type EnsureSupabaseAuthUserResult =
  | {
      ok: true;
      supabaseUserId: string;
      created: boolean;
    }
  | {
      ok: false;
      reason:
        | "AUTH_CONFIG_ERROR"
        | "AUTH_BACKEND_ERROR"
        | "CONFLICT"
        | "MISSING_PASSWORD"
        | "NOT_FOUND";
      message: string;
    };

function normalizeEmail(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function nonEmpty(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mapRole(value: string | null | undefined): UserRole {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "super_admin") return "SUPER_ADMIN";
  if (normalized === "admin") return "ADMIN";
  if (normalized === "manager") return "MANAGER";
  return "EXECUTIVE";
}

function mapStatus(value: string | null | undefined): UserStatus {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "active") return "ACTIVE";
  if (normalized === "pending") return "PENDING";
  return "SUSPENDED";
}

function dbRoleValue(role: UserRole) {
  if (role === "SUPER_ADMIN") return "super_admin";
  if (role === "ADMIN") return "admin";
  if (role === "MANAGER") return "manager";
  return "executive";
}

function dbStatusValue(status: UserStatus) {
  if (status === "ACTIVE") return "active";
  if (status === "PENDING") return "pending";
  return "suspended";
}

function fallbackNameFromEmail(email: string) {
  const normalized = normalizeEmail(email);
  const localPart = normalized.split("@")[0] ?? "";
  const cleaned = localPart.replace(/[._-]+/g, " ").trim();
  if (!cleaned) {
    return "User";
  }
  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function mapAppUserRow(row: AppUserRow): SessionUser {
  return {
    id: String(row.id),
    email: normalizeEmail(row.email),
    fullName: String(row.full_name ?? ""),
    role: mapRole(row.role),
    status: mapStatus(row.status)
  };
}

function toPublicUser(user: SessionUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    status: user.status
  };
}

function stripWrappingQuotes(raw: string | undefined | null) {
  const trimmed = (raw ?? "").trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

async function ensureSeedSuperAdminAppProfile(email: string): Promise<SessionUser | null> {
  const seedEmail = normalizeEmail(
    stripWrappingQuotes(process.env.SEED_SUPER_ADMIN_EMAIL) || "chandan32005c@gmail.com"
  );
  const normalizedEmail = normalizeEmail(email);
  if (!seedEmail || normalizedEmail !== seedEmail) {
    return null;
  }

  const fullName = stripWrappingQuotes(process.env.SEED_SUPER_ADMIN_NAME) || "Super Admin";
  const phoneRaw = stripWrappingQuotes(process.env.SEED_SUPER_ADMIN_PHONE);
  const phone = phoneRaw.length > 0 ? phoneRaw : null;
  const employeeId = stripWrappingQuotes(process.env.SEED_SUPER_ADMIN_EMPLOYEE_ID) || "SA-001";
  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    return null;
  }

  try {
    const { data: existingByEmployee } = await adminClient
      .from("users")
      .select("id")
      .eq("employee_id", employeeId)
      .maybeSingle();

    const payload = {
      email: normalizedEmail,
      full_name: fullName,
      phone,
      employee_id: employeeId,
      role: "super_admin",
      status: "active",
      // legacy field is NOT NULL in current schema, keep deterministic placeholder value
      password_hash: "__supabase_auth_managed__"
    };

    const userQuery = existingByEmployee?.id
      ? adminClient
          .from("users")
          .update(payload)
          .eq("id", existingByEmployee.id)
          .select("id, email, full_name, role, status")
          .single()
      : adminClient
          .from("users")
          .upsert(payload, { onConflict: "email" })
          .select("id, email, full_name, role, status")
          .single();

    const { data, error } = await userQuery;
    if (error || !data) {
      console.error("AUTH_LOGIN_DB_ERROR", {
        stage: "SEED_SUPER_ADMIN_AUTOCREATE",
        email: normalizedEmail,
        error: error?.message ?? "insert/update failed"
      });
      return null;
    }

    return {
      id: String(data.id),
      email: normalizeEmail(data.email),
      fullName: String(data.full_name ?? fullName),
      role: "SUPER_ADMIN",
      status: "ACTIVE"
    };
  } catch (error) {
    console.error("AUTH_LOGIN_DB_ERROR", {
      stage: "SEED_SUPER_ADMIN_AUTOCREATE",
      email: normalizedEmail,
      error
    });
    return null;
  }
}

function readAppUserIdFromSupabaseUser(supabaseUser: SupabaseAuthUser): string | null {
  const fromUserMeta = nonEmpty(
    (supabaseUser.user_metadata as Record<string, unknown> | null | undefined)
      ?.app_user_id as string | undefined
  );
  if (fromUserMeta) {
    return fromUserMeta;
  }
  const fromAppMeta = nonEmpty(
    (supabaseUser.app_metadata as Record<string, unknown> | null | undefined)
      ?.app_user_id as string | undefined
  );
  return fromAppMeta;
}

function authConfigError(context: string) {
  console.error("AUTH_ENV_ERROR", {
    reason: "SUPABASE_AUTH_NOT_CONFIGURED",
    context,
    missingEnv: getMissingSupabaseEnvKeys()
  });
}

function isInvalidCredentialError(
  error: {
    message?: string;
    status?: number;
  } | null | undefined
) {
  const status = typeof error?.status === "number" ? error.status : null;
  if (status === 400 || status === 401) {
    return true;
  }
  const message = (error?.message ?? "").toLowerCase();
  return (
    message.includes("invalid login credentials") ||
    message.includes("invalid credentials") ||
    message.includes("email not confirmed")
  );
}

function isConflictError(
  error: {
    message?: string;
    status?: number;
  } | null | undefined
) {
  const status = typeof error?.status === "number" ? error.status : null;
  if (status === 409 || status === 422) {
    return true;
  }
  const message = (error?.message ?? "").toLowerCase();
  return (
    message.includes("already") ||
    message.includes("duplicate") ||
    message.includes("exists")
  );
}

function errorMessage(
  error: {
    message?: string;
  } | null | undefined,
  fallback: string
) {
  const message = nonEmpty(error?.message);
  return message ?? fallback;
}

async function findSessionUserByEmail(email: string): Promise<SessionUser | null> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return null;
  }

  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    return null;
  }

  try {
    const { data, error } = await adminClient
      .from("users")
      .select("id, email, full_name, role, status")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return mapAppUserRow(data as AppUserRow);
  } catch (error) {
    console.error("AUTH_LOGIN_DB_ERROR", {
      stage: "SESSION_USER_EMAIL_LOOKUP",
      email: normalizedEmail,
      error
    });
    return null;
  }
}

export async function findSessionUserById(userId: string): Promise<SessionUser | null> {
  if (!nonEmpty(userId)) {
    return null;
  }

  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    return null;
  }

  try {
    const { data, error } = await adminClient
      .from("users")
      .select("id, email, full_name, role, status")
      .eq("id", userId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return mapAppUserRow(data as AppUserRow);
  } catch (error) {
    console.error("AUTH_LOGIN_DB_ERROR", {
      stage: "SESSION_USER_ID_LOOKUP",
      userId,
      error
    });
    return null;
  }
}

async function provisionAppProfileFromSupabaseUser(
  supabaseUser: SupabaseAuthUser
): Promise<SessionUser | null> {
  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    return null;
  }

  const email = normalizeEmail(supabaseUser.email);
  if (!email) {
    return null;
  }

  const metadata =
    (supabaseUser.user_metadata as Record<string, unknown> | null | undefined) ?? {};
  const seedEmail = normalizeEmail(
    stripWrappingQuotes(process.env.SEED_SUPER_ADMIN_EMAIL) || "chandan32005c@gmail.com"
  );
  const isSeedAdmin = seedEmail.length > 0 && email === seedEmail;

  const fullName =
    nonEmpty(metadata.full_name as string | undefined) ??
    nonEmpty(metadata.fullName as string | undefined) ??
    (isSeedAdmin
      ? stripWrappingQuotes(process.env.SEED_SUPER_ADMIN_NAME) || "Super Admin"
      : fallbackNameFromEmail(email));
  const phone =
    nonEmpty(metadata.phone as string | undefined) ??
    (isSeedAdmin ? nonEmpty(stripWrappingQuotes(process.env.SEED_SUPER_ADMIN_PHONE)) : null);
  const employeeId = isSeedAdmin
    ? nonEmpty(stripWrappingQuotes(process.env.SEED_SUPER_ADMIN_EMPLOYEE_ID)) ?? "SA-001"
    : null;
  const role = isSeedAdmin
    ? "SUPER_ADMIN"
    : mapRole(nonEmpty(metadata.role as string | undefined));
  const status = isSeedAdmin
    ? "ACTIVE"
    : mapStatus(nonEmpty(metadata.status as string | undefined));

  const payload: Record<string, unknown> = {
    email,
    full_name: fullName,
    phone,
    role: dbRoleValue(role),
    status: dbStatusValue(status),
    password_hash: "__supabase_auth_managed__"
  };
  if (employeeId) {
    payload.employee_id = employeeId;
  }

  try {
    const { data, error } = await adminClient
      .from("users")
      .upsert(payload, { onConflict: "email" })
      .select("id, email, full_name, role, status")
      .single();
    if (error || !data) {
      console.error("AUTH_LOGIN_DB_ERROR", {
        stage: "APP_PROFILE_AUTOPROVISION",
        email,
        supabaseUserId: supabaseUser.id,
        error: error?.message ?? "upsert failed"
      });
      return null;
    }

    return mapAppUserRow(data as AppUserRow);
  } catch (error) {
    console.error("AUTH_LOGIN_DB_ERROR", {
      stage: "APP_PROFILE_AUTOPROVISION",
      email,
      supabaseUserId: supabaseUser.id,
      error
    });
    return null;
  }
}

async function syncSupabaseMetadata(
  supabaseUser: SupabaseAuthUser,
  appUser: SessionUser
) {
  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    return;
  }

  const currentMetadata =
    (supabaseUser.user_metadata as Record<string, unknown> | null | undefined) ??
    {};
  const nextMetadata = {
    ...currentMetadata,
    app_user_id: appUser.id,
    full_name: appUser.fullName
  };

  const { error } = await adminClient.auth.admin.updateUserById(supabaseUser.id, {
    user_metadata: nextMetadata
  });

  if (error) {
    console.error("SUPABASE_USER_METADATA_SYNC_ERROR", {
      supabaseUserId: supabaseUser.id,
      appUserId: appUser.id,
      error: error.message
    });
  }
}

async function mapSupabaseUserToAppUser(
  supabaseUser: SupabaseAuthUser
): Promise<SessionUser | null> {
  const metadataAppUserId = readAppUserIdFromSupabaseUser(supabaseUser);
  const normalizedSupabaseEmail = normalizeEmail(supabaseUser.email);

  let appUser: SessionUser | null = null;
  if (metadataAppUserId) {
    appUser = await findSessionUserById(metadataAppUserId);
  }

  if (!appUser && normalizedSupabaseEmail) {
    appUser = await findSessionUserByEmail(normalizedSupabaseEmail);
  }

  if (!appUser && normalizedSupabaseEmail) {
    appUser = await ensureSeedSuperAdminAppProfile(normalizedSupabaseEmail);
  }

  if (!appUser) {
    appUser = await provisionAppProfileFromSupabaseUser(supabaseUser);
  }

  if (!appUser) {
    return null;
  }

  if (!metadataAppUserId || metadataAppUserId !== appUser.id) {
    await syncSupabaseMetadata(supabaseUser, appUser);
  }

  return appUser;
}

async function findSupabaseUser(input: {
  email?: string;
  appUserId?: string;
}): Promise<SupabaseAuthUser | null> {
  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    return null;
  }

  const expectedEmail = normalizeEmail(input.email);
  const expectedAppUserId = nonEmpty(input.appUserId);

  for (
    let page = 1;
    page <= MAX_SUPABASE_USER_SCAN_PAGES;
    page += 1
  ) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage: SUPABASE_USERS_PAGE_SIZE
    });

    if (error) {
      throw error;
    }

    const users = data?.users ?? [];
    const found = users.find((user: SupabaseAuthUser) => {
      const byId =
        expectedAppUserId &&
        readAppUserIdFromSupabaseUser(user) === expectedAppUserId;
      if (byId) {
        return true;
      }
      if (!expectedEmail) {
        return false;
      }
      return normalizeEmail(user.email) === expectedEmail;
    });

    if (found) {
      return found;
    }

    if (users.length < SUPABASE_USERS_PAGE_SIZE) {
      return null;
    }
  }

  return null;
}

export async function ensureSupabaseAuthUserForAppUser(input: {
  appUserId: string;
  email: string;
  fullName: string;
  password?: string;
  passwordHash?: string;
  createIfMissing?: boolean;
  syncExisting?: boolean;
}): Promise<EnsureSupabaseAuthUserResult> {
  if (!isSupabaseAuthConfigured()) {
    authConfigError("ensureSupabaseAuthUserForAppUser");
    return {
      ok: false,
      reason: "AUTH_CONFIG_ERROR",
      message: "Supabase auth is not configured"
    };
  }

  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    authConfigError("ensureSupabaseAuthUserForAppUser.client_missing");
    return {
      ok: false,
      reason: "AUTH_CONFIG_ERROR",
      message: "Supabase admin client is unavailable"
    };
  }

  const appUserId = nonEmpty(input.appUserId);
  const email = normalizeEmail(input.email);
  const fullName = nonEmpty(input.fullName) ?? input.email;
  const password = nonEmpty(input.password);
  const passwordHash = nonEmpty(input.passwordHash);
  const createIfMissing = input.createIfMissing ?? true;
  const syncExisting = input.syncExisting ?? true;

  if (!appUserId || !email) {
    return {
      ok: false,
      reason: "AUTH_BACKEND_ERROR",
      message: "appUserId and email are required"
    };
  }

  let existing: SupabaseAuthUser | null = null;
  try {
    existing = await findSupabaseUser({ appUserId, email });
  } catch (error) {
    console.error("SUPABASE_USER_FIND_ERROR", {
      appUserId,
      email,
      error
    });
    return {
      ok: false,
      reason: "AUTH_BACKEND_ERROR",
      message: "Unable to query Supabase users"
    };
  }

  if (existing) {
    const updates: {
      email?: string;
      password?: string;
      user_metadata?: Record<string, unknown>;
    } = {};

    const existingEmail = normalizeEmail(existing.email);
    if (existingEmail !== email) {
      updates.email = email;
    }

    if (password) {
      updates.password = password;
    }

    const currentMetadata =
      (existing.user_metadata as Record<string, unknown> | null | undefined) ??
      {};
    const currentAppUserId = nonEmpty(
      currentMetadata.app_user_id as string | undefined
    );
    const currentFullName = nonEmpty(
      currentMetadata.full_name as string | undefined
    );

    if (currentAppUserId !== appUserId || currentFullName !== fullName) {
      updates.user_metadata = {
        ...currentMetadata,
        app_user_id: appUserId,
        full_name: fullName
      };
    }

    if (syncExisting && Object.keys(updates).length > 0) {
      const { error } = await adminClient.auth.admin.updateUserById(
        existing.id,
        updates
      );
      if (error) {
        if (isConflictError(error)) {
          return {
            ok: false,
            reason: "CONFLICT",
            message: "Supabase user with this email already exists"
          };
        }
        console.error("SUPABASE_USER_UPDATE_ERROR", {
          appUserId,
          email,
          supabaseUserId: existing.id,
          error: error.message
        });
        return {
          ok: false,
          reason: "AUTH_BACKEND_ERROR",
          message: errorMessage(error, "Unable to update Supabase user")
        };
      }
    }

    return {
      ok: true,
      supabaseUserId: existing.id,
      created: false
    };
  }

  if (!createIfMissing) {
    return {
      ok: false,
      reason: "NOT_FOUND",
      message: "Supabase user not found"
    };
  }

  if (!password && !passwordHash) {
    return {
      ok: false,
      reason: "MISSING_PASSWORD",
      message: "password or password_hash is required to create Supabase user"
    };
  }

  const createPayload: Parameters<typeof adminClient.auth.admin.createUser>[0] = {
    email,
    email_confirm: true,
    user_metadata: {
      app_user_id: appUserId,
      full_name: fullName
    }
  };
  if (password) {
    createPayload.password = password;
  } else if (passwordHash) {
    createPayload.password_hash = passwordHash;
  }

  const { data, error } = await adminClient.auth.admin.createUser(createPayload);

  if (error || !data.user) {
    if (isConflictError(error)) {
      return {
        ok: false,
        reason: "CONFLICT",
        message: "Supabase user with this email already exists"
      };
    }
    console.error("SUPABASE_USER_CREATE_ERROR", {
      appUserId,
      email,
      error: error?.message ?? null
    });
    return {
      ok: false,
      reason: "AUTH_BACKEND_ERROR",
      message: errorMessage(error, "Unable to create Supabase user")
    };
  }

  return {
    ok: true,
    supabaseUserId: data.user.id,
    created: true
  };
}

export async function removeSupabaseAuthUser(supabaseUserId: string) {
  const normalizedId = nonEmpty(supabaseUserId);
  if (!normalizedId || !isSupabaseAuthConfigured()) {
    return;
  }

  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    return;
  }

  const { error } = await adminClient.auth.admin.deleteUser(normalizedId);
  if (error) {
    console.error("SUPABASE_USER_DELETE_ERROR", {
      supabaseUserId: normalizedId,
      error: error.message
    });
  }
}

export async function resolveSessionUserFromAccessToken(
  accessToken: string | undefined
): Promise<SessionResolveResult> {
  const token = nonEmpty(accessToken);
  if (!token) {
    return {
      ok: false,
      reason: "MISSING_SESSION"
    };
  }

  if (!isSupabaseAuthConfigured()) {
    authConfigError("resolveSessionUserFromAccessToken");
    return {
      ok: false,
      reason: "AUTH_CONFIG_ERROR"
    };
  }

  const adminClient = getSupabaseAdminClient();
  if (!adminClient) {
    authConfigError("resolveSessionUserFromAccessToken.client_missing");
    return {
      ok: false,
      reason: "AUTH_CONFIG_ERROR"
    };
  }

  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data.user) {
    if (error) {
      console.warn("AUTH_SESSION_INVALID", {
        reason: error.message
      });
    }
    return {
      ok: false,
      reason: "INVALID_SESSION"
    };
  }

  let appUser: SessionUser | null = null;
  try {
    appUser = await mapSupabaseUserToAppUser(data.user);
  } catch (mappingError) {
    console.error("AUTH_SESSION_MAP_ERROR", {
      supabaseUserId: data.user.id,
      error: mappingError
    });
    return {
      ok: false,
      reason: "AUTH_BACKEND_ERROR"
    };
  }

  if (!appUser) {
    return {
      ok: false,
      reason: "APP_PROFILE_NOT_FOUND"
    };
  }

  return {
    ok: true,
    user: appUser,
    supabaseUserId: data.user.id
  };
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPassword = password ?? "";
  if (!normalizedEmail || normalizedPassword.trim().length === 0) {
    return {
      ok: false,
      reason: "INVALID_CREDENTIALS"
    };
  }

  if (!isSupabaseAuthConfigured()) {
    authConfigError("login");
    return {
      ok: false,
      reason: "AUTH_CONFIG_ERROR"
    };
  }

  const anonClient = getSupabaseAnonClient();
  if (!anonClient) {
    authConfigError("login.client_missing");
    return {
      ok: false,
      reason: "AUTH_CONFIG_ERROR"
    };
  }

  const { data, error } = await anonClient.auth.signInWithPassword({
    email: normalizedEmail,
    password: normalizedPassword
  });

  if (error || !data.user || !data.session) {
    if (isInvalidCredentialError(error)) {
      return {
        ok: false,
        reason: "INVALID_CREDENTIALS"
      };
    }

    console.error("AUTH_LOGIN_ERROR", {
      reason: "SUPABASE_SIGNIN_FAILED",
      email: normalizedEmail,
      error: error?.message ?? null
    });
    return {
      ok: false,
      reason: "AUTH_BACKEND_ERROR"
    };
  }

  let appUser: SessionUser | null = null;
  try {
    appUser = await mapSupabaseUserToAppUser(data.user);
  } catch (mappingError) {
    console.error("AUTH_LOGIN_ERROR", {
      reason: "APP_USER_MAPPING_FAILED",
      email: normalizedEmail,
      error: mappingError
    });
    return {
      ok: false,
      reason: "AUTH_BACKEND_ERROR"
    };
  }

  if (!appUser) {
    return {
      ok: false,
      reason: "APP_PROFILE_NOT_FOUND"
    };
  }

  if (appUser.status === "PENDING") {
    return {
      ok: false,
      reason: "ACCOUNT_PENDING",
      userId: appUser.id
    };
  }

  if (appUser.status === "SUSPENDED") {
    return {
      ok: false,
      reason: "ACCOUNT_SUSPENDED",
      userId: appUser.id
    };
  }

  try {
    const adminClient = getSupabaseAdminClient();
    if (adminClient) {
      await adminClient
        .from("users")
        .update({ last_login_at: new Date().toISOString() })
        .eq("id", appUser.id);
    }
  } catch (updateError) {
    console.error("login_last_login_update_failed", {
      userId: appUser.id,
      error: updateError
    });
  }

  const refreshToken = nonEmpty(data.session.refresh_token);
  if (!refreshToken) {
    console.error("AUTH_LOGIN_ERROR", {
      reason: "SUPABASE_REFRESH_TOKEN_EMPTY",
      userId: appUser.id
    });
    return {
      ok: false,
      reason: "AUTH_BACKEND_ERROR",
      userId: appUser.id
    };
  }

  return {
    ok: true,
    user: toPublicUser(appUser),
    accessToken: data.session.access_token,
    refreshToken
  };
}

export async function rotateRefreshToken(refreshToken: string) {
  const token = nonEmpty(refreshToken);
  if (!token) {
    return null;
  }

  if (!isSupabaseAuthConfigured()) {
    authConfigError("rotateRefreshToken");
    return null;
  }

  const anonClient = getSupabaseAnonClient();
  if (!anonClient) {
    authConfigError("rotateRefreshToken.client_missing");
    return null;
  }

  const { data, error } = await anonClient.auth.refreshSession({
    refresh_token: token
  });

  if (error || !data.user || !data.session) {
    return null;
  }

  const appUser = await mapSupabaseUserToAppUser(data.user);
  if (!appUser || appUser.status !== "ACTIVE") {
    return null;
  }

  const nextRefreshToken = nonEmpty(data.session.refresh_token) ?? token;
  return {
    user: toPublicUser(appUser),
    accessToken: data.session.access_token,
    refreshToken: nextRefreshToken
  };
}

export async function revokeRefreshToken(refreshToken: string | undefined) {
  void refreshToken;
  return;
}

export async function revokeAllUserRefreshSessions(userId: string) {
  void userId;
  return;
}

export async function changePassword(params: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}) {
  if (!isSupabaseAuthConfigured()) {
    authConfigError("changePassword");
    return null;
  }

  const appUser = await findSessionUserById(params.userId);
  if (!appUser || appUser.status !== "ACTIVE") {
    return null;
  }

  const anonClient = getSupabaseAnonClient();
  const adminClient = getSupabaseAdminClient();
  if (!anonClient || !adminClient) {
    authConfigError("changePassword.client_missing");
    return null;
  }

  const verify = await anonClient.auth.signInWithPassword({
    email: appUser.email,
    password: params.currentPassword
  });

  if (verify.error || !verify.data.user) {
    return null;
  }

  const updated = await adminClient.auth.admin.updateUserById(verify.data.user.id, {
    password: params.newPassword
  });

  if (updated.error) {
    console.error("AUTH_PASSWORD_CHANGE_ERROR", {
      userId: appUser.id,
      supabaseUserId: verify.data.user.id,
      error: updated.error.message
    });
    return null;
  }

  const relogin = await anonClient.auth.signInWithPassword({
    email: appUser.email,
    password: params.newPassword
  });

  if (relogin.error || !relogin.data.user || !relogin.data.session) {
    return null;
  }

  const mappedUser = await mapSupabaseUserToAppUser(relogin.data.user);
  if (!mappedUser || mappedUser.status !== "ACTIVE") {
    return null;
  }

  const newRefreshToken = nonEmpty(relogin.data.session.refresh_token);
  if (!newRefreshToken) {
    return null;
  }

  return {
    user: toPublicUser(mappedUser),
    accessToken: relogin.data.session.access_token,
    refreshToken: newRefreshToken
  };
}
