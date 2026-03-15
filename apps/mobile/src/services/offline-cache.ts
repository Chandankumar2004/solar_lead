import AsyncStorage from "@react-native-async-storage/async-storage";

const CACHE_PREFIX = "mobile.offline.cache.v1";

function buildCacheKey(ownerUserId: string, key: string) {
  return `${CACHE_PREFIX}:${ownerUserId}:${key}`;
}

export async function readOfflineCache<T>(ownerUserId: string, key: string): Promise<T | null> {
  if (!ownerUserId) return null;
  const raw = await AsyncStorage.getItem(buildCacheKey(ownerUserId, key));
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeOfflineCache<T>(
  ownerUserId: string,
  key: string,
  value: T
) {
  if (!ownerUserId) return;
  await AsyncStorage.setItem(buildCacheKey(ownerUserId, key), JSON.stringify(value));
}

export async function clearOfflineCacheForOwner(ownerUserId: string) {
  if (!ownerUserId) return;
  const keys = await AsyncStorage.getAllKeys();
  const toRemove = keys.filter((key) => key.startsWith(`${CACHE_PREFIX}:${ownerUserId}:`));
  if (toRemove.length > 0) {
    await AsyncStorage.multiRemove(toRemove);
  }
}
