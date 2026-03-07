import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { UserRole } from "@prisma/client";
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
  status: "ACTIVE" | "PENDING" | "SUSPENDED";
};

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
  const user = await prisma.user.findUnique({
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

  if (!user) {
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  }

  const passwordOk = await bcrypt.compare(password, user.passwordHash);
  if (!passwordOk) {
    return { ok: false, reason: "INVALID_CREDENTIALS", userId: user.id };
  }

  if (user.status === "PENDING") {
    return { ok: false, reason: "ACCOUNT_PENDING", userId: user.id };
  }

  if (user.status === "SUSPENDED") {
    return { ok: false, reason: "ACCOUNT_SUSPENDED", userId: user.id };
  }

  await maybeUpgradePasswordHash(user.id, password, user.passwordHash);
  const tokens = await createTokenPair(user);

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() }
  });

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

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, fullName: true, role: true, status: true }
  });
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
