import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const BCRYPT_WORK_FACTOR = 12;
const memoryRefreshStore = new Map<string, { hash: string; expiresAt: number }>();

type TokenBasePayload = {
  sub: string;
  email: string;
  role: UserRole;
};

type RefreshPayload = TokenBasePayload & {
  typ: "refresh";
  jti: string;
};

type AccessPayload = TokenBasePayload & {
  typ: "access";
};

type PublicUser = {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
};

type LoginUser = {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  passwordHash: string;
};

type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
};

type LooseDbRow = Record<string, unknown>;

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readFirstString(row: LooseDbRow, keys: string[]): string | null {
  for (const key of keys) {
    const value = toNonEmptyString(row[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function resolveAccessSecret() {
  const secret = (env.JWT_ACCESS_SECRET ?? process.env.JWT_ACCESS_SECRET ?? "").trim();
  return secret.length >= 16 ? secret : null;
}

function resolveRefreshSecret() {
  const secret = (env.JWT_REFRESH_SECRET ?? process.env.JWT_REFRESH_SECRET ?? "").trim();
  return secret.length >= 16 ? secret : null;
}

function normalizeRole(rawRole: string): UserRole | null {
  const role = rawRole.trim().toUpperCase();
  if (role === "SUPER_ADMIN") return "SUPER_ADMIN";
  if (role === "SUPERADMIN") return "SUPER_ADMIN";
  if (role === "SUPER-ADMIN") return "SUPER_ADMIN";
  if (role === "ADMIN") return "ADMIN";
  if (role === "MANAGER" || role === "DISTRICT_MANAGER") return "MANAGER";
  if (role === "DISTRICT-MANAGER" || role === "DISTRICTMANAGER") return "MANAGER";
  if (role === "EXECUTIVE" || role === "FIELD_EXECUTIVE") return "EXECUTIVE";
  if (role === "FIELD-EXECUTIVE" || role === "FIELDEXECUTIVE") return "EXECUTIVE";
  return null;
}

function normalizeStatus(rawStatus: string): UserStatus | null {
  const status = rawStatus.trim().toUpperCase();
  if (status === "ACTIVE") return "ACTIVE";
  if (status === "PENDING") return "PENDING";
  if (status === "SUSPENDED") return "SUSPENDED";
  return null;
}

async function queryFallbackUserRowByEmail(email: string): Promise<LooseDbRow | null> {
  const variants: Array<{ name: string; run: () => Promise<Array<LooseDbRow>> }> = [
    {
      name: "users_table",
      run: () =>
        prisma.$queryRaw<Array<LooseDbRow>>`
          SELECT *
          FROM public.users
          WHERE lower(email) = lower(${email})
          LIMIT 1
        `
    },
    {
      name: "User_table",
      run: () =>
        prisma.$queryRaw<Array<LooseDbRow>>`
          SELECT *
          FROM public."User"
          WHERE lower("email") = lower(${email})
          LIMIT 1
        `
    }
  ];

  let lastError: unknown = null;
  for (const variant of variants) {
    try {
      const rows = await variant.run();
      if (rows[0]) {
        return rows[0];
      }
    } catch (error) {
      lastError = error;
      console.error("AUTH_LOGIN_DB_ERROR", {
        stage: "LOGIN_USER_FALLBACK_EMAIL_LOOKUP",
        variant: variant.name,
        email,
        error
      });
    }
  }

  if (lastError) {
    throw lastError;
  }
  return null;
}

async function queryFallbackUserRowById(userId: string): Promise<LooseDbRow | null> {
  const variants: Array<{ name: string; run: () => Promise<Array<LooseDbRow>> }> = [
    {
      name: "users_table",
      run: () =>
        prisma.$queryRaw<Array<LooseDbRow>>`
          SELECT *
          FROM public.users
          WHERE id::text = ${userId}
          LIMIT 1
        `
    },
    {
      name: "User_table",
      run: () =>
        prisma.$queryRaw<Array<LooseDbRow>>`
          SELECT *
          FROM public."User"
          WHERE "id"::text = ${userId}
          LIMIT 1
        `
    }
  ];

  for (const variant of variants) {
    try {
      const rows = await variant.run();
      if (rows[0]) {
        return rows[0];
      }
    } catch (error) {
      console.error("AUTH_LOGIN_DB_ERROR", {
        stage: "SESSION_USER_FALLBACK_ID_LOOKUP",
        variant: variant.name,
        userId,
        error
      });
    }
  }
  return null;
}

async function findLoginUserByEmail(email: string): Promise<LoginUser | null> {
  let primaryLookupFailed = false;

  try {
    return await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        status: true,
        passwordHash: true
      }
    });
  } catch (error) {
    primaryLookupFailed = true;
    console.error("AUTH_LOGIN_DB_ERROR", {
      stage: "LOGIN_USER_PRISMA_LOOKUP",
      email,
      error
    });
  }

  try {
    const row = await queryFallbackUserRowByEmail(email);
    if (!row) return null;

    const id = readFirstString(row, ["id", "ID", "user_id", "userId"]);
    const resolvedEmail = readFirstString(row, ["email", "Email", "EMAIL"]);
    const fullName =
      readFirstString(row, ["full_name", "fullName", "fullname", "name"]) ?? resolvedEmail;
    const passwordHash = readFirstString(row, [
      "password_hash",
      "passwordHash",
      "password",
      "pwd_hash"
    ]);
    const rawRole = readFirstString(row, ["role", "user_role", "userRole"]);
    const rawStatus = readFirstString(row, ["status", "user_status", "userStatus"]);

    if (!id || !resolvedEmail || !fullName || !passwordHash || !rawRole || !rawStatus) {
      console.error("login_user_row_missing_required_fields", {
        email,
        hasId: Boolean(id),
        hasEmail: Boolean(resolvedEmail),
        hasFullName: Boolean(fullName),
        hasPasswordHash: Boolean(passwordHash),
        hasRole: Boolean(rawRole),
        hasStatus: Boolean(rawStatus)
      });
      return null;
    }

    const role = normalizeRole(rawRole);
    const status = normalizeStatus(rawStatus);
    if (!role || !status) {
      console.error("login_user_enum_mismatch", {
        email: resolvedEmail,
        role: rawRole,
        status: rawStatus
      });
      return null;
    }

    return {
      id,
      email: resolvedEmail,
      fullName,
      role,
      status,
      passwordHash
    };
  } catch (error) {
    console.error("AUTH_LOGIN_DB_ERROR", {
      stage: "LOGIN_USER_FALLBACK_LOOKUP",
      email,
      error
    });
    if (primaryLookupFailed) {
      throw error;
    }
    return null;
  }
}

async function findSessionUserById(userId: string): Promise<SessionUser | null> {
  try {
    return await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, fullName: true, role: true, status: true }
    });
  } catch (error) {
    console.error("AUTH_LOGIN_DB_ERROR", {
      stage: "SESSION_USER_PRISMA_LOOKUP",
      userId,
      error
    });
  }

  try {
    const row = await queryFallbackUserRowById(userId);
    if (!row) return null;

    const id = readFirstString(row, ["id", "ID", "user_id", "userId"]);
    const email = readFirstString(row, ["email", "Email", "EMAIL"]);
    const fullName = readFirstString(row, ["full_name", "fullName", "fullname", "name"]) ?? email;
    const rawRole = readFirstString(row, ["role", "user_role", "userRole"]);
    const rawStatus = readFirstString(row, ["status", "user_status", "userStatus"]);

    if (!id || !email || !fullName || !rawRole || !rawStatus) {
      console.error("session_user_row_missing_required_fields", {
        userId,
        hasId: Boolean(id),
        hasEmail: Boolean(email),
        hasFullName: Boolean(fullName),
        hasRole: Boolean(rawRole),
        hasStatus: Boolean(rawStatus)
      });
      return null;
    }

    const role = normalizeRole(rawRole);
    const status = normalizeStatus(rawStatus);
    if (!role || !status) {
      console.error("session_user_enum_mismatch", {
        userId: id,
        role: rawRole,
        status: rawStatus
      });
      return null;
    }

    return {
      id,
      email,
      fullName,
      role,
      status
    };
  } catch (error) {
    console.error("AUTH_LOGIN_DB_ERROR", {
      stage: "SESSION_USER_FALLBACK_LOOKUP",
      userId,
      error
    });
    return null;
  }
}

