import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { SurfaceCard } from "~/components/surface-card";
import type { BlankResult, ClozeSet, Segment } from "../wordbook-api";
import type { ClozeState } from "./cloze-engine";
import { OUTCOME_TEXT, OutcomeBadge } from "./outcome-badge";

/**
 * 挖空句组板(视觉稿 06/07):编号句子,每个空是只读 textbox(真正的输入在隐藏 <input> 里)。
 * 当前空 = 蓝色下划线 + 蓝色浅底 + 光标;已填 = ink 下划线;未填 = 发丝线。提交后(results)每空后面加结果徽标。
 */
export function ClozeBoard({
  set,
  state,
  showLength,
  showZh,
  onFocusBlank,
  results,
}: {
  set: ClozeSet;
  state: ClozeState;
  showLength: boolean;
  showZh: boolean;
  onFocusBlank: (i: number) => void;
  results?: BlankResult[];
}) {
  const { t } = useTranslation();
  const total = state.values.length;
  const byIndex = new Map((results ?? []).map((r) => [r.i, r]));
  const submitted = results !== undefined;

  const blank = (seg: Extract<Segment, { t: "blank" }>) => {
    const text = state.values[seg.i] ?? "";
    const current = !submitted && seg.i === state.active;
    const result = byIndex.get(seg.i);
    const cells = showLength && !submitted && text === "";
    return (
      <span className="whitespace-nowrap">
        <span
          role="textbox"
          aria-readonly="true"
          aria-label={t("web.wordbookSpell.blank", { n: seg.i + 1, total })}
          aria-current={current ? "true" : undefined}
          data-blank={seg.i}
          // 按下不抢走隐藏输入框的焦点;点击(手势内)再聚焦,iOS 才弹键盘
          onMouseDown={(e) => e.preventDefault()}
          onClick={submitted ? undefined : () => onFocusBlank(seg.i)}
          className={cn(
            "relative inline-block px-[3px] text-center font-semibold leading-[1.35]",
            // 视觉高 ~25px,命中区上下各扩 10px ≥ 44px
            "before:absolute before:inset-x-0 before:inset-y-[-10px] before:content-['']",
            !submitted && "cursor-text",
            cells ? "min-w-0 border-b-0" : "min-w-[3.4em] border-b-2",
            !cells && (text ? "border-ink text-ink" : "border-hair text-ink"),
            current && !cells && "rounded-t-[6px] border-blue bg-blue-tint text-blue",
            current && cells && "rounded-t-[6px] bg-blue-tint text-blue",
            current && "after:ml-px after:inline-block after:h-[1.05em] after:w-[2px] after:bg-blue after:align-[-2px] after:content-[''] motion-safe:after:animate-caret",
            result && OUTCOME_TEXT[result.outcome],
            result && (result.outcome === "correct" ? "border-green" : result.outcome === "wrong" ? "border-hair line-through" : "border-amber"),
          )}
        >
          {cells ? (
            <span aria-hidden className="inline-flex gap-[0.12em] align-baseline">
              {Array.from({ length: Math.max(seg.len, 1) }, (_, k) => (
                <span key={k} data-testid="letter-cell" className={cn("inline-block h-[1.1em] w-[0.62em] border-b-2", current ? "border-blue" : "border-hair")} />
              ))}
            </span>
          ) : (
            text || " "
          )}
        </span>
        {result ? <OutcomeBadge outcome={result.outcome} className="ml-1 -translate-y-px" /> : null}
      </span>
    );
  };

  return (
    <SurfaceCard className="px-3.5 py-1.5">
      <ol>
        {set.lines.map((line, n) => (
          <li key={line.sentenceId} className="flex gap-2.5 border-t-[0.5px] border-hair-2 py-2.5 first:border-t-0">
            <span aria-hidden className="w-3.5 flex-none pt-[5px] text-meta font-semibold tabular-nums text-ink-2">
              {n + 1}
            </span>
            <div className="min-w-0 flex-1 break-words text-[17px] leading-[2.05] tracking-[-0.005em] text-ink">
              {line.segments.map((seg, k) => (
                <Fragment key={k}>{seg.t === "text" ? seg.v : blank(seg)}</Fragment>
              ))}
              {showZh ? <span className="mt-0.5 block text-sub leading-[1.5] text-ink-2">{line.zh}</span> : null}
            </div>
          </li>
        ))}
      </ol>
    </SurfaceCard>
  );
}
