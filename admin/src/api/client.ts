import { clearSession, getCsrf } from "./session";

/** 服务端二次验证过期时的 403 文案(app/admin/perms.py) */
export const STEP_UP_REQUIRED = "Step-up required";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** 字段级校验错误:`{"error": "Invalid settings", "fields": {key: msg}}` */
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestOptions {
  method?: Method;
  json?: unknown;
  query?: Record<string, string | number | undefined | null>;
  /** 默认 "json";204 无论如何返回 undefined */
  as?: "json" | "blob" | "none";
  signal?: AbortSignal;
  /** 默认 true:401 时清掉会话(跳登录)。登录类接口传 false。 */
  auth?: boolean;
}

export interface ClientOptions {
  getCsrf: () => string | null;
  onUnauthorized: () => void;
  /** 收到 403 Step-up required 时调用;resolve(true) 表示已完成二次验证,原请求重放一次 */
  onStepUp: () => Promise<boolean>;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

const NETWORK_ERROR = "网络异常,请检查连接后重试";

function queryString(query?: RequestOptions["query"]): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") params.append(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

async function errorBody(response: Response): Promise<{ message: string; fields?: Record<string, string> }> {
  try {
    const body = await response.json();
    if (body && typeof body.error === "string" && body.error) {
      const fields = body.fields && typeof body.fields === "object" ? (body.fields as Record<string, string>) : undefined;
      return { message: body.error, fields };
    }
  } catch {
    /* 非 JSON 错误体 */
  }
  return { message: `请求失败(${response.status})` };
}

/**
 * 管理端 HTTP 客户端:会话在 HttpOnly Cookie 里(JS 拿不到),非 GET 请求带 `X-Admin-CSRF`;
 * 从不发送 Authorization 头。
 */
export function createClient(options: ClientOptions) {
  const base = options.baseUrl ?? "";

  async function once<T>(path: string, opts: RequestOptions, allowStepUp: boolean): Promise<T> {
    const method: Method = opts.method ?? (opts.json !== undefined ? "POST" : "GET");
    const headers: Record<string, string> = {};
    if (opts.json !== undefined) headers["Content-Type"] = "application/json";
    if (method !== "GET") {
      const csrf = options.getCsrf();
      if (csrf) headers["X-Admin-CSRF"] = csrf;
    }
    let response: Response;
    try {
      const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
      response = await doFetch(`${base}${path}${queryString(opts.query)}`, {
        method,
        headers,
        credentials: "same-origin",
        body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
        signal: opts.signal,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      throw new ApiError(0, NETWORK_ERROR);
    }
    if (!response.ok) {
      const { message, fields } = await errorBody(response);
      if (response.status === 401 && opts.auth !== false) options.onUnauthorized();
      if (response.status === 403 && message === STEP_UP_REQUIRED && allowStepUp && (await options.onStepUp())) {
        return once<T>(path, opts, false);
      }
      throw new ApiError(response.status, message, fields);
    }
    if (opts.as === "blob") return (await response.blob()) as T;
    if (opts.as === "none" || response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return <T = unknown>(path: string, opts: RequestOptions = {}) => once<T>(path, opts, true);
}

type StepUpHandler = () => Promise<boolean>;
let stepUpHandler: StepUpHandler | null = null;

/** AppShell(StepUpDialog 的宿主)注册;没有宿主时 step-up 直接失败。返回注销函数。 */
export function setStepUpHandler(fn: StepUpHandler | null): () => void {
  stepUpHandler = fn;
  return () => {
    if (stepUpHandler === fn) stepUpHandler = null;
  };
}

/** 全应用唯一的网络出口。 */
export const request = createClient({
  getCsrf: () => getCsrf(),
  onUnauthorized: () => clearSession(),
  onStepUp: () => (stepUpHandler ? stepUpHandler() : Promise.resolve(false)),
});
