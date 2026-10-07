import { LanguagesIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import type { ApiClient } from "~/api/client";
import { MessageTranslation } from "~/features/chat/message-translation";
import { useMessageTranslations } from "~/features/chat/use-message-translations";

const AUTO_KEY = "enjoy-web:call-auto-translate";

/** 通话里"自动翻译"开关(localStorage;读写都包 try/catch,隐私模式等环境没有存储也照常工作)。 */
export function readAutoTranslate(): boolean {
  try { return window.localStorage.getItem(AUTO_KEY) === "1"; } catch { return false; }
}
export function writeAutoTranslate(on: boolean): void {
  try { window.localStorage.setItem(AUTO_KEY, on ? "1" : "0"); } catch { /* 存储不可用:只在本次通话内生效 */ }
}

export interface CallCaptionTranslationProps {
  api: ApiClient;
  nativeLanguage: string;
  captionKey: string;
  text: string;
  /** 这句助手回复已经说完(reply_done 且没被打断);流式中不出现按钮、也不自动翻译。 */
  finished: boolean;
  auto: boolean;
}

/**
 * 助手字幕下的"译"按钮 + 译文行。请求是异步的、不进音频链路;卸载(挂断/字幕被裁掉)时由
 * `useMessageTranslations` 中止在途请求。自动模式对同一句只触发一次(之后用户收起也不再自动展开)。
 */
export function CallCaptionTranslation({ api, nativeLanguage, captionKey, text, finished, auto }: CallCaptionTranslationProps) {
  const { t } = useTranslation();
  const translations = useMessageTranslations(api, nativeLanguage);
  const { show, toggle, retry } = translations;
  const autoDone = useRef(false);
  useEffect(() => {
    if (!auto || !finished || autoDone.current) return;
    autoDone.current = true;
    show(captionKey, text);
  }, [auto, finished, captionKey, text, show]);
  if (!finished) return null;
  return (
    <>
      <Button type="button" variant="ghost" size="sm" data-testid="call-caption-translate"
        aria-pressed={!!translations.open[captionKey]} aria-label={t("web.realtime.translate")}
        className="h-11 min-w-11 px-2" onClick={() => toggle(captionKey, text)}>
        <LanguagesIcon className="h-4 w-4" aria-hidden="true" />
      </Button>
      {translations.open[captionKey] && (
        <div className="max-w-[85%]">
          <MessageTranslation state={translations.states[captionKey]} onRetry={() => retry(captionKey, text)} />
        </div>
      )}
    </>
  );
}
