import { HeadphonesIcon, LoaderIcon, MicIcon, SquareIcon, Volume2Icon } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import type { RecordingStarter } from "~/audio/use-recorder";
import { IconButton } from "~/components/icon-button";
import { scoreBadgeTone, type ScoreTone } from "~/components/score-tone";
import { ToneBadge } from "~/components/tone-badge";
import { formatClock } from "~/lib/format-clock";
import { AnalysisCard } from "./analysis-card";
import type { SavedSegment } from "./attempts-api";
import { useLibraryConfig } from "./config";
import type { LibrarySegment } from "./library-api";
import "./locales";
import { useSaveSentence } from "./save-sentence";
import { ScoreCard } from "./score-card";
import { SegmentEditor } from "./segment-editor";
import { SegmentMenu } from "./segment-menu";
import type { PlayerHandle } from "./use-media-player";
import { useShadowing } from "./use-shadowing";
import { clearWordScores, publishWordScores, selectWord, tokenizeSentence, useScoredWords, wordTones } from "./word-tap";

/** 逐词着色(R-SH09):低分另加点状下划线,不只靠颜色。 */
const WORD_TONE: Record<ScoreTone, string> = {
  good: "text-green",
  fair: "text-amber",
  low: "text-ink-2 underline decoration-dotted decoration-2 underline-offset-4",
};

export interface SegmentTextProps {
  segment: LibrarySegment;
  active: boolean;
}

/**
 * 句子文字(W1 的 segment-list 把它渲染在每一行的点击 = 跳播容器里,W1 计划 R-L16):一个 data-lookup-context 容器,
 * 每个词一个 span。点词 = 程序化选中该词(selectWord),稳定 300 ms 后全局 LookupLayer 出现选中操作条(R-SH15);
 * 词的点击 stopPropagation,不触发 W1 容器的跳播。刚评过的这一句按逐词结果着色(R-SH09、R-SH31)。
 * data-segment-text 给「复制句子」的选中文字回退用(segment-menu.tsx)。
 * 整句另有一份 sr-only 文字放在查词容器**外面**:读屏器读整句而不是逐词(逐词的 span 对读屏器隐藏),也让 W1 的列表 / 播放器测试里
 * 「按整句文字找元素」的断言继续成立;放在容器外,所以查词的上下文(容器的 textContent)不会重复。
 */
export function SegmentText({ segment }: SegmentTextProps): ReactElement {
  const tokens = useMemo(() => tokenizeSentence(segment.text), [segment.text]);
  const scored = useScoredWords(segment.idx, segment.text);
  const tones = useMemo(() => wordTones(tokens, scored ?? undefined), [tokens, scored]);
  return (
    <>
      <span className="sr-only">{segment.text}</span>
      <p data-lookup-context data-segment-text={segment.idx} aria-hidden className="select-text break-words">
        {tokens.map((tok, i) => {
          if (tok.word < 0) return <Fragment key={i}>{tok.text}</Fragment>;
          const tone = tones[tok.word];
          return (
            <span
              key={i} data-word={tok.word}
              className={cn("cursor-pointer rounded-inline active:bg-blue-tint", tone && WORD_TONE[tone])}
              onClick={(e) => {
                e.stopPropagation();
                selectWord(e.currentTarget);
              }}
            >
              {tok.text}
            </span>
          );
        })}
      </p>
    </>
  );
}

/** W1 的 segment-list.tsx 传入(R-SH02);starter 是 W2 追加的可选 prop(测试注入录音启动器);译文由 W1 的 useTranslations 取,没有 translate prop。 */
export interface ShadowPanelProps {
  itemId: string;
  segment: LibrarySegment;
  /** 当前句:只有它渲染操作行与卡片 */
  active: boolean;
  durationMs: number;
  prevEndMs: number | null;
  nextStartMs: number | null;
  player: PlayerHandle | null;
  onSegmentSaved(next: LibrarySegment): void;
  /** 测试注入的录音启动器 */
  starter?: RecordingStarter;
}

/** 微调保存后的新句子:起止与文字取服务端回的;文字变了就清掉译文与分析(E11,R-SH34)。 */
export function mergeSaved(segment: LibrarySegment, saved: SavedSegment): LibrarySegment {
  const next: LibrarySegment = { ...segment, startMs: saved.startMs, endMs: saved.endMs, text: saved.text };
  const textChanged = saved.text !== segment.text;
  return textChanged ? { ...next, zh: null, zhLang: null, hasAnalysis: false, analysisLang: null } : next;
}

const RECORD_BUTTON = cn(
  "inline-flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-button bg-blue px-4 text-body font-semibold text-on-blue",
  "transition-colors duration-fast active:bg-blue/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  "disabled:pointer-events-none disabled:opacity-40 [&_svg]:h-5 [&_svg]:w-5 [&_svg]:flex-none",
);

