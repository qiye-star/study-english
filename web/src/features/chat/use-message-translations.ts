import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { LOOKUP_SERVER_ERRORS, cachedTranslate } from "~/features/lookup";
import { stripMarkdown } from "./tts";

export type TranslationState = { status: "loading" } | { status: "done"; text: string } | { status: "error"; error: string };

/** 每条回复的译文(R16):按需请求、可收起、命中 IndexedDB 缓存时不再调用大模型;卸载/重置后不再 setState。 */
export function useMessageTranslations(api: ApiClient, nativeLanguage: string) {
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const [states, setStates] = useState<Record<string, TranslationState>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const statesRef = useRef(states);
  statesRef.current = states;
  const openRef = useRef(open);
  openRef.current = open;
  const controllers = useRef(new Map<string, AbortController>());
  const mounted = useRef(true);

  const abortAll = useCallback(() => {
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortAll();
    };
  }, [abortAll]);

  const load = useCallback(async (key: string, text: string) => {
    controllers.current.get(key)?.abort();
    const controller = new AbortController();
    controllers.current.set(key, controller);
    const alive = () => mounted.current && !controller.signal.aborted;
    setStates((prev) => ({ ...prev, [key]: { status: "loading" } }));
    try {
      const out = await cachedTranslate(api, { text: stripMarkdown(text), nativeLanguage }, controller.signal);
      if (alive()) setStates((prev) => ({ ...prev, [key]: { status: "done", text: out } }));
    } catch (err) {
      if (alive()) setStates((prev) => ({ ...prev, [key]: { status: "error", error: translateServerError(tRef.current, err, LOOKUP_SERVER_ERRORS) } }));
    } finally {
      if (controllers.current.get(key) === controller) controllers.current.delete(key);
    }
  }, [api, nativeLanguage]);

  const show = useCallback((key: string, text: string) => {
    setOpen((prev) => ({ ...prev, [key]: true }));
    const current = statesRef.current[key];
    if (!current || current.status === "error") void load(key, text);
  }, [load]);

  const toggle = useCallback((key: string, text: string) => {
    if (openRef.current[key]) setOpen((prev) => ({ ...prev, [key]: false }));
    else show(key, text);
  }, [show]);

  const retry = useCallback((key: string, text: string): void => { void load(key, text); }, [load]);

  const reset = useCallback(() => {
    abortAll();
    statesRef.current = {};
    openRef.current = {};
    setStates({});
    setOpen({});
  }, [abortAll]);

  // 改了"我的"页语言:旧译文作废
  useEffect(() => reset, [nativeLanguage, reset]);

  return { states, open, toggle, show, retry, reset };
}
