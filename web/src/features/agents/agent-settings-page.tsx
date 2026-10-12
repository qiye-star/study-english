import "./locales";
import {
  BookOpenIcon, BookmarkIcon, BrainIcon, CalendarClockIcon, EyeIcon, FlameIcon, GraduationCapIcon, LanguagesIcon, UsersIcon, UserRoundIcon, type LucideIcon,
} from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Switch } from "@renderer/components/ui/switch";
import { useAuth } from "~/auth/auth-context";
import { FeatureGate, type GateState } from "~/components/feature-gate";
import { IconChip } from "~/components/icon-chip";
import { SegmentedControl } from "~/components/segmented-control";
import { ListRow, SectionGroup } from "~/components/section-group";
import type { Tone } from "~/components/tone";
import { PageHeader } from "~/layout/page-header";
import { cn } from "~/lib/cn";
import { agentsApi } from "./agents-api";
import { PersonaPicker } from "./persona-picker";
import { TOOL_FIELD, TOOL_KEYS, TUTOR_KINDS, ZH_NOTE_MODES, type AgentSettings, type AgentSettingsPatch, type ToolKey, type TutorKind, type ZhNoteMode } from "./types";
import { useAgentSettings, useAgentsConfig, usePersonas } from "./use-agents-data";

const TOOL_ICON: Record<ToolKey, [LucideIcon, Tone]> = {
  lookup: [BookOpenIcon, "teal"], learned_words: [BookmarkIcon, "amber"], weak_words: [FlameIcon, "amber"], due_words: [CalendarClockIcon, "amber"], memory: [BrainIcon, "amber"],
};
const TUTOR_LENGTHS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const applyPatch = (s: AgentSettings, p: AgentSettingsPatch): AgentSettings =>
  ({ ...s, ...p, tools: { ...s.tools, ...p.tools }, tutor: { ...s.tutor, ...p.tutor } });
/** 把补丁里出现的每个键恢复成 base 里的值(逐键回滚)。 */
function undoPatch(base: AgentSettings, p: AgentSettingsPatch): AgentSettingsPatch {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(p) as Array<keyof AgentSettingsPatch>) {
    if (key === "tools") out.tools = Object.fromEntries(Object.keys(p.tools ?? {}).map((k) => [k, base.tools[k as keyof AgentSettings["tools"]]]));
    else if (key === "tutor") out.tutor = Object.fromEntries(Object.keys(p.tutor ?? {}).map((k) => [k, base.tutor[k as keyof AgentSettings["tutor"]]]));
    else out[key] = base[key];
  }
  return out as AgentSettingsPatch;
}

function SwitchRow({ id, testId, icon, tone, title, hint, checked, onChange }: {
  id: string; testId: string; icon: LucideIcon; tone: Tone; title: ReactNode; hint?: ReactNode; checked: boolean; onChange(value: boolean): void;
}) {
  return (
    <div className="flex min-h-row items-center gap-3 py-2.5 pl-3.5 pr-3">
      <IconChip tone={tone} icon={icon} />
      <span className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-body font-medium tracking-[-0.005em] text-ink">{title}</label>
        {hint ? <span id={`${id}-hint`} className="mt-0.5 block text-meta text-ink-2">{hint}</span> : null}
      </span>
      <Switch id={id} data-testid={testId} checked={checked} onCheckedChange={onChange} aria-describedby={hint ? `${id}-hint` : undefined}
        className="hit-expand h-[26px] w-11 flex-none data-[state=checked]:bg-blue data-[state=unchecked]:bg-surface-2 data-[state=unchecked]:shadow-hair" />
    </div>
  );
}

