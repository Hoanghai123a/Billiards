type CacheEntry<T> = { savedAt: number; value: T };

export function readSessionCache<T>(key: string, maxAgeMs: number): T | null {
  try {
    const entry = JSON.parse(sessionStorage.getItem(key) || "null") as CacheEntry<T> | null;
    return entry && Date.now() - entry.savedAt <= maxAgeMs ? entry.value : null;
  } catch {
    return null;
  }
}

export function writeSessionCache<T>(key: string, value: T) {
  try { sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value })); }
  catch { /* Cache is optional when storage is unavailable. */ }
}

export function removeSessionCache(key: string) {
  try { sessionStorage.removeItem(key); } catch { /* Cache is optional when storage is unavailable. */ }
}

export function clearSessionCachePrefix(prefix: string) {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
    }
  } catch { /* Cache is optional when storage is unavailable. */ }
}

export function clearLocalStoragePrefix(prefix: string) {
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) localStorage.removeItem(key);
    }
  } catch { /* Cache is optional when storage is unavailable. */ }
}
