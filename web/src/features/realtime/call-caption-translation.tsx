import { LanguagesIcon, LoaderIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "~/api/client";
import { useMessageTranslations, type TranslationState } from "~/features/chat/use-message-translations";
import { cn } from "~/lib/cn";

const AUTO_KEY = "enjoy-web:call-auto-translate";

/** 通话里"自动翻译"开关(localStorage;读写都包 try/catch,隐私模式等环境没有存储也照常工作)。 */
export function readAutoTranslate(): boolean {
  try { return window.localStorage.getItem(AUTO_KEY) === "1"; } catch { return false; }
}
export function writeAutoTranslate(on: boolean): void {
  try { window.localStorage.setItem(AUTO_KEY, on ? "1" : "0"); } catch { /* 存储不可用:只在本次通话内生效 */ }
}

/**
 * 字幕卡里的译文行:13px、--ink-2、紧跟英文(设计稿 `.caption .zh`)。
 * 与聊天的 `MessageTranslation` 同一套状态与 testid(loading / done / error + 重试)。
 */
export function CallTranslationLine({ state, onRetry }: { state?: TranslationState; onRetry(): void }) {
  const { t } = useTranslation();
  const base = "mt-1 text-sub leading-dialogue text-ink-2";
  if (!state || state.status === "loading") {
    return (
      <p data-testid="message-translation" data-status="loading" className={cn(base, "flex items-center gap-1.5")}>
        <LoaderIcon className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />{t("web.chat.translating")}
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div data-testid="message-translation" data-status="error" className={cn(base, "flex flex-wrap items-center gap-x-3")}>
        <span>{state.error}</span>
        <button type="button" className="tap-link text-sub font-medium text-blue" onClick={onRetry}>{t("web.common.retry")}</button>
      </div>
    );
  }
  return (
    <p data-testid="message-translation" data-status="done" className={cn(base, "select-text whitespace-pre-wrap")}>
      {state.text}
    </p>
  );
}

export interface CallCaptionTranslationProps {
  api: ApiClient;
  nativeLanguage: string;
  captionKey: string;
  text: string;
  /** 这句助手回复已经说完(reply_done 且没被打断);流式中不出现按钮、也不自动翻译。 */
  finished: boolean;
  auto: boolean;
  /**
   * 摆放"译"按钮与译文行(字幕卡把按钮放在标题行右侧、译文放在英文下方)。
   * 未说完时两者都是 null。不传则按 按钮、译文 的顺序直接渲染。
   */
  layout?(button: ReactNode, line: ReactNode): ReactNode;
}

/**
 * 助手字幕的"译"按钮 + 译文行。请求是异步的、不进音频链路;卸载(挂断/字幕被裁掉)时由
 * `useMessageTranslations` 中止在途请求。自动模式对同一句只触发一次(之后用户收起也不再自动展开)。
 */
export function CallCaptionTranslation({ api, nativeLanguage, captionKey, text, finished, auto, layout }: CallCaptionTranslationProps) {
  const { t } = useTranslation();
  const translations = useMessageTranslations(api, nativeLanguage);
  const { show, toggle, retry } = translations;
  const autoDone = useRef(false);
  useEffect(() => {
    if (!auto || !finished || autoDone.current) return;
    autoDone.current = true;
    show(captionKey, text);
  }, [auto, finished, captionKey, text, show]);
  if (!finished) return layout ? <>{layout(null, null)}</> : null;
  const open = !!translations.open[captionKey];
  // 视觉 32px、命中 44px;负外边距让它不撑高标题行
  const button = (
    <button type="button" data-testid="call-caption-translate" aria-pressed={open} aria-label={t("web.realtime.translate")}
      className={cn(
        "-my-3 -mr-2 inline-flex h-11 w-11 flex-none items-center justify-center rounded-badge transition-colors duration-fast ease-standard",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        open ? "text-blue" : "text-ink-2",
      )}
      onClick={() => toggle(captionKey, text)}>
      <LanguagesIcon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
  const line = open ? <CallTranslationLine state={translations.states[captionKey]} onRetry={() => retry(captionKey, text)} /> : null;
  return <>{layout ? layout(button, line) : <>{button}{line}</>}</>;
}