/**
 * 句子行下面的跟读区(spec §11.4、D8;R-SH03):只有当前句渲染操作行与卡片,其余行什么也不渲染。
 * 译文由 W1 的 `useTranslations`(player-page.tsx)取,这里不再有行级的译文钩子(ruling 3)。
 */
export function ShadowPanel(props: ShadowPanelProps): ReactElement | null {
  if (!props.active) return null;
  return (
    <div data-shadow-row={props.segment.idx} data-testid="shadow-panel">
      <ActivePanel {...props} />
    </div>
  );
}

function ActivePanel({ itemId, segment, durationMs, prevEndMs, nextStartMs, player, onSegmentSaved, starter }: ShadowPanelProps) {
  const { t } = useTranslation();
  const config = useLibraryConfig();
  const aiEnabled = config?.ai === true;
  const { idx, text } = segment;
  const pauseMedia = useCallback(() => {
    if (player) player.pause();
    else document.querySelectorAll<HTMLMediaElement>("video, audio").forEach((m) => m.pause());
  }, [player]);
  const shadow = useShadowing({ itemId, segment: { idx, text }, pauseMedia, starter });
  const save = useSaveSentence(text);
  const [menuOpen, setMenuOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    // 文字变了(微调改字):分析是旧文字的,收起;编辑器随保存关闭(R-SH34)
    setAnalysisOpen(false);
    setEditing(false);
  }, [text]);

  const result = shadow.result;
  useEffect(() => {
    if (!result) return undefined;
    publishWordScores(idx, text, result.words); // SegmentText 按它给词着色(R-SH31)
    return () => clearWordScores(idx, text);
  }, [result, idx, text]);

  const { phase, best } = shadow;
  const recording = phase === "recording";
  const busy = phase === "assessing" || phase === "starting";

  return (
    <div className="space-y-2 px-1.5 pb-2 pt-1">
      {best && typeof best.bestScore === "number" && (
        <div data-testid="shadow-best" className="flex justify-end">
          <ToneBadge tone={scoreBadgeTone(best.bestScore)}>{t("web.library.shadow.best", { score: Math.round(best.bestScore) })}</ToneBadge>
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <IconButton
          label={t("web.library.shadow.listenOriginal")} data-testid="shadow-listen" disabled={!player || recording || busy}
          onClick={() => {
            shadow.stopMine();
            player?.playOnce(idx);
          }}
        >
          <Volume2Icon aria-hidden />
        </IconButton>
        <button
          type="button" data-testid="shadow-record" data-state={phase} className={RECORD_BUTTON} disabled={busy}
          aria-label={recording ? t("web.library.shadow.stop") : t("web.library.shadow.record")}
          onClick={() => void shadow.toggle()}
        >
          {busy ? <LoaderIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
            : recording ? <SquareIcon aria-hidden className="fill-current" /> : <MicIcon aria-hidden />}
          <span aria-hidden className="num">
            {phase === "assessing" ? t("web.library.shadow.assessing") : recording ? formatClock(shadow.elapsedMs) : t("web.library.shadow.record")}
          </span>
        </button>
        <IconButton
          label={shadow.playingMine ? t("web.library.shadow.stopMine") : t("web.library.shadow.listenMine")}
          data-testid="shadow-mine" data-state={shadow.playingMine ? "playing" : "idle"}
          disabled={!shadow.canPlayMine || recording || phase === "starting"} onClick={shadow.playMine}
        >
          {shadow.playingMine ? <SquareIcon aria-hidden /> : <HeadphonesIcon aria-hidden />}
        </IconButton>
        <SegmentMenu
          idx={idx} text={text} open={menuOpen} onOpenChange={setMenuOpen} aiEnabled={aiEnabled} analysisOpen={analysisOpen}
          busy={recording || busy} save={save} onAnalysis={() => setAnalysisOpen((v) => !v)} onEdit={() => setEditing(true)}
        />
      </div>
      {shadow.error && <p role="alert" data-testid="shadow-error" className="text-sub text-destructive">{shadow.error}</p>}
      {result && <ScoreCard key={result.assessmentId} scores={result.scores} attemptSaved={result.attemptSaved} save={save} />}
      {analysisOpen && <AnalysisCard itemId={itemId} segment={segment} />}
      {editing && (
        <SegmentEditor
          key={idx} itemId={itemId} segment={segment} prevEndMs={prevEndMs} nextStartMs={nextStartMs} durationMs={durationMs}
          onSaved={(saved) => onSegmentSaved(mergeSaved(segment, saved))} onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