/** 智能体设置(spec §4.3、D2):全局工具开关(默认全开)、记忆、联机共享、显示过程、默认角色、带我学默认值;记忆页由 A2 提供。 */
export function AgentSettingsPage() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const id = useId();
  const { config, state: configState, retry: retryConfig } = useAgentsConfig();
  const enabled = !!config?.enabled;
  const { settings, state: settingsState, setSettings, retry: retrySettings } = useAgentSettings(enabled);
  const { personas } = usePersonas(enabled);
  const [picker, setPicker] = useState<"default" | "manage" | null>(null);

  const gate: GateState = configState === "loading" ? "loading" : configState === "error" ? "error" : !enabled ? "disabled"
    : settings ? "ready" : settingsState === "error" ? "error" : "loading";

  /**
   * 乐观更新:先显示新值。保存串行化(一个接一个 PATCH):失败时只退回这次改的键(不动之后的改动),
   * 响应只在最后一个保存返回时才覆盖本地(更早的响应不能盖掉之后的乐观值)。
   */
  const live = useRef<AgentSettings | null>(null);
  live.current = settings;
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const inflight = useRef(0);
  const save = (patch: AgentSettingsPatch) => {
    const base = live.current;
    if (!base) return;
    const undo = undoPatch(base, patch);
    live.current = applyPatch(base, patch);
    setSettings(live.current);
    inflight.current += 1;
    chain.current = chain.current.then(() => agentsApi.patchSettings(api, patch)).then(
      (server) => {
        inflight.current -= 1;
        if (inflight.current === 0) { live.current = server; setSettings(server); }
      },
      () => {
        inflight.current -= 1;
        if (live.current) { live.current = applyPatch(live.current, undo); setSettings(live.current); }
        toast.error(t("web.agents.settings.saveFailed"));
      },
    );
  };
  const defaultName = personas?.find((p) => p.id === settings?.defaultPersonaId)?.name;

  return (
    <div>
      <PageHeader title={t("web.agents.settings.title")} back="/me" />
      <div className="px-gutter pb-6">
        <FeatureGate state={gate} disabledText={t("web.agents.settings.disabled")} onRetry={() => { retryConfig(); retrySettings(); }}>
          {settings && config && (
            <>
              <SectionGroup title={t("web.agents.settings.groups.personas")}>
                <ListRow icon={<IconChip tone="gray" icon={UserRoundIcon} />} title={t("web.agents.settings.defaultPersona")}
                  value={<span data-testid="agent-setting-default-persona">{defaultName ?? t("web.agents.settings.defaultNone")}</span>}
                  onClick={() => setPicker("default")} />
                <ListRow icon={<IconChip tone="gray" icon={UserRoundIcon} />} title={t("web.agents.settings.myPersonas")}
                  subtitle={t("web.agents.settings.myPersonasHint")} onClick={() => setPicker("manage")} testId="agent-setting-my-personas" />
              </SectionGroup>

              <SectionGroup title={t("web.agents.settings.groups.tools")}>
                {TOOL_KEYS.map((key) => {
                  const field = TOOL_FIELD[key];
                  const [icon, tone] = TOOL_ICON[key];
                  return (
                    <SwitchRow key={key} id={`${id}-tool-${key}`} testId={`agent-setting-tool-${key}`} icon={icon} tone={tone}
                      title={t(`web.agents.tools.${key}`)} hint={t(`web.agents.toolHints.${key}`)} checked={settings.tools[field]}
                      onChange={(on) => save({ tools: { [field]: on } })} />
                  );
                })}
              </SectionGroup>
              <p className="mx-0.5 mt-1.5 text-meta text-ink-2">{t("web.agents.settings.toolsHint")}</p>

              {config.memoryEnabled && (
                <SectionGroup title={t("web.agents.settings.groups.memory")}>
                  <SwitchRow id={`${id}-memory`} testId="agent-setting-memory" icon={BrainIcon} tone="amber" title={t("web.agents.settings.memoryEnabled")}
                    hint={t("web.agents.settings.memoryEnabledHint")} checked={settings.memoryEnabled}
                    onChange={(memoryEnabled) => save({ memoryEnabled })} />
                  <ListRow icon={<IconChip tone="gray" icon={BrainIcon} />} title={t("web.agents.settings.memoryManage")} to="/me/agents/memory" testId="agent-setting-memory-manage" />
                </SectionGroup>
              )}

              {config.roomsEnabled && (
                <SectionGroup title={t("web.agents.settings.groups.rooms")}>
                  <SwitchRow id={`${id}-share`} testId="agent-setting-share-in-rooms" icon={UsersIcon} tone="amber" title={t("web.agents.settings.shareInRooms")}
                    checked={settings.shareInRooms} onChange={(shareInRooms) => save({ shareInRooms })} />
                  <p className="mx-3.5 mb-3 rounded-[10px] bg-amber-tint px-3 py-2 text-meta text-amber">{t("web.agents.settings.shareWarning")}</p>
                </SectionGroup>
              )}

              <SectionGroup title={t("web.agents.settings.groups.display")}>
                <SwitchRow id={`${id}-process`} testId="agent-setting-show-process" icon={EyeIcon} tone="gray" title={t("web.agents.settings.showProcess")}
                  hint={t("web.agents.settings.showProcessHint")} checked={settings.showProcess}
                  onChange={(showProcess) => save({ showProcess })} />
              </SectionGroup>

              <SectionGroup title={t("web.agents.settings.groups.language")}>
                <div className="px-3.5 py-2.5">
                  <div className="flex min-h-row flex-wrap items-center gap-x-3 gap-y-2">
                    <IconChip tone="gray" icon={LanguagesIcon} />
                    <span className="min-w-0 flex-1 text-body font-medium tracking-[-0.005em] text-ink">{t("web.agents.settings.zhNote")}</span>
                    <SegmentedControl<ZhNoteMode> label={t("web.agents.settings.zhNote")} value={settings.zhNote ?? "auto"}
                      onChange={(zhNote) => save({ zhNote })}
                      options={ZH_NOTE_MODES.map((mode) => ({ value: mode, label: t(`web.agents.settings.zhNoteModes.${mode}`), testId: `agent-setting-zh-note-${mode}` }))} />
                  </div>
                  <p className="mt-1.5 text-meta text-ink-2">{t("web.agents.settings.zhNoteHint")}</p>
                </div>
              </SectionGroup>

              {config.tutorEnabled && (
                <SectionGroup title={t("web.agents.settings.groups.tutor")}>
                  <label className="flex min-h-row items-center gap-3 py-2.5 pl-3.5 pr-3">
                    <IconChip tone="blue" icon={GraduationCapIcon} />
                    <span className="min-w-0 flex-1 text-body font-medium text-ink">{t("web.agents.settings.tutorLength")}</span>
                    <select data-testid="agent-setting-tutor-length" value={String(settings.tutor.length)}
                      className="min-h-tap rounded-[10px] bg-surface-2 px-2 text-base text-ink"
                      onChange={(e) => {
                        const length = Number(e.target.value);
                        save({ tutor: { length } });
                      }}>
                      {TUTOR_LENGTHS.map((n) => <option key={n} value={String(n)}>{t("web.agents.settings.tutorLengthValue", { count: n })}</option>)}
                    </select>
                  </label>
                  <div className="px-3.5 pb-3 pt-1">
                    <p className="mb-2 text-meta text-ink-2">{t("web.agents.settings.tutorMix")}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {TUTOR_KINDS.map((kind: TutorKind) => {
                        const on = settings.tutor.mix.includes(kind);
                        const last = on && settings.tutor.mix.length === 1;
                        return (
                          <button key={kind} type="button" aria-pressed={on} disabled={last} data-testid={`agent-setting-kind-${kind}`}
                            className={cn("hit-expand h-8 rounded-full px-3 text-sub transition-colors duration-fast disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              on ? "bg-blue-tint font-semibold text-blue" : "bg-surface-2 text-ink-2")}
                            onClick={() => {
                              const mix = on ? settings.tutor.mix.filter((k) => k !== kind) : TUTOR_KINDS.filter((k) => k === kind || settings.tutor.mix.includes(k));
                              save({ tutor: { mix } });
                            }}>
                            {t(`web.agents.settings.kinds.${kind}`)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </SectionGroup>
              )}
            </>
          )}
        </FeatureGate>
      </div>
      {settings && (
        <PersonaPicker open={picker !== null} onOpenChange={(o) => { if (!o) setPicker(null); }}
          mode={picker === "manage" ? "manage" : "select"} initialTab={picker === "manage" ? "mine" : "all"} allowNone
          selectedId={settings.defaultPersonaId}
          onSelect={(p) => {
            setPicker(null);
            const defaultPersonaId = p?.id ?? null;
            save({ defaultPersonaId });
          }} />
      )}
    </div>
  );
}
