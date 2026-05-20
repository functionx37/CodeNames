const nicknameKey = "codenames:nickname";
const tokenKey = "codenames:player-token";

export function loadNickname(): string {
  return localStorage.getItem(nicknameKey) || "";
}

export function saveNickname(value: string): void {
  localStorage.setItem(nicknameKey, value);
}

export function loadPlayerToken(): string {
  const existing = localStorage.getItem(tokenKey);
  if (existing) {
    return existing;
  }

  const created = `player_${crypto.randomUUID()}`;
  localStorage.setItem(tokenKey, created);
  return created;
}

export function savePlayerToken(value: string): void {
  localStorage.setItem(tokenKey, value);
}
