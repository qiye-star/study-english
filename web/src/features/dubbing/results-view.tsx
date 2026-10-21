import "./locales";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ClipSeg } from "./clip";
import type { DubbingTake, SyncBasis } from "./dubbing-api";
import type { LineOutcome } from "./line-queue";

/**
 * 配音结果页(计划 L5 W10):总分、三项子分、逐句行(分数、同步依据、缺句原因、「原声 / 我的」回放)。
 * 回放由调用方注入的 player 完成(compare-player.ts 保证两者互斥)。stage 是视频舞台的插槽。
 */

export interface ResultPlayer {
  original(idx: number): void;
  mine(url: string): void;
  stop(): void;
}

const BASIS_KEY: Record<SyncBasis, string> = {
  words: "web.dubbing.result.basisWords",
  duration: "web.dubbing.result.basisDuration",
  none: "web.dubbing.result.basisNone",
};

const REASON_KEY: Record<string, string> = {
  not_recorded: "web.dubbing.result.reasons.notRecorded",
  no_speech: "web.dubbing.result.reasons.noSpeech",
  failed: "web.dubbing.result.reasons.failed",
  timeout: "web.dubbing.result.reasons.timeout",
  aborted: "web.dubbing.result.reasons.aborted",
};

export function ResultsView({
  take, segs, outcomes, mineUrls, player, stage, onRetry, onExit,
}: {
  take: DubbingTake;
  segs: readonly (ClipSeg & { text: string })[];
  outcomes: readonly LineOutcome[];
  mineUrls: ReadonlyMap<number, string>;
  player: ResultPlayer;
  stage?: ReactNode;
  onRetry(): void;
  onExit(): void;
}) {
  const { t } = useTranslation();
  const summary = take.summary;
  const show = (n: number | null | undefined) => (n === null || n === undefined ? "—" : String(Math.round(n)));

  return (
    <div className="space-y-4">
      {stage}
      <section className="text-center">
        <p className="text-[12px] opacity-80">{t("web.dubbing.result.total")}</p>
        <p data-testid="total" className="text-[44px] font-bold tabular-nums">{show(take.totalScore)}</p>
        <div className="mt-1 flex justify-center gap-3 text-[12px] opacity-90">
          <span>{t("web.dubbing.result.pronunciation")} {show(summary?.pronunciation)}</span>
          <span>{t("web.dubbing.result.fluency")} {show(summary?.fluency)}</span>
          <span>{t("web.dubbing.result.timing")} {show(summary?.sync)}</span>
        </div>
      </section>

      <ul className="space-y-2">
        {take.expected.map((idx) => {
          const seg = segs[idx];
          const line = take.lines.find((l) => l.segIdx === idx);
          const outcome = outcomes.find((o) => o.idx === idx);
          const url = mineUrls.get(idx);
          const scored = line && !("missing" in line) ? line : null;
          const missingReason = outcome && outcome.status === "missing" ? outcome.reason
            : line && "missing" in line ? line.reason : null;
          const reasonKey = missingReason ? REASON_KEY[missingReason] ?? "web.dubbing.errors.unknown" : null;
          return (
            <li key={idx} className="rounded-2xl bg-white/10 px-4 py-3">
              <p className="text-[14px]">{seg?.text ?? ""}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] opacity-90">
                {scored ? (
                  <>
                    <span className="rounded-lg bg-white/20 px-2 py-0.5 font-semibold tabular-nums">{Math.round(scored.score)}</span>
                    <span>{t(BASIS_KEY[scored.syncBasis])}</span>
                  </>
                ) : null}
                {reasonKey ? <span>{t(reasonKey)}</span> : null}
                {line?.stale ? <span>{t("web.dubbing.result.stale")}</span> : null}
              </div>
              <div className="mt-2 flex gap-2">
                <button type="button" data-action="original" onClick={() => player.original(idx)} className="rounded-lg bg-white/15 px-3 py-1 text-[12px]">
                  {t("web.dubbing.result.original")}
                </button>
                <button
                  type="button"
                  data-action="mine"
                  disabled={!url}
                  onClick={() => url && player.mine(url)}
                  className="rounded-lg bg-white/15 px-3 py-1 text-[12px] disabled:opacity-40"
                >
                  {t("web.dubbing.result.mine")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => { player.stop(); onRetry(); }} className="rounded-2xl bg-white/30 py-3 text-[14px] font-semibold">
          {t("web.dubbing.result.again")}
        </button>
        <button type="button" onClick={() => { player.stop(); onExit(); }} className="rounded-2xl bg-white/15 py-3 text-[14px]">
          {t("web.dubbing.result.change")}
        </button>
      </div>
    </div>
  );
}
