import camelcaseKeys from "camelcase-keys";
import decamelizeKeys from "decamelize-keys";
import type { AuthUser, UserProfile } from "./types";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
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
}

export interface ApiClientOptions {
  getToken: () => string | null;
  onUnauthorized?: () => void;
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
    const { json, form, query, auth = true, as = "json", timeoutMs = DEFAULT_TIMEOUT_MS, signal } = opts;
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = auth ? this.options.getToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;
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
      if (response.status === 401 && token) this.options.onUnauthorized?.();
      if (!response.ok) throw new ApiError(response.status, await errorMessage(response));
      if (as === "raw") return response as unknown as T;
      if (as === "blob") return (await response.blob()) as unknown as T;
      const text = await response.text();
      return (text ? camelcaseKeys(JSON.parse(text), { deep: true }) : {}) as T;
    } finally {
      timing.done();
    }
  }

  login(username: string, password: string): Promise<AuthUser> {
    return this.request("POST", "/api/sessions", { json: { provider: "password", username, password }, auth: false });
  }

  register(username: string, password: string, inviteCode?: string): Promise<AuthUser> {
    return this.request("POST", "/api/users", {
      json: { username, password, ...(inviteCode ? { inviteCode } : {}) },
      auth: false,
    });
  }

  me(): Promise<UserProfile> {
    return this.request("GET", "/api/me");
  }

  getConfig<T>(key: string): Promise<T> {
    return this.request("GET", `/api/config/${encodeURIComponent(key)}`, { auth: false });
  }
}
