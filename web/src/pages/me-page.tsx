import {
  AudioWaveformIcon, BarChart3Icon, BookOpenIcon, CheckIcon, ChevronRightIcon, ClockIcon, FastForwardIcon, FileTextIcon, FlameIcon,
  LanguagesIcon, LogOutIcon, PaletteIcon, SmartphoneIcon, SpellCheckIcon, SunMoonIcon, type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import { Switch } from "@renderer/components/ui/switch";
import { cn } from "@renderer/lib/utils";
import { Avatar } from "~/components/avatar";
import { IconChip } from "~/components/icon-chip";
import { LQ_DANGER_TEXT, LQ_PAGE, LQ_PANEL } from "~/components/liquid";
import { ListRow, SectionGroup } from "~/components/section-group";
import { ScoreDot } from "~/components/score-dot";
import { StatTile } from "~/components/stat-tile";
import { SurfaceCard } from "~/components/surface-card";
import type { Tone } from "~/components/tone";
import { AccountSection, MyInviteSection } from "~/features/account";
import { useGrammarPromptStatus } from "~/features/grammar";
import { getStats, type Stats } from "~/features/progress";
import { RankCard } from "~/features/rank";
import { useRoomsEnabled } from "~/features/rooms";
import { AgentsMeRow } from "~/features/agents";
import { WordbookMeRow } from "~/features/wordbook";
import { translateServerError } from "~/api/error-messages";
import { displayNameOf } from "~/api/types";
import { loadServerAiConfig, type ServerAiConfig } from "~/api/server-config";
import { useAuth } from "~/auth/auth-context";
import { SUPPORTED_LANGUAGES, type UiLanguage } from "~/i18n";
import { PLAYBACK_RATES, formatPlaybackRate, setPlaybackRate, usePlaybackRate, type PlaybackRate } from "~/lib/playback-rate";
import { PageHeader } from "~/layout/page-header";
import { useLiquid } from "~/lib/glass-flag";
import { Slot } from "~/lib/extension-points-react";
import { shouldShowIosInstallHint } from "~/pwa/ios";
import { useGlassTheme } from "~/settings/glass-theme-store";
import { useSettings } from "~/settings/settings-context";
import { COLOR_SCHEMES, type ColorScheme } from "~/settings/color-scheme-pref";

const APPEARANCE_PATH = "/me/appearance";

const oneDecimal = (n: number) => Math.round(n * 10) / 10;

/**
 * 设置行:外观同 ListRow(图标片 / 标题 + 说明 / 当前值 + 箭头),整行覆盖一个透明的原生 <select>,
 * 点哪里都弹出系统选择器(手机上是原生滚轮/列表),行高 ≥ 56。
 */
function SelectRow({ id, testId, icon, tone = "gray", title, hint, display, value, onChange, children }: {
  id: string;
  testId: string;
  icon: LucideIcon;
  tone?: Tone;
  title: ReactNode;
  hint?: ReactNode;
  display: ReactNode;
  value: string;
  onChange(value: string): void;
  children: ReactNode;
}) {
  const hintId = `${id}-hint`;
  return (
    <div className="relative flex min-h-row items-center gap-3 py-2.5 pl-3.5 pr-3 transition-colors duration-fast focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring active:bg-surface-2 liquid:px-4 liquid:active:bg-wash">
      <IconChip tone={tone} icon={icon} />
      <span className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-body font-medium tracking-[-0.005em] text-ink">{title}</label>
        {hint ? <span id={hintId} className="mt-0.5 block text-meta text-ink-2">{hint}</span> : null}
      </span>
      <span aria-hidden className="flex flex-none items-center gap-1 text-body text-ink-2">
        <span className="num">{display}</span>
        <ChevronRightIcon className="h-[18px] w-[18px] text-ink-3" />
      </span>
      <select id={id} data-testid={testId} value={value} aria-describedby={hint ? hintId : undefined}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent text-base opacity-0">
        {children}
      </select>
    </div>
  );
}

/** 开关行:外观同 SelectRow(图标片 / 标题 + 说明),右侧是开关;行高 ≥ 56,开关命中区 44。 */
function SwitchRow({ id, testId, icon, tone = "gray", title, hint, checked, onChange }: {
  id: string; testId: string; icon: LucideIcon; tone?: Tone; title: ReactNode; hint?: ReactNode; checked: boolean; onChange(value: boolean): void;
}) {
  const hintId = `${id}-hint`;
  return (
    <div className="flex min-h-row items-center gap-3 py-2.5 pl-3.5 pr-3 liquid:px-4">
      <IconChip tone={tone} icon={icon} />
      <span className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-body font-medium tracking-[-0.005em] text-ink">{title}</label>
        {hint ? <span id={hintId} className="mt-0.5 block text-meta text-ink-2">{hint}</span> : null}
      </span>
      <Switch id={id} data-testid={testId} checked={checked} onCheckedChange={onChange} aria-describedby={hint ? hintId : undefined}
        className="hit-expand h-[26px] w-11 flex-none data-[state=checked]:bg-blue data-[state=unchecked]:bg-surface-2 data-[state=unchecked]:shadow-hair liquid:data-[state=unchecked]:bg-wash-2" />
    </div>
  );
}

/** 近 7 天的活跃条:20px 方格,已练习为蓝色底色 + 勾,今天加描边。 */
function WeekStrip({ stats }: { stats: Stats }) {
  const { t, i18n } = useTranslation();
  const days = stats.daily.slice(-7);
  const weekday = (date: string) => {
    const d = new Date(`${date}T00:00:00`);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(i18n.language, { weekday: "narrow" });
  };
  return (
    <div className="px-3.5 pb-3 pt-1">
      <ul aria-label={t("web.me.week")} data-testid="me-week" className="flex justify-between">
        {days.map((d) => {
          const today = d.date === stats.today;
          const label = weekday(d.date);
          return (
            <li key={d.date} data-active={d.active ? "true" : "false"} className="w-7 text-center text-label text-ink-2">
              <span aria-hidden className={cn(
                "mx-auto mb-[3px] flex h-5 w-5 items-center justify-center rounded-inline text-blue liquid:rounded-full liquid:text-surface",
                d.active ? "bg-blue-tint liquid:bg-ink/85" : today ? "bg-blue-tint liquid:bg-transparent" : "bg-surface-2 liquid:bg-wash",
                today && "outline outline-[1.5px] -outline-offset-[1.5px] outline-blue",
              )}>
                {d.active ? <CheckIcon className="h-3 w-3" strokeWidth={3} /> : null}
              </span>
              <span aria-hidden>{label}</span>
              <span className="sr-only">
                {t("web.me.weekDay", { day: today ? t("web.me.today") : d.date, state: t(d.active ? "web.me.active" : "web.me.inactive") })}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function MePage() {
  const { t } = useTranslation();
  const { user, api, logout, avatarUrl } = useAuth();
  const { language, setLanguage, roomVoiceAutoText, setRoomVoiceAutoText, colorScheme, setColorScheme } = useSettings();
  const roomsEnabled = useRoomsEnabled();
  const rate = usePlaybackRate();
  const [ai, setAi] = useState<ServerAiConfig | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  const id = useId();
  const liquid = useLiquid();
  const { theme } = useGlassTheme();
  const grammarStatus = useGrammarPromptStatus();

  useEffect(() => {
    let alive = true;
    setAiError(null);
    loadServerAiConfig(api)
      .then((config): void => { if (alive) setAi(config); })
      .catch((err): void => { if (alive) setAiError(translateServerError(tRef.current, err)); });
    return () => { alive = false; };
  }, [api, attempt]);

  // 统计只用于概览(三张统计卡、进度行说明、本周条);失败时安静地不显示,详情在学习进度页
  useEffect(() => {
    const controller = new AbortController();
    getStats(api, 7, controller.signal).then(
      (s) => { if (!controller.signal.aborted && s.days === 7) setStats(s); },
      (): void => undefined,
    );
    return () => controller.abort();
  }, [api]);

  const showInstall = shouldShowIosInstallHint(
    navigator.userAgent,
    (navigator as Navigator & { standalone?: boolean }).standalone,
    window.matchMedia?.("(display-mode: standalone)").matches ?? false,
  );

  const profile = (
    <div className="flex items-center gap-3.5 px-0.5 pb-0.5 pt-1.5">
      {/* Avatar 内部 cn 会让 text-headline(字号)挤掉 text-blue(颜色);这里显式补回两者 */}
      <Avatar name={user ? displayNameOf(user) : ""} size="md" tone="blue" src={avatarUrl} className="text-blue [font-size:22px] liquid:text-ink" />
      <div className="min-w-0 flex-1">
        <p className="text-meta text-ink-2">{t("web.me.username")}</p>
        <p data-testid="me-username" className="mt-0.5 truncate text-headline font-semibold">{user?.name}</p>
      </div>
    </div>
  );

  const statsBlock = (
    <>
    {stats && (
      <div data-testid="me-stats" className="mt-4 grid grid-cols-3 gap-2">
        <StatTile tone="amber" icon={FlameIcon} label={t("web.me.stats.streak")} value={stats.streakDays} unit={t("web.me.stats.days")} />
        <StatTile tone="blue" icon={ClockIcon} label={t("web.me.stats.speaking")}
          value={Math.round(stats.speakingSeconds / 60)} unit={t("web.me.stats.minutes")} />
        <StatTile tone="green" icon={BarChart3Icon} label={t("web.me.stats.avg")}
          value={stats.avgPronunciation === null ? "—" : <span className="inline-flex items-center gap-1.5">{oneDecimal(stats.avgPronunciation)}<ScoreDot score={stats.avgPronunciation} /></span>} />
      </div>
    )}
    </>
  );

  return (
    <div>
      <PageHeader large title={t("web.me.title")} />
      <div className={`px-gutter pb-6 ${LQ_PAGE}`}>
        {liquid ? (
          <SurfaceCard strong data-testid="me-hero" className="mt-2 p-4 [&_[data-testid=me-stats]]:mt-3.5">
            {profile}
            {statsBlock}
          </SurfaceCard>
        ) : (
          <>
            {profile}
            {statsBlock}
          </>
        )}

        <RankCard className="mt-4" />

        <AccountSection />
        <MyInviteSection />

        <SectionGroup title={t("web.me.groups.learning")}>
          <ListRow icon={<IconChip tone="blue" icon={BarChart3Icon} />} title={t("web.me.progress")} to="/progress" testId="me-progress"
            subtitle={stats ? t("web.me.progressSummary", { active: stats.activeDays, messages: stats.userMessages }) : undefined} />
          {stats && stats.daily.length > 0 && <WeekStrip stats={stats} />}
          <ListRow icon={<IconChip tone="teal" icon={BookOpenIcon} />} title={t("web.me.vocabulary")} to="/vocabulary" testId="me-vocabulary" />
          <WordbookMeRow />
          <AgentsMeRow />
          <Slot point="meRows" props={{}} />
        </SectionGroup>

        <SectionGroup title={t("web.me.groups.voice")}>
          <SelectRow id={`${id}-rate`} testId="me-playback-rate" icon={FastForwardIcon} title={t("web.me.playbackRate")}
            hint={t("web.me.playbackRateHint")} display={formatPlaybackRate(rate)} value={String(rate)}
            onChange={(v) => setPlaybackRate(Number(v) as PlaybackRate)}>
            {PLAYBACK_RATES.map((r) => <option key={r} value={String(r)}>{formatPlaybackRate(r)}</option>)}
          </SelectRow>
          {roomsEnabled && (
            <SwitchRow id={`${id}-room-voice-text`} testId="me-room-voice-auto-text" icon={FileTextIcon} tone="blue"
              title={t("web.me.roomVoiceAutoText")} hint={t("web.me.roomVoiceAutoTextHint")}
              checked={roomVoiceAutoText} onChange={setRoomVoiceAutoText} />
          )}
        </SectionGroup>

        <SectionGroup title={t("web.me.groups.general")} bare>
          <div className={`divide-y-[0.5px] divide-hair-2 overflow-hidden rounded-card border-[0.5px] border-hair bg-surface ${LQ_PANEL}`}>
            {liquid ? (
              <ListRow icon={<IconChip tone="gray" icon={PaletteIcon} />} title={t("web.me.appearance")} to={APPEARANCE_PATH} testId="me-appearance"
                value={<span>{t(`web.appearance.preset.${theme.preset}`)}</span>} />
            ) : (
              <SelectRow id={`${id}-color-scheme`} testId="me-color-scheme" icon={SunMoonIcon} title={t("web.me.colorScheme")}
                hint={t("web.me.colorSchemeHint")} display={t(`web.me.colorSchemeOptions.${colorScheme}`)} value={colorScheme}
                onChange={(v) => setColorScheme(v as ColorScheme)}>
                {COLOR_SCHEMES.map((s) => <option key={s} value={s}>{t(`web.me.colorSchemeOptions.${s}`)}</option>)}
              </SelectRow>
            )}
            <SelectRow id={`${id}-language`} testId="me-language" icon={LanguagesIcon} title={t("web.me.language")}
              hint={t("web.me.languageHint")} display={t(`web.languages.${language}`)} value={language}
              onChange={(v) => setLanguage(v as UiLanguage)}>
              {SUPPORTED_LANGUAGES.map((l) => <option key={l} value={l}>{t(`web.languages.${l}`)}</option>)}
            </SelectRow>
            {showInstall && (
              <ListRow icon={<IconChip tone="gray" icon={SmartphoneIcon} />} title={t("web.me.install")} to="/install" />
            )}
          </div>
        </SectionGroup>

        <SectionGroup title={t("web.me.groups.settings")}>
          <ListRow icon={<IconChip tone="gray" icon={SpellCheckIcon} />} title={t("web.me.grammarRule")} to="/me/grammar" testId="me-grammar"
            value={grammarStatus ? t(`web.me.grammarState.${grammarStatus}`) : undefined} />
        </SectionGroup>

        <SectionGroup title={t("web.me.groups.server")}>
          <div data-testid="me-services" className="flex min-h-row items-start gap-3 py-2.5 pl-3.5 pr-3">
            <IconChip tone="gray" icon={AudioWaveformIcon} />
            <div className="min-w-0 flex-1 pt-0.5">
              <h3 className="text-body font-medium tracking-[-0.005em] text-ink">{t("web.me.services")}</h3>
              <div className="mt-0.5 space-y-0.5 text-meta text-ink-2">
                <p>{t("web.me.stt")}</p>
                {ai && <p>{t("web.me.tts", { models: ai.ttsModels.join(", ") || "—" })}</p>}
                {ai?.defaultTts.voice && <p>{t("web.me.ttsDefault", { voice: ai.defaultTts.voice })}</p>}
              </div>
              {aiError && (
                <div data-testid="me-ai-error" role="alert" className="mt-1 flex items-center gap-2 text-sub text-destructive">
                  <span className="flex-1">{aiError}</span>
                  <Button variant="outline" size="sm" className="h-tap" onClick={() => setAttempt((n) => n + 1)}>{t("web.common.retry")}</Button>
                </div>
              )}
            </div>
          </div>
        </SectionGroup>

        <button type="button" data-testid="me-logout" onClick={() => logout(true)}
          className={`mt-[18px] flex h-12 w-full items-center justify-center gap-1.5 rounded-button text-body font-semibold text-red transition-colors duration-fast active:bg-red-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${LQ_DANGER_TEXT} liquid:mx-auto liquid:mt-8 liquid:w-auto liquid:px-6`}>
          <LogOutIcon aria-hidden className="h-5 w-5" />
          {t("web.me.logout")}
        </button>
      </div>
    </div>
  );
}
