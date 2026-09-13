const PREFIX = 'imaginewiki:v1:';

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

/** Memoizes an async loader in localStorage. Storage failures fall back to loading every time. */
export async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw) {
      const entry = JSON.parse(raw) as { time: number; value: T };
      if (Date.now() - entry.time < ttl) return entry.value;
    }
  } catch {
    // Storage unavailable or corrupt entry.
  }
  const value = await load();
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ time: Date.now(), value }));
  } catch {
    // Quota exceeded or storage blocked.
  }
  return value;
}
