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

function normalizeRole(rawRole: string): UserRole | null {
  const role = rawRole.trim().toUpperCase();
  if (role === "SUPER_ADMIN") return "SUPER_ADMIN";
  if (role === "ADMIN") return "ADMIN";
  if (role === "MANAGER" || role === "DISTRICT_MANAGER") return "MANAGER";
  if (role === "EXECUTIVE" || role === "FIELD_EXECUTIVE") return "EXECUTIVE";
  return null;
}

function normalizeStatus(rawStatus: string): UserStatus | null {
  const status = rawStatus.trim().toUpperCase();
  if (status === "ACTIVE") return "ACTIVE";
  if (status === "PENDING") return "PENDING";
  if (status === "SUSPENDED") return "SUSPENDED";
  return null;
}

async function findLoginUserByEmail(email: string): Promise<LoginUser | null> {
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
    console.error("login_find_user_failed", { email, error });
  }

  try {
    const fallbackRows = await prisma.$queryRaw<
      Array<{
        id: string;
        email: string;
        fullName: string;
        role: string;
        status: string;
        passwordHash: string | null;
      }>
    >`
      SELECT
        id::text AS "id",
        email,
        full_name AS "fullName",
        role::text AS "role",
        status::text AS "status",
        password_hash AS "passwordHash"
      FROM users
      WHERE email = ${email}
      LIMIT 1
    `;

    const row = fallbackRows[0];
    if (!row || !row.passwordHash) return null;

    const role = normalizeRole(row.role);
    const status = normalizeStatus(row.status);
    if (!role || !status) {
      console.error("login_user_enum_mismatch", {
        email: row.email,
        role: row.role,
        status: row.status
      });
      return null;
    }

    return {
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      role,
      status,
      passwordHash: row.passwordHash
    };
  } catch (error) {
    console.error("login_fallback_query_failed", { email, error });
    throw error;
  }
}

async function findSessionUserById(userId: string): Promise<SessionUser | null> {
  try {
    return await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, fullName: true, role: true, status: true }
    });
  } catch (error) {
    console.error("session_find_user_failed", { userId, error });
  }

  try {
    const fallbackRows = await prisma.$queryRaw<
      Array<{
        id: string;
        email: string;
        fullName: string;
        role: string;
        status: string;
      }>
    >`
      SELECT
        id::text AS "id",
        email,
        full_name AS "fullName",
        role::text AS "role",
        status::text AS "status"
      FROM users
      WHERE id = ${userId}::uuid
      LIMIT 1
    `;

    const row = fallbackRows[0];
    if (!row) return null;

    const role = normalizeRole(row.role);
    const status = normalizeStatus(row.status);
    if (!role || !status) {
      console.error("session_user_enum_mismatch", {
        userId: row.id,
        role: row.role,
        status: row.status
      });
      return null;
    }

    return {
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      role,
      status
    };
  } catch (error) {
    console.error("session_fallback_query_failed", { userId, error });
    throw error;
  }
}

export type LoginFailureReason =
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_PENDING"
  | "ACCOUNT_SUSPENDED";

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
  const payload: AccessPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    typ: "access"
  };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
}

function signRefreshToken(user: { id: string; email: string; role: UserRole }, jti: string) {
  const payload: RefreshPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    typ: "refresh",
    jti
  };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_TTL_SECONDS });
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
  const user = await findLoginUserByEmail(email);

  if (!user) {
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  }

  // Some older or manually seeded records may contain an invalid hash shape.
  // Treat those as invalid credentials instead of throwing a 500.
  let passwordOk = false;
  try {
    passwordOk = await bcrypt.compare(password, user.passwordHash);
  } catch (error) {
    console.error("password_compare_failed", {
      userId: user.id,
      error
    });
    return { ok: false, reason: "INVALID_CREDENTIALS", userId: user.id };
  }
  if (!passwordOk) {
    return { ok: false, reason: "INVALID_CREDENTIALS", userId: user.id };
  }

  if (user.status === "PENDING") {
    return { ok: false, reason: "ACCOUNT_PENDING", userId: user.id };
  }

  if (user.status === "SUSPENDED") {
    return { ok: false, reason: "ACCOUNT_SUSPENDED", userId: user.id };
  }

  try {
    await maybeUpgradePasswordHash(user.id, password, user.passwordHash);
  } catch (error) {
    console.error("password_hash_upgrade_failed", {
      userId: user.id,
      error
    });
  }
  const tokens = await createTokenPair(user);

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
  try {
    const payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as RefreshPayload;
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
  return {
    user: toPublicUser(user),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken
  };
}
