import { useCallback, useEffect, useState } from "react";
import { ApiError, type ApiClient } from "~/api/client";
import { useAuth } from "~/auth/auth-context";
import { agentsApi } from "./agents-api";
import { AGENTS_DISABLED, type AgentSettings, type AgentsConfig, type Persona } from "./types";

export type LoadState = "loading" | "ready" | "error";

// 开关是全局的:按 ApiClient 缓存;设置与角色列表属于账号:按用户 id 缓存(R-W16)
const configCache = new WeakMap<ApiClient, Promise<AgentsConfig>>();
const settingsCache = new Map<string, Promise<AgentSettings>>();
const personasCache = new Map<string, Promise<Persona[]>>();

/** 测试与账号切换用。WeakMap 无法清空:测试每次新建 ApiClient。 */
export function resetAgentsCaches(): void {
  settingsCache.clear();
  personasCache.clear();
}

function loadConfig(api: ApiClient): Promise<AgentsConfig> {
  let pending = configCache.get(api);
  if (!pending) {
    pending = agentsApi.config(api).catch((err: unknown) => {
      // 旧服务端没有这个接口 / 功能关闭:视为关闭(并记住);其他失败不记住,下次挂载再试
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) return AGENTS_DISABLED;
      configCache.delete(api);
      throw err;
    });
    configCache.set(api, pending);
  }
  return pending;
}

function cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let pending = cache.get(key);
  if (!pending) {
    pending = load().catch((err: unknown) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, pending);
  }
  return pending;
}

/** `GET /api/agents/config`(R-W9)。拿到之前 config 为 null。 */
export function useAgentsConfig() {
  const { api } = useAuth();
  const [config, setConfig] = useState<AgentsConfig | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setState("loading");
    loadConfig(api).then(
      (c) => { if (alive) { setConfig(c); setState("ready"); } },
      () => { if (alive) setState("error"); },
    );
    return () => { alive = false; };
  }, [api, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { config, state, retry } as const;
}

/** 用户级智能体设置;enabled=false 时不请求。setSettings 同时更新缓存(其他页面再挂载即读到新值)。 */
export function useAgentSettings(enabled = true) {
  const { api, user } = useAuth();
  const key = user?.id ?? "";
  const [settings, setLocal] = useState<AgentSettings | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || !key) return;
    let alive = true;
    setState("loading");
    cached(settingsCache, key, () => agentsApi.settings(api)).then(
      (s) => { if (alive) { setLocal(s); setState("ready"); } },
      () => { if (alive) setState("error"); },
    );
    return () => { alive = false; };
  }, [api, key, enabled, attempt]);
  const setSettings = useCallback((next: AgentSettings) => {
    if (key) settingsCache.set(key, Promise.resolve(next));
    setLocal(next);
  }, [key]);
  const retry = useCallback(() => {
    settingsCache.delete(key);
    setAttempt((n) => n + 1);
  }, [key]);
  return { settings, state, setSettings, retry } as const;
}

/** 内置 + 我的角色;reload() 丢掉缓存重新取(创建 / 编辑 / 删除之后)。 */
export function usePersonas(enabled = true) {
  const { api, user } = useAuth();
  const key = user?.id ?? "";
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || !key) return;
    let alive = true;
    setState("loading");
    cached(personasCache, key, () => agentsApi.personas(api).then((r) => r.personas)).then(
      (list) => { if (alive) { setPersonas(list); setState("ready"); } },
      () => { if (alive) setState("error"); },
    );
    return () => { alive = false; };
  }, [api, key, enabled, attempt]);
  const reload = useCallback(() => {
    personasCache.delete(key);
    setAttempt((n) => n + 1);
  }, [key]);
  return { personas, state, reload } as const;
}
