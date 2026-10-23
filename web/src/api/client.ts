import camelcaseKeys from "camelcase-keys";
import decamelizeKeys from "decamelize-keys";
import type { AuthUser, CaptchaConfig, MyInvite, RegisterInput, UserProfile } from "./types";

export class ApiError extends Error {
  /** 429 等响应的 Retry-After(秒);没有或无法解析时为 undefined。 */
  constructor(public readonly status: number, message: string, public readonly retryAfter?: number) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RequestOptions {
  json?: unknown;
  form?: FormData;
  query?: Record<string, string | number | undefined>;
  auth?: boolean;
  as?: "json" | "blob" | "raw";
  timeoutMs?: number;
  signal?: AbortSignal;
  /** 人机验证载荷(ALTCHA):只放进 `X-Captcha` 请求头(spec R-C3),不进 URL 与 JSON 体。 */
  captcha?: string;
}

export interface ApiClientOptions {
  getToken: () => string | null;
  /** 带着 `token` 的请求被拒(401,或已停用的 403):调用方据此判断这个 token 是否仍是当前会话。 */
  onUnauthorized?: (token: string) => void;
  /** 503 "Maintenance":服务端进入维护模式,应用据此立即刷新维护状态(不用等下一次轮询) */
  onMaintenance?: () => void;
  /** 403 `email_binding_required`:强制绑定开启且本账号未绑定邮箱。网页据此跳到绑定页。 */
  onBindingRequired?: () => void;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;

function queryString(query?: RequestOptions["query"]): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.append(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : "";
}

function withTimeout(ms: number, outer?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (outer?.aborted) controller.abort();
  outer?.addEventListener("abort", abort, { once: true });
  const timer = ms > 0 ? setTimeout(abort, ms) : undefined;
  return {
    signal: controller.signal,
    done: () => {
      if (timer) clearTimeout(timer);
      outer?.removeEventListener("abort", abort);
    },
  };
}

function retryAfterSeconds(response: Response): number | undefined {
  const seconds = Number(response.headers.get("Retry-After"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (body && typeof body.error === "string") return body.error;
  } catch {
    /* 非 JSON 错误体 */
  }
  return `HTTP ${response.status}`;
}

export class ApiClient {
  constructor(private readonly options: ApiClientOptions) {}

  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const { json, form, query, auth = true, as = "json", timeoutMs = DEFAULT_TIMEOUT_MS, signal, captcha } = opts;
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = auth ? this.options.getToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (captcha) headers["X-Captcha"] = captcha;
    let body: BodyInit | undefined;
    if (json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(decamelizeKeys(json as Record<string, unknown>, { deep: true }));
    } else if (form) {
      body = form; // 不设 Content-Type:由浏览器带上 multipart boundary
    }
    const url = `${this.options.baseUrl ?? ""}${path}${queryString(query)}`;
    const fetchImpl = this.options.fetchImpl ?? fetch;
    // 流式响应不设超时,直接使用调用方的 signal。
    const timing = as === "raw" ? { signal, done: () => {} } : withTimeout(timeoutMs, signal);
    let response: Response;
    try {
      response = await fetchImpl(url, { method, headers, body, signal: timing.signal });
    } catch (err) {
      timing.done();
      const aborted = (err as Error)?.name === "AbortError";
      throw new ApiError(0, aborted ? (signal?.aborted ? "Request aborted" : "Request timed out") : "Network error");
    }
    try {
      if (response.status === 401 && token) this.options.onUnauthorized?.(token);
      if (!response.ok) {
        const message = await errorMessage(response);
        // An account disabled by an admin: the token is useless, so sign out like a 401 (logging in again shows why).
        if (response.status === 403 && token && message === "Account disabled") this.options.onUnauthorized?.(token);
        if (response.status === 503 && message === "Maintenance") this.options.onMaintenance?.();
        if (response.status === 403 && message === "email_binding_required") this.options.onBindingRequired?.();
        throw new ApiError(response.status, message, retryAfterSeconds(response));
      }
      if (as === "raw") return response as unknown as T;
      if (as === "blob") return (await response.blob()) as unknown as T;
      const text = await response.text();
      return (text ? camelcaseKeys(JSON.parse(text), { deep: true }) : {}) as T;
    } finally {
      timing.done();
    }
  }

  login(username: string, password: string, captcha?: string): Promise<AuthUser> {
    return this.request("POST", "/api/sessions", { json: { provider: "password", username, password }, auth: false, captcha });
  }

  register(input: RegisterInput, captcha?: string): Promise<AuthUser> {
    return this.request("POST", "/api/users", { json: input, auth: false, captcha });
  }

  /** 人机验证模式(`off` | `adaptive` | `always`);公开接口,无需登录。 */
  captchaConfig(): Promise<CaptchaConfig> {
    return this.request("GET", "/api/captcha/config", { auth: false });
  }

  me(): Promise<UserProfile> {
    return this.request("GET", "/api/me");
  }

  /** 登出:只撤销当前 token(服务端 204)。调用方负责吞掉网络错误并清本地会话。 */
  async logout(): Promise<void> {
    await this.request("DELETE", "/api/sessions/current");
  }

  /** 改密:服务端轮换所有 token,返回新的 access token(调用方要换掉存储的 token)。 */
  changePassword(currentPassword: string, newPassword: string): Promise<{ accessToken: string }> {
    return this.request("POST", "/api/me/password", { json: { currentPassword, newPassword } });
  }

  /** 改昵称:`nickname: null` 清除昵称。 */
  updateMe(patch: { nickname: string | null }): Promise<{ nickname: string | null; displayName: string }> {
    return this.request("PATCH", "/api/me", { json: patch });
  }

  /** 我的邀请码:返回当前资格与(有码时)码本身。响应含码,服务端标 no-store。 */
  myInvite(): Promise<MyInvite> {
    return this.request("GET", "/api/me/invite");
  }

  /** 生成永久邀请码(幂等:已有有效码则返回它)。 */
  createMyInvite(): Promise<MyInvite> {
    return this.request("POST", "/api/me/invite");
  }

  /** 更换邀请码:旧码立即失效,新码继承累计次数。必须带 confirm: true。 */
  rotateMyInvite(): Promise<MyInvite> {
    return this.request("POST", "/api/me/invite/rotate", { json: { confirm: true } });
  }

  getConfig<T>(key: string): Promise<T> {
    return this.request("GET", `/api/config/${encodeURIComponent(key)}`, { auth: false });
  }
}
