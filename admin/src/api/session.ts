import { useSyncExternalStore } from "react";

const KEY = "admin.session";

export interface Session {
  token: string;
  expires_at: string;
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** sessionStorage 不可用(无痕/被禁用)时回退到内存。 */
let memory: Session | null = null;

function expired(session: Session): boolean {
  const t = Date.parse(session.expires_at);
  return Number.isFinite(t) && t <= Date.now();
}

function readStored(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (typeof parsed.token !== "string" || !parsed.token || typeof parsed.expires_at !== "string") return null;
    return { token: parsed.token, expires_at: parsed.expires_at };
  } catch {
    return null;
  }
}

/** 当前有效会话;已过期视为无会话。 */
export function getSession(): Session | null {
  const session = readStored() ?? memory;
  return session && !expired(session) ? session : null;
}

export function saveSession(session: Session): void {
  memory = session;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* 已有内存回退 */
  }
  notify();
}

export function clearSession(): void {
  memory = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  notify();
}

export function getToken(): string | null {
  return getSession()?.token ?? null;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** 订阅登录态;登出、401、过期清理后组件会重渲染。 */
export function useToken(): string | null {
  return useSyncExternalStore(subscribe, getToken, getToken);
}
