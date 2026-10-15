import { CheckIcon, ChevronRightIcon, CircleAlertIcon, CircleIcon, ClockIcon, MicIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { IconChip } from "~/components/icon-chip";
import { SectionGroup } from "~/components/section-group";
import { ToneBadge } from "~/components/tone-badge";
import { cn } from "~/lib/cn";
import type { Match, Verdict } from "./rank-api";
import { TierBadge } from "./tier-badge";
import { divisionLabel, formatCountdown } from "./tiers";
import { CARD, GHOST_BUTTON } from "./ui";
import { lookupContext } from "~/lib/lookup-context";

const DIMS = ["task", "accuracy", "range", "interaction"] as const;

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/**
 * 结果页(设计稿 R3/R4):通过 = green 标题 + 新段位徽章;未通过 = 墨色标题、原因用次要灰,不用 red
 * (red 只属于挂断/退出,design-notes)。维度条一律钴蓝:维度是中性的度量,不按分数上色。
 */
export function MatchResult({ match, verdict, onDrill }: { match: Match; verdict: Verdict | null; onDrill: (text: string) => void }) {
  const { t } = useTranslation();
  const cooling = !!verdict?.cooldownUntil;
  const now = useNow(cooling);
  if (!verdict) {
    return (
      <div data-testid="match-result" data-passed="false" className="flex flex-col items-center gap-4 px-gutter py-16 text-center">
        <p className="text-sub text-ink-2">{t("web.rank.match.ended")}</p>
        <Link to="/rank" className={cn(GHOST_BUTTON, "w-auto px-6")}>{t("web.rank.result.backHome")}</Link>
      </div>
    );
  }
  const rows = [
    ...DIMS.map((k) => ({ key: k, ratio: verdict.dimensions[k] / 4, label: `${verdict.dimensions[k]}/4` })),
    ...(verdict.dimensions.speech === null ? [] : [{ key: "speech", ratio: verdict.dimensions.speech / 100, label: String(Math.round(verdict.dimensions.speech)) }]),
  ];
  const tier = verdict.passed && verdict.newTier ? verdict.newTier : match.fromTier;
  const division = verdict.passed && verdict.newTier ? 3 : 1;
  const notes = [
    { key: "strengths", items: verdict.strengthsZh },
    { key: "improve", items: verdict.improveZh },
  ].filter((n) => n.items.length > 0);
  return (
    <div data-testid="match-result" data-passed={String(verdict.passed)} className="px-gutter pb-8">
      <section className="flex flex-col items-center pt-1 text-center">
        <TierBadge tier={tier} division={division} size="lg" />
        <h2 className={cn("mt-[18px] text-headline font-semibold", verdict.passed ? "text-green" : "text-ink")}>
          {t(verdict.passed ? "web.rank.result.passed" : "web.rank.result.failed")}
        </h2>
        <p className="mt-1 text-sub text-ink-2">
          <b className="mr-0.5 text-stat font-semibold tabular-nums text-ink">{verdict.total}</b>
          {t("web.rank.result.points")} · {t("web.rank.result.passMark", { threshold: verdict.threshold })}
        </p>
        {verdict.passed && (
          <div className="mt-2.5 flex gap-1.5">
            {match.attemptNo === 1 && <ToneBadge tone="green"><CheckIcon aria-hidden />{t("web.rank.achievements.items.first_try")}</ToneBadge>}
            <ToneBadge tone="blue">{`${t(`web.rank.tiers.${tier}`)} ${divisionLabel(division)}`.trim()}</ToneBadge>
          </div>
        )}
        {verdict.gatesFailed.map((g) => (
          <p key={g} className="mt-1.5 inline-flex items-center gap-1.5 text-sub text-ink-2">
            <CircleAlertIcon aria-hidden className="size-4 flex-none" /><span>{t(`web.rank.result.gates.${g}`)}</span>
          </p>
        ))}
      </section>

      <SectionGroup title={t("web.rank.result.scores")} bare>
        <ul className={cn("grid gap-2.5 px-3.5 py-3", CARD)}>
          {rows.map((r) => (
            <li key={r.key} data-testid="dimension" className="grid grid-cols-[86px_1fr_34px] items-center gap-2.5 text-sub">
              <span className="text-ink-2">{t(`web.rank.result.dimensions.${r.key}`)}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <span className="block h-full rounded-full bg-blue" style={{ width: `${Math.round(Math.min(1, Math.max(0, r.ratio)) * 100)}%` }} />
              </span>
              <span className="text-right tabular-nums text-ink-2">{r.label}</span>
            </li>
          ))}
        </ul>
        {!verdict.speechAvailable && <p className="mx-0.5 mt-2 text-meta text-ink-2">{t("web.rank.result.noSpeech")}</p>}
      </SectionGroup>

      {match.scenario.functions.length > 0 && (
        <SectionGroup title={t("web.rank.result.goalsMet")}>
          {match.scenario.functions.map((f) => {
            const met = verdict.functionsMet.includes(f);
            return (
              <div key={f} data-testid="goal" data-met={String(met)} className="flex min-h-11 items-center gap-2 px-3.5 text-sub">
                {met ? <CheckIcon aria-hidden className="size-4 flex-none text-green" /> : <CircleIcon aria-hidden className="size-4 flex-none text-ink-3" />}
                <span {...lookupContext} className={met ? "text-ink" : "text-ink-2"}>{f}</span>
              </div>
            );
          })}
        </SectionGroup>
      )}

      {notes.length > 0 && (
        <SectionGroup title={t("web.rank.result.notes")}>
          {notes.map((n) => (
            <div key={n.key} className="px-3.5 py-3 text-sub leading-normal">
              <b className="mb-[3px] block text-meta font-semibold text-ink-2">{t(`web.rank.result.${n.key}`)}</b>
              {n.items.map((s) => <p key={s}>{s}</p>)}
            </div>
          ))}
        </SectionGroup>
      )}

      {verdict.passed ? (
        verdict.drillEn && (
          <SectionGroup title={t("web.rank.result.drill")} bare>
            <div className={cn("p-3.5", CARD)}>
              <p {...lookupContext} className="text-title font-medium leading-[1.45]">{verdict.drillEn}</p>
              <button type="button" data-testid="match-drill" className={cn(GHOST_BUTTON, "mt-3 h-tap text-sub")} onClick={() => onDrill(verdict.drillEn)}>
                <MicIcon aria-hidden />{t("web.rank.result.practiceDrill")}
              </button>
            </div>
          </SectionGroup>
        )
      ) : (verdict.cooldownUntil || verdict.drillEn) && (
        <SectionGroup title={t("web.rank.result.next")}>
          {verdict.cooldownUntil && (
            <div className="flex min-h-row items-center gap-3 py-2.5 pl-3.5 pr-3">
              <IconChip tone="gray" icon={ClockIcon} />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium">{t("web.rank.result.cooldownTitle")}</span>
                <span className="mt-0.5 block text-meta tabular-nums text-ink-2">
                  {t("web.rank.result.cooldown", { time: formatCountdown(Date.parse(verdict.cooldownUntil) - now) })}
                </span>
              </span>
            </div>
          )}
          {verdict.drillEn && (
            <button type="button" data-testid="match-drill" onClick={() => onDrill(verdict.drillEn)}
              className="flex min-h-row w-full items-center gap-3 py-2.5 pl-3.5 pr-3 text-left transition-colors duration-fast active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
              <IconChip tone="blue" icon={MicIcon} />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium">{verdict.drillEn}</span>
                <span className="mt-0.5 block text-meta text-ink-2">{`${t("web.rank.result.drill")} · ${t("web.rank.result.practiceDrill")}`}</span>
              </span>
              <ChevronRightIcon aria-hidden className="size-[18px] flex-none text-ink-3" />
            </button>
          )}
        </SectionGroup>
      )}
      <Link to="/rank" data-testid="match-back" className={cn(GHOST_BUTTON, "mt-[18px]")}>{t("web.rank.result.backHome")}</Link>
    </div>
  );
}