export type LoginFailureReason =
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_PENDING"
  | "ACCOUNT_SUSPENDED"
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

function signAccessToken(user: { id: string; email: string; role: UserRole }) {
  const secret = resolveAccessSecret();
  if (!secret) {
    return null;
  }
  const payload: AccessPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    typ: "access"
  };
  return jwt.sign(payload, secret, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
}

function signRefreshToken(user: { id: string; email: string; role: UserRole }, jti: string) {
  const secret = resolveRefreshSecret();
  if (!secret) {
    return null;
  }
  const payload: RefreshPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    typ: "refresh",
    jti
  };
  return jwt.sign(payload, secret, { expiresIn: REFRESH_TOKEN_TTL_SECONDS });
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function refreshStoreKey(userId: string, jti: string) {
  return `auth:refresh:${userId}:${jti}`;
}

function setMemoryRefreshToken(key: string, hash: string, ttlSeconds: number) {
  memoryRefreshStore.set(key, {
    hash,
    expiresAt: Date.now() + ttlSeconds * 1000
  });
}

function getMemoryRefreshToken(key: string) {
  const value = memoryRefreshStore.get(key);
  if (!value) return null;
  if (value.expiresAt <= Date.now()) {
    memoryRefreshStore.delete(key);
    return null;
  }
  return value.hash;
}

