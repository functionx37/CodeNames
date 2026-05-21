const nicknameKey = "codenames:nickname";
const tokenKey = "codenames:player-token";
const fallbackStorage = new Map<string, string>();

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return fallbackStorage.get(key) ?? null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
    return;
  } catch {
    fallbackStorage.set(key, value);
  }
}

function generateTokenSuffix(): string {
  if (typeof crypto !== "undefined") {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }

    if (typeof crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
  }

  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export function loadNickname(): string {
  return safeGetItem(nicknameKey) || "";
}

export function saveNickname(value: string): void {
  safeSetItem(nicknameKey, value);
}

export function loadPlayerToken(): string {
  const existing = safeGetItem(tokenKey);
  if (existing) {
    return existing;
  }

  const created = `player_${generateTokenSuffix()}`;
  safeSetItem(tokenKey, created);
  return created;
}

export function savePlayerToken(value: string): void {
  safeSetItem(tokenKey, value);
}
