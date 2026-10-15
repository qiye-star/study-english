import { CircleAlertIcon } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { SegmentedControl } from "~/components/segmented-control";
import { ToneBadge } from "~/components/tone-badge";
import { PRESETS, clamp, estimate, matchPreset, previewPlan, type GoalPreset } from "./goals-math";
import { GoalsStepper } from "./goals-stepper";
import { fmt } from "./ui";
import type { GoalLimits, GoalsPatch, OrderMode } from "./wordbook-api";

export interface GoalsValue { dailyNew: number; reviewCap: number | null; orderMode: OrderMode }
export interface GoalsToday { newDone: number; reviewDone: number; reviewDue: number; bonus: number }

const NEW_OPTIONS = [10, 20, 30, 50];
const REVIEW_OPTIONS = [50, 100, 200];
const LABEL = "mb-1.5 text-sub font-semibold text-ink-2";
const NOTE = "mt-2 flex items-start gap-2 rounded-badge bg-amber-tint px-3 py-2.5 text-sub font-medium text-amber liquid:rounded-inset liquid:bg-wash liquid:text-ink liquid:shadow-well";

const inRange = (n: number, r: { min: number; max: number }) => n >= r.min && n <= r.max;
const presetAllowed = (p: GoalPreset, l: GoalLimits) =>
  inRange(p.dailyNew, l.dailyNew) && (p.reviewCap === null ? l.reviewUnlimited : inRange(p.reviewCap, l.reviewCap));

/** 选书页草稿:把一次改动套到当前值上 */
export const applyPatch = (v: GoalsValue, p: GoalsPatch): GoalsValue => ({
  dailyNew: p.dailyNew ?? v.dailyNew,
  reviewCap: p.reviewUnlimited ? null : p.reviewCap ?? v.reviewCap,
  orderMode: p.orderMode ?? v.orderMode,
});

/** 服务端 Enrollment(或 config.defaults)→ 表单值;reviewCap null = 不限 */
export const valueOf = (e: { dailyNew: number; reviewCap: number; reviewUnlimited?: boolean; orderMode?: OrderMode }): GoalsValue => ({
  dailyNew: e.dailyNew, reviewCap: e.reviewUnlimited ? null : e.reviewCap, orderMode: e.orderMode ?? "shuffle",
});

/**
 * 每日目标字段(spec 2026-10-11 §2.2):方案卡、每日新词、复习上限(含不限)、今天预览、估算、顺序。
 * 面板里每次 onChange 立即保存;选书页把它当草稿。管理员范围外的预设与选项不可选。
 */
