/**
 * localStorage writes that wait until edits settle (a drag, a slider, typing),
 * skip ones that wouldn't change what's stored, and flush before the window
 * goes away.
 */

/** Save once nothing has changed for this long. */
const SETTLE_MS = 500;

/** Values to save, built only when saved. */
const pending = new Map<string, () => string>();
let timer: ReturnType<typeof setTimeout> | undefined;

/** Write everything pending now. */
export function flushSaves() {
  clearTimeout(timer);
  timer = undefined;
  for (const [key, value] of pending) {
    try {
      const text = value();
      if (localStorage.getItem(key) !== text) localStorage.setItem(key, text);
    } catch {
      // Saving is best effort: storage may be full or unavailable.
    }
  }
  pending.clear();
}

/** Save `value()` under `key` once edits settle. */
export function saveLater(key: string, value: () => string) {
  pending.set(key, value);
  clearTimeout(timer);
  timer = setTimeout(flushSaves, SETTLE_MS);
}

/** What's saved under `key`, counting a save still waiting. */
export function readSaved(key: string): string | null {
  const value = pending.get(key);
  if (value) return value();
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function forget(key: string) {
  pending.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to forget.
  }
}

// The window may close any time after it's hidden or loses focus.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushSaves);
  window.addEventListener("beforeunload", flushSaves);
  window.addEventListener("blur", flushSaves);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSaves();
  });
}
