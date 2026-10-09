import { useSyncExternalStore } from "react";
import * as endpoints from "./endpoints";

export type Role = "viewer" | "operator" | "superadmin";
export type MaintenanceMode = "off" | "read_only" | "full";

/** 由 `GET /api/admin/session` 驱动;会话 token 在 HttpOnly Cookie 里,前端只持有 CSRF(只放内存)。 */
export interface AdminSession {
  username: string;
  role: Role;
  csrfToken: string;
  expiresAt: string;
  stepUpUntil: string | null;
  totpEnabled: boolean;
  safeMode: boolean;
  maintenanceMode: MaintenanceMode;
}

/** unknown = 还没问过服务端;loading = 正在问;known = 已知(会话或 null) */
export type SessionStatus = "unknown" | "loading" | "known";

const ROLE_RANK: Record<Role, number> = { viewer: 0, operator: 1, superadmin: 2 };

let current: AdminSession | null = null;
let status: SessionStatus = "unknown";
/** 密码已通过、TOTP 未完成的登录:第二步请求要带这个 CSRF */
let pendingCsrf: string | null = null;
let inflight: Promise<AdminSession | null> | null = null;

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getAdminSession(): AdminSession | null {
  return current;
}

export function getSessionStatus(): SessionStatus {
  return status;
}

export function setSession(session: AdminSession): void {
  current = session;
  status = "known";
  pendingCsrf = null;
  notify();
}

/** 本地清掉会话(401、登出后);不请求服务端。 */
export function clearSession(): void {
  current = null;
  status = "known";
  pendingCsrf = null;
  notify();
}

export function setPendingCsrf(csrf: string | null): void {
  pendingCsrf = csrf;
}

export function getCsrf(): string | null {
  return current?.csrfToken ?? pendingCsrf;
}

export function hasRole(session: AdminSession | null, min: Role): boolean {
  return !!session && ROLE_RANK[session.role] >= ROLE_RANK[min];
}

/** 向服务端确认 Cookie 会话(首次挂载、刷新页面、多标签页)。并发调用共用一个请求。 */
export function loadSession(): Promise<AdminSession | null> {
  if (inflight) return inflight;
  status = "loading";
  notify();
  inflight = endpoints
    .getSession()
    .then(
      (s) => {
        setSession(s);
        return s;
      },
      () => {
        clearSession();
        return null;
      },
    )
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** 静默刷新(二次验证后更新 stepUpUntil 等);不改变加载状态,失败时保持原样。 */
export async function refreshSession(): Promise<void> {
  try {
    setSession(await endpoints.getSession());
  } catch {
    /* 401 已由客户端清掉会话 */
  }
}

/** 服务端登出(撤销会话、清 Cookie),无论成败都清掉本地会话。 */
export async function logout(): Promise<void> {
  try {
    await endpoints.logout();
  } catch {
    /* 会话可能已失效 */
  } finally {
    clearSession();
  }
}

/** 订阅登录态;登出、401 后组件会重渲染。 */
export function useAdminSession(): AdminSession | null {
  return useSyncExternalStore(subscribe, getAdminSession, getAdminSession);
}

export function useSessionStatus(): SessionStatus {
  return useSyncExternalStore(subscribe, getSessionStatus, getSessionStatus);
}

/** 测试用:回到"还没问过服务端"的初始状态。 */
export function resetSessionForTests(): void {
  current = null;
  status = "unknown";
  pendingCsrf = null;
  inflight = null;
  notify();
}