function deleteMemoryRefreshTokens(keys: string[]) {
  for (const key of keys) {
    memoryRefreshStore.delete(key);
  }
}

async function setRefreshTokenStore(key: string, hash: string, ttlSeconds: number) {
  setMemoryRefreshToken(key, hash, ttlSeconds);
}

async function getRefreshTokenStore(key: string) {
  return getMemoryRefreshToken(key);
}

async function deleteRefreshTokenStore(keys: string[]) {
  if (!keys.length) return;
  deleteMemoryRefreshTokens(keys);
}

async function listRefreshTokenKeysForUser(userId: string) {
  const match = `auth:refresh:${userId}:*`;
  return [...memoryRefreshStore.keys()].filter((key) => key.startsWith(match.slice(0, -1)));
}

async function createTokenPair(user: { id: string; email: string; role: UserRole }) {
  const accessToken = signAccessToken(user);
  const jti = randomUUID();
  const refreshToken = signRefreshToken(user, jti);
  if (!accessToken || !refreshToken) {
    return null;
  }
  await setRefreshTokenStore(
    refreshStoreKey(user.id, jti),
    hashToken(refreshToken),
    REFRESH_TOKEN_TTL_SECONDS
  );
  return { accessToken, refreshToken };
}

function toPublicUser(user: {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: "ACTIVE" | "PENDING" | "SUSPENDED";
}): PublicUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    status: user.status
  };
}

