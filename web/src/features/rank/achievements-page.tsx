import type { TFunction } from "i18next";
import {
  AwardIcon, BookOpenIcon, CrownIcon, DiamondIcon, FlagIcon, FlameIcon, LibraryBigIcon, MessagesSquareIcon, MicIcon, ShieldCheckIcon,
  TargetIcon,
  TrendingUpIcon, UsersRoundIcon, WandSparklesIcon, type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "~/auth/auth-context";
import { FeatureGate, type GateState } from "~/components/feature-gate";
import { SectionGroup } from "~/components/section-group";
import { PageHeader } from "~/layout/page-header";
import { cn } from "~/lib/cn";
import { fetchAchievements, fetchRankConfig, type AchievementItem, type TierKey } from "./rank-api";
import { TIER_ICONS } from "./tiers";

const GROUPS = ["streak", "rank", "speech", "chat", "vocab", "rooms", "season"] as const;
/** 服务端成就目录(app/rank/achievements.py)里的图标名 → lucide 图形 */
const ICONS: Record<string, LucideIcon> = {
  flame: FlameIcon, "trending-up": TrendingUpIcon, target: TargetIcon, microphone: MicIcon, "chart-line": TrendingUpIcon,
  messages: MessagesSquareIcon, cards: BookOpenIcon, "users-group": UsersRoundIcon, wand: WandSparklesIcon, flag: FlagIcon,
  "shield-star": ShieldCheckIcon, diamond: DiamondIcon, crown: CrownIcon, book: LibraryBigIcon,
};
/** 一色一义(设计稿 R5):连续 = amber、发音 = green、词汇 = teal、段位图形 = 墨色,其余(段位、对话、联机、赛季)= blue。 */
const TONES: Record<string, string> = { streak: "bg-amber-tint text-amber", vocab: "bg-teal-tint text-teal", speech: "bg-green-tint text-green" };
const TIER_TONE = "bg-surface-2 text-ink";
const SEASON = /^season_(\d+)_([a-z]+)$/;
const TIER_ACHIEVEMENT = /^tier_[a-z]+$/;

export function achievementTitle(t: TFunction, key: string): string {
  const m = SEASON.exec(key);
  if (m) return t("web.rank.achievements.items.season", { id: m[1], tier: t(`web.rank.tiers.${m[2]}`) });
  return t(`web.rank.achievements.items.${key}`);
}

export function achievementCondition(t: TFunction, key: string): string {
  return SEASON.test(key) ? t("web.rank.achievements.conditions.season") : t(`web.rank.achievements.conditions.${key}`);
}

export function iconFor(item: AchievementItem): LucideIcon {
  const tier = SEASON.exec(item.key)?.[2] as TierKey | undefined;
  if (tier && tier in TIER_ICONS) return TIER_ICONS[tier];
  return ICONS[item.icon] ?? AwardIcon;
}

export function toneFor(item: AchievementItem): string {
  if (SEASON.test(item.key) || TIER_ACHIEVEMENT.test(item.key)) return TIER_TONE;
  return TONES[item.group] ?? "bg-blue-tint text-blue";
}

function formatDay(iso: string, language: string): string {
  try {
    return new Date(iso).toLocaleDateString(language, { month: "short", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

export function AchievementsPage() {
  const { api } = useAuth();
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<GateState>("loading");
  const [items, setItems] = useState<AchievementItem[]>([]);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setState("loading");
    fetchRankConfig(api, ctrl.signal)
      .then(async (c) => {
        if (!c.enabled) return setState("disabled");
        const list = await fetchAchievements(api, ctrl.signal);
        if (ctrl.signal.aborted) return;
        setItems(list);
        setState("ready");
      })
      .catch(() => { if (!ctrl.signal.aborted) setState("error"); });
    return () => ctrl.abort();
  }, [api, attempt]);
  const unlocked = items.filter((i) => i.unlockedAt).length;
  const known = new Set<string>(GROUPS);
  const groups = [...GROUPS, ...new Set(items.map((i) => i.group).filter((g) => !known.has(g)))];
  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={t("web.rank.achievements.title")} back="/rank"
        subtitle={state === "ready" ? <span data-testid="achievements-count" className="tabular-nums">{`${unlocked}/${items.length}`}</span> : undefined} />
      <FeatureGate state={state} disabledText={t("web.rank.disabled")} onRetry={() => setAttempt((n) => n + 1)}>
        <div className="px-gutter pb-8">
          {groups.filter((g) => items.some((i) => i.group === g)).map((group, index) => (
            <SectionGroup key={group} title={t(`web.rank.achievements.groups.${group}`, { defaultValue: group })} bare className={index === 0 ? "-mt-[18px]" : undefined}>
              <ul className="grid grid-cols-3 gap-2">
                {items.filter((i) => i.group === group).map((item) => {
                  const Icon = iconFor(item);
                  const on = !!item.unlockedAt;
                  const condition = achievementCondition(t, item.key);
                  return (
                    <li key={item.key} data-testid="achievement" data-unlocked={String(on)}
                      className="flex min-h-[112px] flex-col items-center rounded-card border-[0.5px] border-hair bg-surface px-1.5 pb-2.5 pt-3 text-center">
                      <span data-testid="achievement-icon" aria-hidden
                        className={cn("flex size-11 items-center justify-center rounded-full", on ? toneFor(item) : "bg-surface-2 text-ink-3")}>
                        <Icon className="size-[22px]" />
                      </span>
                      <b className={cn("mt-2 text-sub font-semibold tracking-[-0.005em]", on ? "text-ink" : "text-ink-2")}>{achievementTitle(t, item.key)}</b>
                      <span className="mt-0.5 text-label leading-[1.35] text-ink-2">
                        {on ? t("web.rank.achievements.unlocked", { date: formatDay(item.unlockedAt!, i18n.language) }) : condition}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </SectionGroup>
          ))}
        </div>
      </FeatureGate>
    </div>
  );
}