export function GoalsFields({ value, limits, remaining, today, onChange }: {
  value: GoalsValue;
  limits: GoalLimits;
  remaining: number;
  today?: GoalsToday | null;
  onChange: (patch: GoalsPatch) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [customNew, setCustomNew] = useState(false);
  const [customReview, setCustomReview] = useState(false);
  const preset = matchPreset(value.dailyNew, value.reviewCap);
  const newOptions = NEW_OPTIONS.filter((n) => inRange(n, limits.dailyNew));
  const reviewOptions = REVIEW_OPTIONS.filter((n) => inRange(n, limits.reviewCap));
  const newChoice = customNew || !newOptions.includes(value.dailyNew) ? "custom" : String(value.dailyNew);
  const reviewChoice = customReview ? "custom"
    : value.reviewCap === null ? (limits.reviewUnlimited ? "unlimited" : "custom")
    : reviewOptions.includes(value.reviewCap) ? String(value.reviewCap) : "custom";
  const est = estimate(value.dailyNew, value.reviewCap, remaining);
  const plan = today
    ? previewPlan({ dailyNew: value.dailyNew, reviewCap: value.reviewCap, ...today, guardThreshold: limits.reviewCap.max, remaining })
    : null;
  const capLabel = (cap: number | null) => (cap === null ? t("web.wordbook.goals.unlimited") : String(cap));

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <p id={`${id}-presets`} className={LABEL}>{t("web.wordbook.goals.presets.label")}</p>
          {preset ? null : <span data-testid="goals-preset-custom"><ToneBadge tone="gray">{t("web.wordbook.goals.presets.custom")}</ToneBadge></span>}
        </div>
        <div role="radiogroup" aria-labelledby={`${id}-presets`} className="space-y-2">
          {PRESETS.map((p) => {
            const e = estimate(p.dailyNew, p.reviewCap, remaining);
            const allowed = presetAllowed(p, limits);
            const on = preset === p.id;
            return (
              <button key={p.id} type="button" role="radio" aria-checked={on} disabled={!allowed} data-testid={`goals-preset-${p.id}`}
                onClick={() => onChange(p.reviewCap === null ? { dailyNew: p.dailyNew, reviewUnlimited: true } : { dailyNew: p.dailyNew, reviewCap: p.reviewCap })}
                className={cn(
                  "flex min-h-[56px] w-full items-center gap-3 rounded-card border-[0.5px] border-hair bg-surface px-3.5 py-2 text-left transition-colors duration-fast",
                  "active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                  on && "shadow-[inset_0_0_0_1.5px_rgb(var(--blue))]",
                )}>
                <span className="min-w-0 flex-1">
                  <b className="block text-body font-semibold">{t(`web.wordbook.goals.presets.${p.id}`)}</b>
                  <span className="num block text-meta text-ink-2">{t("web.wordbook.goals.presets.values", { n: p.dailyNew, cap: capLabel(p.reviewCap) })}</span>
                </span>
                {allowed ? (
                  <span className="flex-none text-right">
                    <span className="num block text-sub font-medium text-ink">{t("web.wordbook.goals.presets.days", { days: fmt(e.days), count: e.days })}</span>
                    <span className="num block text-meta text-ink-2">{t("web.wordbook.goals.presets.steady", { n: fmt(e.steady) })}</span>
                  </span>
                ) : (
                  <span className="flex-none text-meta text-ink-2">{t("web.wordbook.goals.presets.limited")}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p aria-hidden className={LABEL}>{t("web.wordbook.goals.dailyNew")}</p>
        <SegmentedControl label={t("web.wordbook.goals.dailyNew")} value={newChoice} className="flex w-full" optionClassName="flex-1 min-w-0 px-1"
          onChange={(v) => { if (v === "custom") setCustomNew(true); else { setCustomNew(false); onChange({ dailyNew: Number(v) }); } }}
          options={[...newOptions.map((n) => ({ value: String(n), label: String(n) })), { value: "custom", label: t("web.wordbook.goals.custom") }]} />
        {newChoice === "custom" ? (
          <div className="mt-2">
            <GoalsStepper label={t("web.wordbook.goals.dailyNew")} value={value.dailyNew} min={limits.dailyNew.min} max={limits.dailyNew.max}
              onCommit={(n) => onChange({ dailyNew: n })} testId="goals-new-stepper" />
          </div>
        ) : null}
      </div>

      <div>
        <p aria-hidden className={LABEL}>{t("web.wordbook.goals.reviewCap")}</p>
        <SegmentedControl label={t("web.wordbook.goals.reviewCap")} value={reviewChoice} className="flex w-full" optionClassName="flex-1 min-w-0 px-1"
          onChange={(v) => {
            if (v === "custom") { setCustomReview(true); return; }
            setCustomReview(false);
            onChange(v === "unlimited" ? { reviewUnlimited: true } : { reviewCap: Number(v) });
          }}
          options={[
            ...reviewOptions.map((n) => ({ value: String(n), label: String(n) })),
            ...(limits.reviewUnlimited ? [{ value: "unlimited", label: t("web.wordbook.goals.unlimited") }] : []),
            { value: "custom", label: t("web.wordbook.goals.custom") },
          ]} />
        {reviewChoice === "custom" ? (
          <div className="mt-2">
            <GoalsStepper label={t("web.wordbook.goals.reviewCap")}
              value={value.reviewCap ?? clamp(200, limits.reviewCap.min, limits.reviewCap.max)}
              min={limits.reviewCap.min} max={limits.reviewCap.max} step={10} onCommit={(n) => onChange({ reviewCap: n })} testId="goals-review-stepper" />
          </div>
        ) : null}
      </div>

      {plan ? (
        <div data-testid="goals-today" className="rounded-card bg-surface-2 px-3 py-2.5 text-sub">
          <p className="font-semibold text-ink-2">{t("web.wordbook.goals.today.label")}</p>
          <p className="num mt-1 text-ink">{t("web.wordbook.goals.today.new", { done: plan.newDone, target: plan.newTarget, left: plan.newLeft })}</p>
          <p className="num text-ink">
            {value.reviewCap === null
              ? t("web.wordbook.goals.today.reviewUnlimited", { done: plan.reviewDone, due: plan.reviewDue })
              : t("web.wordbook.goals.today.review", { done: plan.reviewDone, total: plan.reviewDone + plan.reviewLeft })}
          </p>
          {plan.backlogGuard ? (
            <p role="note" data-testid="goals-backlog" className={NOTE}>
              <CircleAlertIcon aria-hidden className="mt-px h-[17px] w-[17px] flex-none" />
              <span>{t("web.wordbook.goals.today.backlog", { due: plan.reviewDue, cap: value.reviewCap ?? limits.reviewCap.max })}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      <div data-testid="goals-estimate">
        <p className="num text-sub text-ink">
          {est.days > 0
            ? t("web.wordbook.goals.estimate.line", { days: fmt(est.days), steady: fmt(est.steady), count: est.days })
            : t("web.wordbook.goals.estimate.done")}
        </p>
        {est.overCap ? (
          <p role="note" data-testid="goals-overcap" className={NOTE}>
            <CircleAlertIcon aria-hidden className="mt-px h-[17px] w-[17px] flex-none" />
            <span>{t("web.wordbook.goals.estimate.overCap", { cap: value.reviewCap })}</span>
          </p>
        ) : null}
        {est.days > 0 ? (
          <p className="mt-1.5 text-meta leading-dialogue text-ink-2">{t("web.wordbook.goals.estimate.note", { finish: fmt(est.atFinish) })}</p>
        ) : null}
      </div>

      <div>
        <p aria-hidden className={LABEL}>{t("web.wordbook.goals.order.label")}</p>
        <SegmentedControl<OrderMode> label={t("web.wordbook.goals.order.label")} value={value.orderMode} className="flex w-full" optionClassName="flex-1 min-w-0"
          onChange={(v) => onChange({ orderMode: v })}
          options={[{ value: "shuffle", label: t("web.wordbook.books.order.shuffle") }, { value: "book", label: t("web.wordbook.books.order.book") }]} />
        <p className="mt-1.5 text-meta text-ink-2">{t("web.wordbook.goals.order.note")}</p>
      </div>
    </div>
  );
}
