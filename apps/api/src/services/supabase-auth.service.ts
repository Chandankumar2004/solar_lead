import { UserRole, UserStatus } from "@prisma/client";
import type { User as SupabaseAuthUser } from "@supabase/supabase-js";
import { prisma, prismaAuthFallback } from "../lib/prisma.js";
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

function toPublicUser(user: SessionUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    status: user.status
  };
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

  try {
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true, fullName: true, role: true, status: true }
    });
    if (user) {
      return user;
    }
  } catch (error) {
    console.error("AUTH_LOGIN_DB_ERROR", {
      stage: "SESSION_USER_EMAIL_LOOKUP",
      email: normalizedEmail,
      error
    });
  }

  if (prismaAuthFallback !== prisma) {
    try {
      return await prismaAuthFallback.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true, email: true, fullName: true, role: true, status: true }
      });
    } catch (error) {
      console.error("AUTH_LOGIN_DB_ERROR", {
        stage: "SESSION_USER_EMAIL_LOOKUP_ALTERNATE",
        email: normalizedEmail,
        error
      });
    }
  }

  return null;
}

export async function findSessionUserById(userId: string): Promise<SessionUser | null> {
  if (!nonEmpty(userId)) {
    return null;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, fullName: true, role: true, status: true }
    });
    if (user) {
      return user;
    }
  } catch (error) {
    console.error("AUTH_LOGIN_DB_ERROR", {
      stage: "SESSION_USER_ID_LOOKUP",
      userId,
      error
    });
  }

  if (prismaAuthFallback !== prisma) {
    try {
      return await prismaAuthFallback.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, fullName: true, role: true, status: true }
      });
    } catch (error) {
      console.error("AUTH_LOGIN_DB_ERROR", {
        stage: "SESSION_USER_ID_LOOKUP_ALTERNATE",
        userId,
        error
      });
    }
  }

  return null;
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
    await prisma.user.update({
      where: { id: appUser.id },
      data: { lastLoginAt: new Date() }
    });
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

export async function revokeRefreshToken(_refreshToken: string | undefined) {
  return;
}

export async function revokeAllUserRefreshSessions(_userId: string) {
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
