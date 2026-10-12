import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { translateServerError } from "~/api/error-messages";
import type { ApiClient } from "~/api/client";
import { useAuth } from "~/auth/auth-context";
import { defLangOf, saveDefLang } from "./def-lang";
import { useWordbookConfig } from "./use-wordbook-config";
import { WORDBOOK_SERVER_ERRORS, type DefLang } from "./wordbook-api";

/**
 * 释义显示偏好(R-DW14)。`useWordbookConfig` 每个 ApiClient 只取一次配置,保存后不会刷新,
 * 所以这里按 ApiClient 记一层「本次会话里用户选过的值」:`defLang = 覆盖 ?? config.defLang ?? "both"`。
 * 换账号 = 新 ApiClient,覆盖层自然失效。
 */
const overrides = new WeakMap<ApiClient, DefLang>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

/** 只读(会话页 / 词卡抽屉用):没有保存状态,不触发保存请求(配置请求与其它背单词页共用缓存)。 */
export function useDefLangValue(): DefLang {
  const { api } = useAuth();
  const config = useWordbookConfig();
  const override = useSyncExternalStore<DefLang | undefined>(subscribe, () => overrides.get(api), () => undefined);
  return override ?? defLangOf(config);
}

/** 读 + 乐观保存(设置界面用)。多次连续保存带递增序号,只有最后一次的失败会回退 / 报错(同 use-goals 的 patch)。 */
export function useDefLangSetting() {
  const { api } = useAuth();
  const { t } = useTranslation();
  const defLang = useDefLangValue();
  const seq = useRef(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setDefLang = useCallback(async (next: DefLang): Promise<boolean> => {
    const before = overrides.get(api);
    const id = ++seq.current;
    overrides.set(api, next);
    emit();
    setSaving(true);
    setError(null);
    try {
      await saveDefLang(api, next);
      return true;
    } catch (err) {
      if (id === seq.current) {
        if (before === undefined) overrides.delete(api);
        else overrides.set(api, before);
        emit();
        setError(translateServerError(t, err, WORDBOOK_SERVER_ERRORS));
      }
      return false;
    } finally {
      if (id === seq.current) setSaving(false);
    }
  }, [api, t]);

  return { defLang, setDefLang, saving, error };
}
