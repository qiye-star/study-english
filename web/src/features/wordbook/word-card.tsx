import { EyeIcon, EyeOffIcon, Volume2Icon } from "lucide-react";
import { useId, useState, type ReactNode, type Ref } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { SurfaceCard } from "~/components/surface-card";
import { Slot } from "~/lib/extension-points-react";
import { DEFAULT_DEF_LANG, defView } from "./def-lang";
import { DefinitionsEn } from "./defs-en";
import { MAX_PHRASES, PhrasesSection, type PhrasesOpen } from "./phrases-section";
import { RecallCover } from "./recall-cover";
import type { Card, DefLang, Sense } from "./wordbook-api";
import "./locales";

const MAX_SENSES = 4;

/** 词性写法统一带点(`v` → `v.`)。 */
export const posLabel = (pos: string) => (pos && !pos.endsWith(".") ? `${pos}.` : pos);

/** 与服务端 entry.meaning_line 相同的释义行:前两条释义「pos. 文本」用「；」连接,截到 24 字。 */
export function meaningLine(senses: Sense[], max = 24): string {
  const line = senses.slice(0, 2).map((s) => (s.pos ? `${posLabel(s.pos)} ${s.text}` : s.text)).join("；");
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 例句里第一个以词头开头的词标成琥珀色(视觉稿 .ex mark);找不到就原样显示。 */
export function HighlightedSentence({ text, word }: { text: string; word: string }): ReactNode {
  const match = word.trim() ? new RegExp(`\\b${escapeRe(word.trim())}[\\w'-]*`, "i").exec(text) : null;
  if (!match) return text;
  return (
    <>
      {text.slice(0, match.index)}
      <mark className="rounded-[4px] bg-amber-tint px-[3px] font-semibold text-amber">{match[0]}</mark>
      {text.slice(match.index + match[0].length)}
    </>
  );
}

export interface ListenProps {
  /** 朗读;id 用于区分播放状态 */
  onListen?: (id: string, text: string, accent?: "us" | "gb") => void;
  /** 正在加载 / 播放的朗读 id */
  listening?: string | null;
  /** TTS 未配置时为 false:朗读键禁用并给出说明 */
  canListen?: boolean;
}

/** 44px 朗读键(视觉稿 .play / .ph i)。 */
export function ListenButton({ id, text, accent, label, onListen, listening, canListen = true, className, children }: ListenProps & {
  id: string; text: string; accent?: "us" | "gb"; label: string; className?: string; children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <button type="button" aria-label={label} title={canListen ? undefined : t("web.wordbook.word.ttsOff")}
      disabled={!canListen || !onListen} data-state={listening === id ? "playing" : "idle"}
      onClick={() => onListen?.(id, text, accent)}
      className={cn(
        "inline-flex min-h-tap items-center gap-1.5 rounded-button transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        className,
      )}>
      {children ?? <Volume2Icon aria-hidden className="h-5 w-5" />}
    </button>
  );
}

/**
 * 词卡(spec §6.3,视觉稿 04):词头 34px、美 / 英音标各带 44px 朗读键、释义(最多 4 条)、
 * 首条例句(目标词琥珀高亮,译文可收起,可朗读)、短语(折叠,最多 5 条)。
 * 背单词 v2(spec 2026-10-11-wordbook-recall §3.1):`covered` 时释义 / 例句 / 短语换成遮罩按钮(不在 DOM 里);
 * `showExample` 关时不显示例句块;`badge` 显示在眉题右侧;`regionRef` 指向释义区(翻开后移焦点用)。都不传时与 v1 相同。
 * `defLang`:释义显示(`zh` 不显示英文释义,`en` 在有英文释义时不显示中文释义行;默认「仅英文」,没有英文释义的卡回退成中文)。
 * `phrasesOpen`:短语区初始状态,`"auto"` = 翻开后自动展开并记住手动开合(学新词页);默认折叠。
 */
export function WordCardView({
  card, eyebrow, onListen, listening, canListen = true, className, covered = false, onReveal, showExample = true, badge, regionRef,
  defLang = DEFAULT_DEF_LANG, phrasesOpen = false,
}: ListenProps & {
  card: Card; eyebrow?: ReactNode; className?: string;
  covered?: boolean; onReveal?: () => void; showExample?: boolean; badge?: ReactNode; regionRef?: Ref<HTMLDivElement>;
  defLang?: DefLang; phrasesOpen?: PhrasesOpen;
}) {
  const { t } = useTranslation();
  const regionId = useId();
  const [showZh, setShowZh] = useState(true);
  const example = card.examples[0];
  const phonetics = ([["us", card.us], ["uk", card.uk]] as const).filter(([, v]) => v);
  const listenProps = { onListen, listening, canListen };
  // 「仅英文」:有英文释义时中文行让位;缺口词(没有英文释义)回退成中文,否则答案是空的(计划 2026-10-13-defs-default R-A7)
  // 「中」小开关:只影响这一张卡的当前显示;记的是正在偷看的 card.key,换卡自动复位;不写服务端、不写本机(R-A9)
  const [peekKey, setPeekKey] = useState<string | null>(null);
  const peek = peekKey === card.key;
  const { groups: defGroups, showDefs, showSenses, canPeek } = defView(defLang, card, peek);
  const peekButton = canPeek && !covered ? (
    <button type="button" data-testid="def-peek" aria-pressed={peek} aria-label={t("web.wordbookDefs.peek.label")}
      onClick={() => setPeekKey((k) => (k === card.key ? null : card.key))}
      className={cn(
        "-my-2.5 -mr-2 inline-flex h-tap w-tap flex-none items-center justify-center rounded-button text-body font-semibold transition-colors duration-fast motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        peek ? "bg-surface-2 text-ink" : "text-ink-2",
      )}>
      <span aria-hidden>中</span>
    </button>
  ) : null;
  return (
    <SurfaceCard data-testid="word-card" className={cn("px-4 pb-4 pt-5", className)}>
      {eyebrow || badge || peekButton ? (
        <div className="flex min-h-[22px] items-center justify-between gap-2">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : <span />}
          {peekButton ? <div className="flex items-center gap-1.5">{badge}{peekButton}</div> : badge}
        </div>
      ) : null}
      <h2 lang="en" className="mt-1.5 break-words text-hero font-semibold tracking-[-0.02em]" style={{ lineHeight: 1.1 }}>{card.word}</h2>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {phonetics.length ? phonetics.map(([accent, value]) => (
          <ListenButton key={accent} id={`${card.key}:${accent}`} text={card.word} accent={accent === "uk" ? "gb" : "us"}
            label={t(`web.wordbook.word.listen.${accent}`)} {...listenProps}
            className="h-tap bg-surface-2 pl-1.5 pr-3 text-body text-ink">
            <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-surface text-blue shadow-hair">
              <Volume2Icon className="h-[18px] w-[18px]" />
            </span>
            <small aria-hidden className="text-label font-semibold tracking-[0.04em] text-ink-2">{t(`web.wordbook.word.accent.${accent}`)}</small>
            <span lang="en" className="font-[CharisSIL,ui-serif,serif]">{value}</span>
          </ListenButton>
        )) : (
          <ListenButton id={`${card.key}:word`} text={card.word} label={t("web.wordbook.word.listen.word")} {...listenProps}
            className="h-tap w-tap justify-center bg-blue-tint text-blue" />
        )}
      </div>
      {covered ? (
        <>
          <RecallCover controls={regionId} onReveal={() => onReveal?.()} />
          <div id={regionId} hidden />
        </>
      ) : (
        <div id={regionId} ref={regionRef} tabIndex={-1} className="outline-none">
          {showSenses ? (
            <ul className="mt-3.5 flex flex-col gap-1.5">
              {card.senses.slice(0, MAX_SENSES).map((s, i) => (
                <li key={i} className="text-body leading-dialogue">
                  {s.pos ? <em className="mr-1.5 font-mono text-meta font-semibold not-italic text-ink-2">{posLabel(s.pos)}</em> : null}
                  {s.text}
                </li>
              ))}
            </ul>
          ) : null}
          {showDefs ? <DefinitionsEn groups={defGroups} className={showSenses ? "mt-1.5" : "mt-3.5"} /> : null}
          {showExample && example ? (
            <div className="mt-3.5 rounded-badge bg-surface-2 p-3">
              <p lang="en" className="text-body leading-dialogue"><HighlightedSentence text={example.en} word={card.key} /></p>
              {showZh && example.zh ? <p className="mt-1 text-sub text-ink-2">{example.zh}</p> : null}
              <div className="-mx-2 -mb-2 mt-1.5 flex gap-1">
                <ListenButton id={`${card.key}:ex`} text={example.en} label={t("web.wordbook.word.listenExample")} {...listenProps}
                  className="px-2 text-meta font-medium text-ink-2">
                  <Volume2Icon aria-hidden className="h-[17px] w-[17px]" />{t("web.wordbook.word.listenExample")}
                </ListenButton>
                {example.zh ? (
                  <button type="button" aria-pressed={showZh} onClick={() => setShowZh((v) => !v)}
                    className="inline-flex min-h-tap items-center gap-1 rounded-button px-2 text-meta font-medium text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {showZh ? <EyeOffIcon aria-hidden className="h-[17px] w-[17px]" /> : <EyeIcon aria-hidden className="h-[17px] w-[17px]" />}
                    {t(showZh ? "web.wordbook.word.hideZh" : "web.wordbook.word.showZh")}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          <PhrasesSection phrases={card.phrases.slice(0, MAX_PHRASES)} mode={phrasesOpen} />
        </div>
      )}
      {covered ? null : <Slot point="wordDetailSections" props={{ word: card.key }} />}
    </SurfaceCard>
  );
}

/** 答错后显示的词卡摘要(词头、音标、前两条释义、例句)。 */
export function WordRecap({ card }: { card: Card }) {
  const example = card.examples[0];
  return (
    <div data-testid="word-recap" className="mt-3 rounded-badge bg-surface-2 p-3">
      <p className="flex items-baseline gap-2">
        <b lang="en" className="text-title font-semibold">{card.word}</b>
        {card.us || card.uk ? <span lang="en" className="text-meta text-ink-2">{card.us || card.uk}</span> : null}
      </p>
      <p className="mt-1 text-sub">{meaningLine(card.senses, 40)}</p>
      {example ? <p lang="en" className="mt-1 text-sub text-ink-2"><HighlightedSentence text={example.en} word={card.key} /></p> : null}
    </div>
  );
}
