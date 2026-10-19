import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { clearAuth, loadAuth, saveAuth, type StoredAuth } from "~/api/auth-storage";
import { ApiClient } from "~/api/client";
import type { AuthUser } from "~/api/types";
import { clearDeviceData } from "~/auth/device-data";
import { noteMaintenance } from "~/components/announcement-banner";
import { normalizeUsername } from "./validation";

export interface AuthContextValue {
  user: StoredAuth["user"] | null;
  api: ApiClient;
  login(username: string, password: string): Promise<void>;
  register(username: string, password: string, inviteCode?: string): Promise<void>;
  /** `byUser`:用户主动退出,重新登录后不再回到退出前的页面(会话过期则会回到)。 */
  logout(byUser?: boolean): void;
  /** 改密:服务端轮换 token,这里换掉本机存储的 token(用户不需要重新登录)。测试替身可不提供。 */
  changePassword?(currentPassword: string, newPassword: string): Promise<void>;
  /** 改昵称后同步本机存储的显示名(用户不需要重新登录);`undefined` 表示回到登录名。测试替身可不提供。 */
  updateDisplayName?(displayName: string | undefined): void;
  /** 最近一次退出是用户主动发起的。 */
  signedOutByUser?: boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children, fetchImpl }: { children: ReactNode; fetchImpl?: typeof fetch }) {
  const [auth, setAuth] = useState<StoredAuth | null>(() => loadAuth());
  const tokenRef = useRef<string | null>(auth?.token ?? null);
  tokenRef.current = auth?.token ?? null;

  const [signedOutByUser, setSignedOutByUser] = useState(false);

  // api 与 logout 互相引用:401 经 logoutRef 回到最新的 logout。
  const logoutRef = useRef<(byUser?: boolean) => void>(() => {});
  const api = useMemo(
    () => new ApiClient({
      getToken: () => tokenRef.current,
      // 只有被拒的 token 仍是当前 token 才退出:用户自己的退出请求、改密前发出的旧请求返回的 401 都不能再踢掉新会话。
      onUnauthorized: (rejected) => {
        if (rejected === tokenRef.current) logoutRef.current();
      },
      onMaintenance: noteMaintenance,
      fetchImpl,
    }),
    [fetchImpl],
  );

  const logout = useCallback((byUser?: boolean) => {
    // 用户主动退出:先让服务端撤销这个 token(请求在同步阶段就已带上 token);失败也照常清本地。
    if (byUser && tokenRef.current) api.logout().catch(() => {});
    setSignedOutByUser(byUser === true);
    clearAuth();
    clearDeviceData();
    tokenRef.current = null;
    setAuth(null);
  }, [api]);
  logoutRef.current = logout;

  const accept = useCallback((user: AuthUser) => {
    // 防御:代理/网关可能返回形状不对的 2xx 响应,此时不要保存一个无效会话。
    if (!user || typeof user.accessToken !== "string" || !user.accessToken || typeof user.id !== "string") {
      throw new Error("Malformed auth response");
    }
    const next: StoredAuth = {
      token: user.accessToken,
      user: { id: user.id, name: user.name, ...(user.displayName ? { displayName: user.displayName } : {}) },
    };
    saveAuth(next);
    tokenRef.current = next.token;
    setSignedOutByUser(false);
    setAuth(next);
  }, []);

  const login = useCallback(
    async (username: string, password: string) => accept(await api.login(normalizeUsername(username), password)),
    [api, accept],
  );
  const register = useCallback(
    async (username: string, password: string, inviteCode?: string) =>
      accept(await api.register(normalizeUsername(username), password, inviteCode)),
    [api, accept],
  );

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      const { accessToken } = await api.changePassword(currentPassword, newPassword);
      if (typeof accessToken !== "string" || !accessToken) throw new Error("Malformed auth response");
      const current = loadAuth();
      if (!current) return; // 改密期间已退出
      const next: StoredAuth = { token: accessToken, user: current.user };
      saveAuth(next);
      tokenRef.current = accessToken;
      setAuth(next);
    },
    [api],
  );

  const updateDisplayName = useCallback((displayName: string | undefined) => {
    const current = loadAuth();
    if (!current) return;
    const user: StoredAuth["user"] = { id: current.user.id, name: current.user.name, ...(displayName ? { displayName } : {}) };
    const next: StoredAuth = { token: current.token, user };
    saveAuth(next);
    setAuth(next);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user: auth?.user ?? null, api, login, register, logout, changePassword, updateDisplayName, signedOutByUser }),
    [auth, api, login, register, logout, changePassword, updateDisplayName, signedOutByUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
