import { CloudOffIcon, SparklesIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { cn } from "~/lib/cn";
import { lookupContext } from "~/lib/lookup-context";
import { useWordbookConfig } from "../use-wordbook-config";
import { type Card, explainWord, WORDBOOK_SERVER_ERRORS } from "../wordbook-api";

const GHOST = cn(
  "inline-flex h-tap w-full items-center justify-center rounded-button border-[0.5px] border-hair bg-surface px-4 text-body font-semibold text-ink",
  "transition-colors duration-fast active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
);

type Ai = { status: "loading" } | { status: "ok"; text: string } | { status: "off" } | { status: "error"; message: string };

/**
 * 「为什么?」讲解(spec §6.7,视觉稿 09):按需请求 AI 讲解(一个词一条、全站缓存);
 * 不可用(开关关、402、额度用完 → 503)时显示灰色说明,数据讲解(释义、错误类型说明)照常。正文纯文本,不渲染 HTML。
 */
export function ExplainSheet({ wordKey, open, onClose, card, note }: {
  wordKey: string;
  open: boolean;
  onClose: () => void;
  card?: Card;
  note?: string;
}) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const config = useWordbookConfig();
  const aiOff = config?.enabled === true && !config.aiAvailable;
  const [ai, setAi] = useState<Ai>({ status: "loading" });

  useEffect(() => {
    if (!open) return;
    if (aiOff) {
      setAi({ status: "off" });
      return;
    }
    let alive = true;
    setAi({ status: "loading" });
    explainWord(api, wordKey).then(
      (res) => { if (alive) setAi({ status: "ok", text: res.text }); },
      (err: unknown) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 503) setAi({ status: "off" });
        else setAi({ status: "error", message: translateServerError(t, err, WORDBOOK_SERVER_ERRORS) });
      },
    );
    return () => { alive = false; };
  }, [open, wordKey, api, aiOff, t]);

  const word = card?.word ?? wordKey;
  const phonetic = card?.us || card?.uk;
  const firstSense = card?.senses[0];
  const description = [phonetic, firstSense ? `${firstSense.pos}. ${firstSense.text}` : ""].filter(Boolean).join(" · ");

  return (
    <BottomSheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <BottomSheetContent className="max-h-[85vh] overflow-y-auto">
        <BottomSheetHeader title={t("web.wordbookSpell.explainTitle", { word })} description={description || undefined} />
        {card && card.senses.length > 1 ? (
          <ul className="space-y-1 text-body leading-[1.5]">
            {card.senses.slice(1).map((s, i) => (
              <li key={i}>
                <span className="mr-1.5 font-mono text-meta font-semibold text-ink-2">{s.pos}.</span>
                {s.text}
              </li>
            ))}
          </ul>
        ) : null}
        {note ? <p className="mt-2 text-sub leading-[1.5] text-ink">{note}</p> : null}
        {ai.status === "loading" ? (
          <div aria-hidden data-testid="explain-skeleton" className="mt-3 space-y-2">
            <div className="h-3.5 w-11/12 rounded-inline bg-surface-2 motion-safe:animate-pulse" />
            <div className="h-3.5 w-9/12 rounded-inline bg-surface-2 motion-safe:animate-pulse" />
            <div className="h-3.5 w-10/12 rounded-inline bg-surface-2 motion-safe:animate-pulse" />
          </div>
        ) : null}
        {ai.status === "ok" ? (
          <>
            <p {...lookupContext} className="mt-2.5 whitespace-pre-wrap break-words text-body leading-[1.6] text-ink">{ai.text}</p>
            <p className="mt-3 flex items-center gap-1.5 text-meta text-ink-2">
              <SparklesIcon aria-hidden className="h-3.5 w-3.5" />
              {t("web.wordbookSpell.aiSource")}
            </p>
          </>
        ) : null}
        {ai.status === "off" || ai.status === "error" ? (
          <div className="mt-3 flex gap-2 rounded-[10px] bg-surface-2 px-3 py-2.5 text-sub text-ink-2">
            <CloudOffIcon aria-hidden className="mt-px h-[17px] w-[17px] flex-none" />
            <span>
              <b className="font-semibold">{t("web.wordbookSpell.aiUnavailable")}</b>
              {ai.status === "error" ? ` · ${ai.message}` : ""}
              <span className="block">{t("web.wordbookSpell.aiUnavailableNote")}</span>
            </span>
          </div>
        ) : null}
        <button type="button" className={cn(GHOST, "mt-3.5")} onClick={onClose}>
          {t("web.wordbookSpell.close")}
        </button>
      </BottomSheetContent>
    </BottomSheet>
  );
}
