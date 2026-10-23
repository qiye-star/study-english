import "./locales";
import "./dubbing.css";
import { CheckIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { type ClipProblem, type ClipSeg, type ClipSelection, clipProblem, clipStats, type ClipStats, selectRange } from "./clip";
import type { DubbingLimits, RoleKey } from "./dubbing-api";

export interface PickSeg extends ClipSeg {
  text: string;
}

export interface ClipReadiness {
  ok: boolean;
  problem: ClipProblem | null;
  stats: ClipStats | null;
}

/**
 * 片段是否可以继续(计划 L5 R6,与服务端同码)。role 为 null 表示还没选角色:只检查范围与长度,不检查角色。
 */
export function clipReadiness(
  segs: readonly ClipSeg[], sel: ClipSelection | null, role: RoleKey | null, limits: Pick<DubbingLimits, "maxLines" | "maxMs">,
): ClipReadiness {
  if (!sel || sel.to === null) return { ok: false, problem: null, stats: null };
  const stats = clipStats(segs, sel.from, sel.to, role ?? "A");
  const checked = role === null ? { ...stats, mine: Math.max(1, stats.mine) } : stats;
  const problem = clipProblem(checked, limits);
  return { ok: problem === null, problem, stats };
}

export type ClipMark = "none" | "half" | "start" | "mid" | "end" | "single";

/** 第 idx 句在选段里的位置(只点了起点时是 half)。样式在 dubbing.css 的 [data-sel] 规则里。 */
export function clipMark(selection: ClipSelection | null, idx: number): ClipMark {
  if (!selection) return "none";
  if (selection.to === null) return idx === selection.from ? "half" : "none";
  if (idx < selection.from || idx > selection.to) return "none";
  if (selection.from === selection.to) return "single";
  return idx === selection.from ? "start" : idx === selection.to ? "end" : "mid";
}

const MARK_KEY: Partial<Record<ClipMark, string>> = {
  half: "web.dubbing.clip.mark.start",
  start: "web.dubbing.clip.mark.start",
  end: "web.dubbing.clip.mark.end",
  single: "web.dubbing.clip.mark.both",
};

const PROBLEM_KEY: Record<ClipProblem, string> = {
  clip: "web.dubbing.errors.badClip",
  clip_too_long: "web.dubbing.errors.clipTooLong",
  role_missing: "web.dubbing.errors.roleMissing",
};

/** 句子列表:点第一句、再点最后一句框出片段(计划 L5 W8)。marker 插在每句前面(角色小标)。 */
export function ClipPicker({
  segments, selection, role, limits, onSelect, renderMarker, poster,
}: {
  segments: readonly PickSeg[];
  selection: ClipSelection | null;
  role: RoleKey | null;
  limits: Pick<DubbingLimits, "maxLines" | "maxMs">;
  onSelect(next: ClipSelection): void;
  renderMarker?(idx: number): ReactNode;
  /** 封面的临时地址(票据由 kit 取得);没有封面时不显示图片。 */
  poster?: string | null;
}) {
  const { t } = useTranslation();
  const readiness = clipReadiness(segments, selection, role, limits);
  return (
    <section>
      {poster ? <img src={poster} alt="" className="mb-3 aspect-video w-full rounded-2xl object-cover" /> : null}
      <p className="mb-2 text-[13px] opacity-80">{t("web.dubbing.clip.hint")}</p>
      <ol className="space-y-1.5">
        {segments.map((seg) => {
          const mark = clipMark(selection, seg.idx);
          return (
            // marker 与句子按钮并排:按钮里不能再嵌按钮,否则点角色小标会冒泡成"点这一句",把已选的片段清掉。
            <li key={seg.idx} data-sel={mark} className="dub-clip-row flex items-start gap-2 rounded-xl px-3">
              {renderMarker ? <span className="shrink-0 self-center">{renderMarker(seg.idx)}</span> : null}
              <button
                type="button"
                aria-pressed={mark !== "none"}
                onClick={() => onSelect(selectRange(selection, seg.idx))}
                className="flex w-full items-center gap-2 py-2 text-left text-[14px]"
              >
                <span className={`dub-clip-text min-w-0 flex-1 ${mark === "none" ? "" : "font-medium"}`}>{seg.text}</span>
                {MARK_KEY[mark] ? <span className="dub-mark">{t(MARK_KEY[mark]!)}</span> : null}
                {mark === "mid" ? <CheckIcon data-testid="clip-check" aria-hidden="true" className="h-4 w-4 shrink-0" /> : null}
              </button>
            </li>
          );
        })}
      </ol>
      <footer className="mt-3 text-[13px]">
        <p>
          {readiness.stats
            ? t("web.dubbing.clip.summary", { lines: readiness.stats.lines, seconds: Math.round(readiness.stats.ms / 1000) })
            : selection ? t("web.dubbing.clip.half", { n: selection.from + 1 }) : t("web.dubbing.clip.none")}
        </p>
        {readiness.problem ? <p role="alert" className="mt-1">{t(PROBLEM_KEY[readiness.problem])}</p> : null}
      </footer>
    </section>
  );
}
