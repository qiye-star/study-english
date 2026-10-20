import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { clearAuth, loadAuth, saveAuth, type StoredAuth } from "~/api/auth-storage";
import { ApiClient } from "~/api/client";
import type { AuthUser, RegisterInput } from "~/api/types";
import { clearDeviceData } from "~/auth/device-data";
import { noteMaintenance } from "~/components/announcement-banner";
import { bindingRequiredOf, emailStatusOf, type EmailStatus } from "./email-binding";
import { normalizeLoginName, normalizeUsername } from "./validation";

export interface AuthContextValue {
  user: StoredAuth["user"] | null;
  api: ApiClient;
  login(username: string, password: string): Promise<void>;
  /** `captcha`:人机验证载荷(只进 X-Captcha 请求头);模式关闭时不传。 */
  register(input: RegisterInput, captcha?: string): Promise<void>;
  /** `byUser`:用户主动退出,重新登录后不再回到退出前的页面(会话过期则会回到)。 */
  logout(byUser?: boolean): void;
  /** 改密:服务端轮换 token,这里换掉本机存储的 token(用户不需要重新登录)。测试替身可不提供。 */
  changePassword?(currentPassword: string, newPassword: string): Promise<void>;
  /** 改昵称后同步本机存储的显示名(用户不需要重新登录);`undefined` 表示回到登录名。测试替身可不提供。 */
  updateDisplayName?(displayName: string | undefined): void;
  /** 最近一次退出是用户主动发起的。 */
  signedOutByUser?: boolean;
  /** 账号邮箱状态(来自 /api/me,登录后与启动时各取一次)。测试替身可不提供。 */
  emailStatus?: EmailStatus | null;
  /** 强制绑定(X26):开启且未验证邮箱时为 true,RequireAuth 据此跳到绑定页。测试替身可不提供。 */
  bindingRequired?: boolean;
  /** 重新读取 /api/me,更新邮箱状态与强制绑定标记(绑定成功后调用)。测试替身可不提供。 */
  refreshProfile?(): Promise<void>;
  /** 头像的相对路径(来自 /api/me,内存中保存,不写进本机存储);没有头像为 null。测试替身可不提供。 */
  avatarUrl?: string | null;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children, fetchImpl }: { children: ReactNode; fetchImpl?: typeof fetch }) {
  const [auth, setAuth] = useState<StoredAuth | null>(() => loadAuth());
  const tokenRef = useRef<string | null>(auth?.token ?? null);
  tokenRef.current = auth?.token ?? null;

  const [signedOutByUser, setSignedOutByUser] = useState(false);
  const [emailStatus, setEmailStatus] = useState<EmailStatus | null>(null);
  const [bindingRequired, setBindingRequired] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  // 每收到一次 403 email_binding_required 就加一:读 /api/me 期间若出现过 403,读到的结果不能把它清掉。
  const bindingSignals = useRef(0);

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
      // X26:只有当前会话被要求绑定邮箱时才置位;回调不导入 features/account。
      onBindingRequired: () => {
        bindingSignals.current += 1;
        if (tokenRef.current) setBindingRequired(true);
      },
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
    setEmailStatus(null);
    setBindingRequired(false);
    setAvatarUrl(null);
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
    setEmailStatus(null);
    setBindingRequired(false);
    setAvatarUrl(null);
    setAuth(next);
  }, []);

  const refreshProfile = useCallback(async (): Promise<void> => {
    const token = tokenRef.current;
    if (!token) return;
    const signalsBefore = bindingSignals.current;
    const profile = await api.me();
    if (tokenRef.current !== token) return; // 读取期间已退出或换了账号
    const status = emailStatusOf(profile);
    setEmailStatus(status);
    setAvatarUrl(profile.avatarUrl ?? null);
    setBindingRequired(bindingSignals.current !== signalsBefore || bindingRequiredOf(status));
  }, [api]);

  // 登录后与启动时各读一次 /api/me(X26);失败静默,此时不影响页面本身。
  const userId = auth?.user.id ?? null;
  useEffect(() => {
    if (userId === null) return;
    refreshProfile().catch((): void => undefined);
  }, [userId, refreshProfile]);

  const login = useCallback(
    async (username: string, password: string) => accept(await api.login(normalizeLoginName(username), password)),
    [api, accept],
  );
  const register = useCallback(
    async (input: RegisterInput, captcha?: string) =>
      accept(await api.register({ ...input, username: normalizeUsername(input.username) }, captcha)),
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
    () => ({
      user: auth?.user ?? null, api, login, register, logout, changePassword, updateDisplayName, signedOutByUser,
      emailStatus, bindingRequired, refreshProfile, avatarUrl,
    }),
    [auth, api, login, register, logout, changePassword, updateDisplayName, signedOutByUser, emailStatus, bindingRequired, refreshProfile, avatarUrl],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
