import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { cn } from "@renderer/lib/utils";
import { PageNote } from "./page-status";
import { RecallCard } from "./recall-card";
import { SessionHeader, StepBar } from "./session-header";
import { DOCK, GHOST_DOCK, PRIMARY } from "./ui";
import { Dock } from "~/components/dock";
import { useDefLangValue } from "./use-def-lang";
import { useSpeaker } from "./use-speaker";
import { useWordbookConfig } from "./use-wordbook-config";
import type { FreeSet, Question } from "./wordbook-api";

/**
 * 翻卡浏览(规格 §1.2,「只翻面的轻量卡片页」):正面词头 + 音标,翻面是完整词卡;不判分、不发任何请求、不写事件(R-L14)。
 * 复用 RecallCard 的正反两面。
 */
export function FreeBrowse({ set }: { set: FreeSet }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const speaker = useSpeaker();
  const config = useWordbookConfig();
  const showExample = config?.enabled ? config.learn.showExample : true;
  const defLang = useDefLangValue();
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [finished, setFinished] = useState(false);
  const { items } = set;
  const item = items[index];
  const last = index === items.length - 1;
  const listen = { onListen: speaker.listen, listening: speaker.active, canListen: speaker.available };
  const title = t("web.wordbook.learned.free.title");

  if (finished) {
    return (
      <div className="flex flex-1 flex-col">
        <SessionHeader title={title} />
        <div className="px-gutter liquid:px-frame"><PageNote>{t("web.wordbook.learned.free.browse.done")}</PageNote></div>
        <Dock className={DOCK}>
          <button type="button" className={cn(GHOST_DOCK, "h-12 flex-1")} onClick={() => navigate("/wordbook/learned")}>{t("web.wordbook.learned.free.summary.back")}</button>
          <button type="button" className={cn(PRIMARY, "h-12 flex-1")} onClick={() => { setIndex(0); setFlipped(false); setFinished(false); }}>
            {t("web.wordbook.learned.free.browse.again")}
          </button>
        </Dock>
      </div>
    );
  }
  const question: Question = { key: item.card.key, qtype: "recall", prompt: { word: item.card.word, us: item.card.us || item.card.uk }, options: null, length: null };
  const go = (to: number) => { setIndex(to); setFlipped(false); };
  return (
    <div className="flex flex-1 flex-col">
      <SessionHeader title={title} subtitle={t("web.wordbook.learned.free.browse.progress", { n: index + 1, total: items.length })} />
      <div className="px-gutter liquid:px-frame pb-4">
        <StepBar done={index} total={items.length} />
        <RecallCard key={item.card.key} question={question} card={item.card} defLang={defLang} face={flipped ? "back" : "front"} rating={null} showExample={showExample} {...listen} />
      </div>
      <Dock className={DOCK}>
        <button type="button" className={cn(GHOST_DOCK, "h-12 flex-1")} disabled={index === 0} onClick={() => go(index - 1)}>{t("web.wordbook.learned.free.browse.prev")}</button>
        {flipped ? (
          <button type="button" className={cn(PRIMARY, "h-12 flex-1")} onClick={() => (last ? setFinished(true) : go(index + 1))}>
            {last ? t("web.wordbook.learned.free.browse.finish") : t("web.wordbook.learned.free.browse.next")}
          </button>
        ) : (
          <button type="button" className={cn(PRIMARY, "h-12 flex-1")} onClick={() => { speaker.prime(); setFlipped(true); }}>{t("web.wordbook.learned.free.browse.flip")}</button>
        )}
      </Dock>
    </div>
  );
}
