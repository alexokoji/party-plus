const STORAGE_KEY = "party-plus.deviceId";

/**
 * Persistent anonymous identity for this browser.
 *
 * v1 has no accounts, but a player still has to survive a refresh and keep
 * their seat and dice — the room DO keys seats off this id, so losing it
 * means losing the game in progress. Stored rather than regenerated for
 * exactly that reason.
 */
export function getDeviceId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    window.localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // Private browsing with storage disabled: fall back to a per-tab id so
    // play still works, accepting that a refresh starts a new identity.
    return crypto.randomUUID();
  }
}

/** Short, readable form for showing a player who they are at the table. */
export function shortId(deviceId: string): string {
  return deviceId.slice(0, 4).toUpperCase();
}

const NAME_KEY = "party-plus.displayName";

/** Display name for this browser, remembered between visits. */
export function getDisplayName(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setDisplayName(name: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    // Storage unavailable (private mode): the name still applies this session,
    // it just won't be remembered next visit.
  }
}
