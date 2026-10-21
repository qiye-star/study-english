import "./locales";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { LineOutcome } from "./line-queue";

/**
 * 录制页(计划 L5 W9):倒计时 3-2-1 叠在画面上(视频不停)、「轮到你」状态、逐句评测状态点。
 * 点停止先确认;确认后放弃这一遍(释放麦克风,本遍作废)。
 */
export function RecordingView({
  countdown, yourTurn, expected, outcomes, onAbandon,
}: {
  countdown: 3 | 2 | 1 | null;
  yourTurn: boolean;
  expected: readonly number[];
  outcomes: readonly LineOutcome[];
  onAbandon(): void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  const statusOf = (idx: number): "pending" | "done" | "silent" | "failed" => {
    const o = outcomes.find((x) => x.idx === idx);
    if (!o) return "pending";
    if (o.status === "scored") return "done";
    return o.reason === "no_speech" ? "silent" : "failed";
  };
  const DOT_LABEL = { pending: "Queued", done: "Scored", silent: "No speech", failed: "Failed" } as const;

  return (
    <div className="space-y-4">
      <div className="flex h-16 items-center justify-center rounded-2xl bg-white/10">
        {countdown !== null ? (
          <span data-testid="countdown" className="text-[40px] font-bold tabular-nums">{countdown}</span>
        ) : (
          <span className="text-[14px] opacity-80">{t("web.dubbing.recording.waiting")}</span>
        )}
      </div>
      {yourTurn ? <p className="text-center text-[13px] font-semibold">{t("web.dubbing.recording.yourTurn")}</p> : null}

      <ul className="flex flex-wrap gap-2" aria-label={t("web.dubbing.recording.progress")}>
        {expected.map((idx) => {
          const status = statusOf(idx);
          return (
            <li
              key={idx}
              aria-label={`Sentence ${idx + 1}: ${DOT_LABEL[status]}`}
              className={`h-3 w-3 rounded-full ${status === "done" ? "bg-white" : status === "pending" ? "bg-white/30" : "bg-white/60"}`}
            />
          );
        })}
      </ul>

      <button type="button" onClick={() => setConfirming(true)} className="w-full rounded-2xl bg-white/15 py-3 text-[14px]">
        {t("web.dubbing.recording.stop")}
      </button>

      {confirming ? (
        <div role="dialog" aria-label="Stop this take?" className="rounded-2xl bg-white/20 p-4 text-[14px]">
          <p className="font-semibold">{t("web.dubbing.recording.confirmTitle")}</p>
          <p className="mt-1 opacity-80">{t("web.dubbing.recording.confirmBody")}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setConfirming(false)} className="flex-1 rounded-xl bg-white/15 py-2">
              {t("web.dubbing.recording.keep")}
            </button>
            <button type="button" onClick={onAbandon} className="flex-1 rounded-xl bg-white/30 py-2 font-semibold">
              {t("web.dubbing.recording.abandon")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
