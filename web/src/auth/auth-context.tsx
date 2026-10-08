import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { clearAuth, loadAuth, saveAuth, type StoredAuth } from "~/api/auth-storage";
import { ApiClient } from "~/api/client";
import type { AuthUser } from "~/api/types";
import { clearDeviceData } from "~/auth/device-data";
import { normalizeUsername } from "./validation";

export interface AuthContextValue {
  user: StoredAuth["user"] | null;
  api: ApiClient;
  login(username: string, password: string): Promise<void>;
  register(username: string, password: string, inviteCode?: string): Promise<void>;
  /** `byUser`:用户主动退出,重新登录后不再回到退出前的页面(会话过期则会回到)。 */
  logout(byUser?: boolean): void;
  /** 最近一次退出是用户主动发起的。 */
  signedOutByUser?: boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children, fetchImpl }: { children: ReactNode; fetchImpl?: typeof fetch }) {
  const [auth, setAuth] = useState<StoredAuth | null>(() => loadAuth());
  const tokenRef = useRef<string | null>(auth?.token ?? null);
  tokenRef.current = auth?.token ?? null;

  const [signedOutByUser, setSignedOutByUser] = useState(false);

  const logout = useCallback((byUser?: boolean) => {
    setSignedOutByUser(byUser === true);
    clearAuth();
    clearDeviceData();
    tokenRef.current = null;
    setAuth(null);
  }, []);

  const api = useMemo(
    () => new ApiClient({ getToken: () => tokenRef.current, onUnauthorized: () => logout(), fetchImpl }),
    [logout, fetchImpl],
  );

  const accept = useCallback((user: AuthUser) => {
    // 防御:代理/网关可能返回形状不对的 2xx 响应,此时不要保存一个无效会话。
    if (!user || typeof user.accessToken !== "string" || !user.accessToken || typeof user.id !== "string") {
      throw new Error("Malformed auth response");
    }
    const next: StoredAuth = { token: user.accessToken, user: { id: user.id, name: user.name } };
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

  const value = useMemo<AuthContextValue>(
    () => ({ user: auth?.user ?? null, api, login, register, logout, signedOutByUser }),
    [auth, api, login, register, logout, signedOutByUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