async function maybeUpgradePasswordHash(userId: string, plainPassword: string, hash: string) {
  const rounds = Number(hash.split("$")[2] ?? 0);
  if (Number.isFinite(rounds) && rounds < BCRYPT_WORK_FACTOR) {
    const strongerHash = await bcrypt.hash(plainPassword, BCRYPT_WORK_FACTOR);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: strongerHash }
    });
  }
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedPassword = password ?? "";
  if (!normalizedEmail || !normalizedPassword) {
    console.warn("AUTH_LOGIN_ERROR", {
      reason: "MISSING_EMAIL_OR_PASSWORD",
      email: normalizedEmail || null
    });
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  }

  let user: LoginUser | null = null;
  try {
    user = await findLoginUserByEmail(normalizedEmail);
  } catch (error) {
    console.error("AUTH_LOGIN_DB_ERROR", {
      stage: "LOGIN_USER_LOOKUP",
      email: normalizedEmail,
      error
    });
    console.error("AUTH_LOGIN_ERROR", {
      reason: "USER_LOOKUP_FAILED",
      email: normalizedEmail,
      error
    });
    return { ok: false, reason: "AUTH_BACKEND_ERROR" };
  }

  if (!user) {
    console.warn("AUTH_LOGIN_USER_NOT_FOUND", {
      email: normalizedEmail
    });
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  }

  if (!user.passwordHash || user.passwordHash.trim().length === 0) {
    console.error("AUTH_LOGIN_ERROR", {
      reason: "PASSWORD_HASH_MISSING",
      userId: user.id
    });
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  }

  // Some older or manually seeded records may contain an invalid hash shape.
  // Treat those as invalid credentials instead of throwing a 500.
  let passwordOk = false;
  try {
    passwordOk = await bcrypt.compare(normalizedPassword, user.passwordHash);
  } catch (error) {
    console.error("AUTH_LOGIN_ERROR", {
      reason: "BCRYPT_COMPARE_FAILED",
      userId: user.id,
      error
    });
    return { ok: false, reason: "INVALID_CREDENTIALS", userId: user.id };
  }
  if (!passwordOk) {
    console.warn("AUTH_LOGIN_PASSWORD_MISMATCH", {
      userId: user.id,
      email: normalizedEmail
    });
    return { ok: false, reason: "INVALID_CREDENTIALS", userId: user.id };
  }

  if (user.status === "PENDING") {
    return { ok: false, reason: "ACCOUNT_PENDING", userId: user.id };
  }

  if (user.status === "SUSPENDED") {
    return { ok: false, reason: "ACCOUNT_SUSPENDED", userId: user.id };
  }

  try {
    await maybeUpgradePasswordHash(user.id, normalizedPassword, user.passwordHash);
  } catch (error) {
    console.error("AUTH_LOGIN_DB_ERROR", {
      stage: "PASSWORD_HASH_UPGRADE",
      userId: user.id,
      error
    });
  }
  const tokens = await createTokenPair(user);
  if (!tokens) {
    console.error("AUTH_LOGIN_JWT_CONFIG_ERROR", {
      userId: user.id,
      reason: "JWT_SECRET_MISSING_OR_INVALID"
    });
    return { ok: false, reason: "AUTH_CONFIG_ERROR", userId: user.id };
  }

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });
  } catch (error) {
    console.error("login_last_login_update_failed", {
      userId: user.id,
      error
    });
  }

  return {
    ok: true,
    user: toPublicUser(user),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken
  };
}

function verifyRefresh(refreshToken: string): RefreshPayload | null {
  const secret = resolveRefreshSecret();
  if (!secret) return null;
  try {
    const payload = jwt.verify(refreshToken, secret) as RefreshPayload;
    if (payload.typ !== "refresh" || !payload.jti || !payload.sub) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function rotateRefreshToken(refreshToken: string) {
  const payload = verifyRefresh(refreshToken);
  if (!payload) return null;

  const existingHash = await getRefreshTokenStore(refreshStoreKey(payload.sub, payload.jti));
  if (!existingHash || existingHash !== hashToken(refreshToken)) {
    return null;
  }

  const user = await findSessionUserById(payload.sub);
  if (!user || user.status !== "ACTIVE") {
    return null;
  }

  await deleteRefreshTokenStore([refreshStoreKey(payload.sub, payload.jti)]);
  const tokens = await createTokenPair(user);
  if (!tokens) {
    return null;
  }

  return {
    user: toPublicUser(user),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken
  };
}

export async function revokeRefreshToken(refreshToken: string | undefined) {
  if (!refreshToken) return;
  const payload = verifyRefresh(refreshToken);
  if (!payload) return;
  await deleteRefreshTokenStore([refreshStoreKey(payload.sub, payload.jti)]);
}

export async function revokeAllUserRefreshSessions(userId: string) {
  const keys = await listRefreshTokenKeysForUser(userId);
  if (keys.length) {
    await deleteRefreshTokenStore(keys);
  }
}

export async function changePassword(params: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}) {
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, email: true, fullName: true, role: true, status: true, passwordHash: true }
  });
  if (!user || user.status !== "ACTIVE") return null;

  const currentOk = await bcrypt.compare(params.currentPassword, user.passwordHash);
  if (!currentOk) return null;

  const newHash = await bcrypt.hash(params.newPassword, BCRYPT_WORK_FACTOR);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: newHash }
  });
  await revokeAllUserRefreshSessions(user.id);

  const tokens = await createTokenPair(user);
  if (!tokens) return null;
  return {
    user: toPublicUser(user),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken
  };
}
