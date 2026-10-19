import { readJson, removeKey, writeJson } from "~/lib/storage";

export interface StoredAuth {
  token: string;
  user: { id: string; name: string; displayName?: string };
}

const KEY = "enjoy-web.auth";
let memory: StoredAuth | null = null;

function isStoredAuth(value: unknown): value is StoredAuth {
  const a = value as StoredAuth;
  return (
    !!a && typeof a.token === "string" && a.token.length > 0 &&
    !!a.user && typeof a.user.id === "string" && typeof a.user.name === "string"
  );
}

export function loadAuth(): StoredAuth | null {
  return readJson(KEY, isStoredAuth) ?? memory;
}

export function saveAuth(auth: StoredAuth): void {
  memory = auth;
  writeJson(KEY, auth);
}

export function clearAuth(): void {
  memory = null;
  removeKey(KEY);
}
