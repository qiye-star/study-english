import { clearSession, getToken } from "./session";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST";
  json?: unknown;
  query?: Record<string, string | number | undefined | null>;
  /** 默认 true:带 Bearer,并在 401 时登出。登录接口传 false。 */
  auth?: boolean;
  as?: "json" | "blob";
  signal?: AbortSignal;
}

export interface ClientOptions {
  getToken: () => string | null;
  onUnauthorized: () => void;
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

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (body && typeof body.error === "string" && body.error) return body.error;
  } catch {
    /* 非 JSON 错误体 */
  }
  return `请求失败(${response.status})`;
}

export function createClient(options: ClientOptions) {
  const base = options.baseUrl ?? "";
  return async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
    const auth = opts.auth !== false;
    const headers: Record<string, string> = {};
    if (auth) {
      const token = options.getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    if (opts.json !== undefined) headers["Content-Type"] = "application/json";
    let response: Response;
    try {
      const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
      response = await doFetch(`${base}${path}${queryString(opts.query)}`, {
        method: opts.method ?? (opts.json !== undefined ? "POST" : "GET"),
        headers,
        body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
        signal: opts.signal,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      throw new ApiError(0, NETWORK_ERROR);
    }
    if (!response.ok) {
      const message = await errorMessage(response);
      if (response.status === 401 && auth) options.onUnauthorized();
      throw new ApiError(response.status, message);
    }
    if (opts.as === "blob") return (await response.blob()) as T;
    return (await response.json()) as T;
  };
}

/** 全应用唯一的网络出口。 */
export const request = createClient({ getToken, onUnauthorized: clearSession });
