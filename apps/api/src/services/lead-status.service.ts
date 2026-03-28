import { prisma } from "../lib/prisma.js";

const STATUS_CACHE_TTL_MS = 60_000;
const TRANSITION_CACHE_TTL_MS = 30_000;

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const statusCache = new Map<string, CacheEntry<{ id: string; name: string } | null>>();
const transitionCache = new Map<string, CacheEntry<boolean>>();

function readCache<T>(cache: Map<string, CacheEntry<T>>, key: string) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function writeCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
}

export async function assertValidTransition(
  fromStatusId: string,
  toStatusId: string
) {
  const cacheKey = `${fromStatusId}:${toStatusId}`;
  const cached = readCache(transitionCache, cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const allowed = await prisma.leadStatusTransition.findFirst({
    where: {
      fromStatusId,
      toStatusId
    }
  });
  const result = Boolean(allowed);
  writeCache(transitionCache, cacheKey, result, TRANSITION_CACHE_TTL_MS);
  return result;
}

async function findFirstStatusByNames(names: string[]) {
  const cacheKey = names.map((name) => name.toLowerCase()).join("|");
  const cached = readCache(statusCache, cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const statuses = await prisma.leadStatus.findMany({
    where: {
      OR: names.map((name) => ({
        name: { equals: name, mode: "insensitive" }
      }))
    },
    select: {
      id: true,
      name: true
    }
  });

  if (!statuses.length) {
    writeCache(statusCache, cacheKey, null, STATUS_CACHE_TTL_MS);
    return null;
  }

  for (const candidate of names) {
    const exact = statuses.find(
      (status) => status.name.toLowerCase() === candidate.toLowerCase()
    );
    if (exact) {
      writeCache(statusCache, cacheKey, exact, STATUS_CACHE_TTL_MS);
      return exact;
    }
  }

  writeCache(statusCache, cacheKey, statuses[0], STATUS_CACHE_TTL_MS);
  return statuses[0];
}

export async function getNewLeadStatus() {
  return findFirstStatusByNames(["New", "New Lead"]);
}

export async function getAssignedLeadStatus() {
  return findFirstStatusByNames(["Assigned", "Assigned Lead"]);
}

export async function getTokenPaymentVerifiedStatus() {
  return findFirstStatusByNames([
    "Token Payment Verified",
    "Token Verified",
    "Payment Verified"
  ]);
}

export async function getTokenPaymentReceivedStatus() {
  return findFirstStatusByNames([
    "Token Amount Received (INR 1000)",
    "Token Amount Received",
    "Token Payment Received"
  ]);
}

export async function getTokenPaymentVerificationPendingStatus() {
  return findFirstStatusByNames([
    "Token Payment Verification Pending",
    "Token Verification Pending",
    "Payment Verification Pending"
  ]);
}
