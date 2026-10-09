import { MinusIcon, PlusIcon } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@renderer/components/ui/switch";
import { cn } from "~/lib/cn";
import type { RoomsConfig } from "../rooms-api";
import { fieldInput } from "../ui";
import type { RoomSettingsInput } from "./rooms-v2-api";
import { ScenarioPicker } from "./scenario-picker";

/** 站点上限之外,房间人数上限永远 ≤ 8(spec §3.1)。 */
export const ROOM_MAX_MEMBERS_CAP = 8;
const DEFAULT_LEVELS = ["A1", "A2", "B1", "B2", "C1"];

/** 分组标题(视觉稿 `.lbl`):13px 半粗次要色,右侧可带 500 字重的说明。 */
function Label({ id, children, aside }: { id?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mx-0.5 mb-1.5 mt-3.5 flex items-baseline justify-between gap-3 text-sub font-semibold text-ink-2 first:mt-1">
      <span id={id}>{children}</span>
      {aside != null && <span className="font-medium tabular-nums">{aside}</span>}
    </div>
  );
}

/**
 * 分段控件(视觉稿 `.seg`):surface-2 轨道、圆角 10、内边距 2;每段等宽 32 高(命中 44)、13px 半粗;选中片 surface + 发丝线。
 * 与 components/segmented-control 不同:允许「都不选」(创建时目标水平留给服务端按段位定)。←/→ 切换。
 */
function Segments<T extends string>({ labelledBy, value, options, onChange, disabled, testId }: {
  labelledBy: string; value: T | undefined; options: readonly { value: T; label: string }[]; onChange(v: T): void; disabled?: boolean; testId?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = options.findIndex((o) => o.value === value);
  const pick = (i: number) => {
    const next = options[i];
    refs.current[i]?.focus();
    if (next && next.value !== value) onChange(next.value);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = options.length - 1;
    const to = { ArrowRight: i === last ? 0 : i + 1, ArrowDown: i === last ? 0 : i + 1, ArrowLeft: i === 0 ? last : i - 1, ArrowUp: i === 0 ? last : i - 1, Home: 0, End: last }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    pick(to);
  };
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} data-testid={testId} aria-disabled={disabled || undefined}
      className={cn("flex gap-0.5 rounded-badge bg-seg-track p-0.5", disabled && "opacity-50")}>
      {options.map((o, i) => {
        const on = i === current;
        return (
          <button key={o.value} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={on}
            tabIndex={on || (current < 0 && i === 0) ? 0 : -1} disabled={disabled} onClick={() => pick(i)} onKeyDown={(e) => onKeyDown(e, i)}
            className={cn("hit-expand flex h-8 min-w-0 flex-1 items-center justify-center rounded-lg px-1 text-sub font-semibold transition-colors duration-fast",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "bg-seg-on text-ink shadow-seg" : "text-ink-2")}>
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** 开关行(视觉稿 `.rowi`):≥56 高,标题 15px + 12px 说明,右侧 44×26 开关(命中区扩展)。 */
function SwitchRow({ id, label, hint, checked, disabled, onChange }: {
  id: string; label: string; hint?: string; checked: boolean; disabled?: boolean; onChange(v: boolean): void;
}) {
  return (
    <div className="flex min-h-row items-center gap-3 py-2 pl-3.5 pr-3">
      <label htmlFor={id} className="min-w-0 flex-1">
        <span className="block text-body font-medium text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-meta text-ink-2">{hint}</span>}
      </label>
      <Switch id={id} data-testid={id} checked={checked} disabled={disabled} onCheckedChange={onChange}
        className="hit-expand h-[26px] w-11 flex-none data-[state=checked]:bg-blue data-[state=unchecked]:bg-surface-2 data-[state=unchecked]:shadow-hair" />
    </div>
  );
}

/**
 * 房间的 7 项设置(视觉稿 V1;spec §3.1):房间名、场景、目标水平、加入方式、人数上限、AI 公开回答、允许语音。
 * 创建弹层(mode="create")与房主设置(mode="edit")共用。受控:每次改动 onChange(整份新值)。
 * - 房间名:创建时逐字回传(空名提交时省略);编辑时失焦或回车才回传,且不回传空名(避免每个字都保存一次)。
 * - 人数上限:minMembers..min(8, 站点上限)。
 * - 站点没开语音(config.voiceAvailable === false)时「允许语音消息」整行不渲染。
 */
export function SettingsFields({ value, onChange, config, mode, namePlaceholder, minMembers, disabled = false }: {
  value: RoomSettingsInput; onChange(v: RoomSettingsInput): void; config: RoomsConfig; mode: "create" | "edit"; namePlaceholder: string; minMembers: number;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const nameMax = config.nameMax || 30;
  const levels = config.levels?.length ? config.levels : DEFAULT_LEVELS;
  const max = Math.min(ROOM_MAX_MEMBERS_CAP, config.maxMembers || ROOM_MAX_MEMBERS_CAP);
  const members = value.maxMembers ?? config.defaultMaxMembers ?? 4;
  const set = (patch: RoomSettingsInput) => onChange({ ...value, ...patch });

  const [draft, setDraft] = useState(value.name ?? "");
  useEffect(() => { if (mode === "edit") setDraft(value.name ?? ""); }, [mode, value.name]);
  const commitName = () => {
    const name = draft.trim();
    if (!name) return setDraft(value.name ?? "");
    if (name !== value.name) set({ name });
  };
  const shownName = mode === "create" ? value.name ?? "" : draft;
  const joinMode = value.joinMode ?? "code";

  return (
    <div>
      <Label aside={t("web.rooms.v2.create.nameCount", { count: [...shownName].length, max: nameMax })}>
        <label htmlFor="room-name">{t("web.rooms.v2.create.name")}</label>
      </Label>
      <input id="room-name" data-testid="room-name" value={shownName} maxLength={nameMax} placeholder={namePlaceholder} disabled={disabled}
        autoComplete="off" enterKeyHint="done" className={cn(fieldInput, "w-full")}
        onChange={(e) => (mode === "create" ? set({ name: e.target.value }) : setDraft(e.target.value))}
        onBlur={mode === "edit" ? commitName : undefined}
        onKeyDown={mode === "edit" ? (e) => { if (e.key === "Enter") { e.preventDefault(); commitName(); } } : undefined} />

      <Label aside={t("web.rooms.v2.create.scenarioHint")}>{t("web.rooms.v2.create.scenario")}</Label>
      <ScenarioPicker scenarios={config.scenarios ?? []} value={value.scenario ?? "free"} label={t("web.rooms.v2.create.scenario")}
        disabled={disabled} onChange={(scenario) => set({ scenario })} />

      <Label id="room-level-label" aside={t("web.rooms.v2.create.levelHint")}>{t("web.rooms.v2.create.level")}</Label>
      <Segments labelledBy="room-level-label" testId="room-level" value={value.level} disabled={disabled}
        options={levels.map((l) => ({ value: l, label: l }))} onChange={(level) => set({ level })} />

      <Label id="room-join-mode-label">{t("web.rooms.v2.create.joinMode")}</Label>
      <Segments labelledBy="room-join-mode-label" testId="room-join-mode" value={joinMode} disabled={disabled}
        options={[{ value: "code", label: t("web.rooms.v2.create.joinCode") }, { value: "approval", label: t("web.rooms.v2.create.joinApproval") }] as const}
        onChange={(v) => set({ joinMode: v })} />
      <p className="mx-0.5 mt-1.5 text-meta leading-[1.45] text-ink-2">
        {t(joinMode === "approval" ? "web.rooms.v2.create.joinApprovalHint" : "web.rooms.v2.create.joinCodeHint")}
      </p>

      <div className="mt-3 divide-y-[0.5px] divide-hair-2 overflow-hidden rounded-card bg-surface shadow-hair">
        <div className="flex min-h-row items-center gap-3 py-1.5 pl-3.5 pr-1.5">
          <span id="room-max-members-label" className="min-w-0 flex-1 text-body font-medium text-ink">{t("web.rooms.v2.create.maxMembers")}</span>
          <div role="group" aria-labelledby="room-max-members-label" className="flex flex-none items-center">
            <StepButton testId="room-max-members-dec" label={t("web.rooms.v2.create.fewer")} disabled={disabled || members <= minMembers}
              onClick={() => set({ maxMembers: Math.max(minMembers, members - 1) })}><MinusIcon /></StepButton>
            <b data-testid="room-max-members" aria-live="polite" className="w-[34px] text-center text-title font-semibold tabular-nums text-ink">{members}</b>
            <StepButton testId="room-max-members-inc" label={t("web.rooms.v2.create.more")} disabled={disabled || members >= max}
              onClick={() => set({ maxMembers: Math.min(max, members + 1) })}><PlusIcon /></StepButton>
          </div>
        </div>
        <SwitchRow id="room-ai-public" label={t("web.rooms.v2.create.aiPublic")} hint={t("web.rooms.v2.create.aiPublicHint")}
          checked={value.aiPublic ?? true} disabled={disabled} onChange={(aiPublic) => set({ aiPublic })} />
        {config.voiceAvailable !== false && (
          <SwitchRow id="room-allow-voice" label={t("web.rooms.v2.create.allowVoice")} hint={t("web.rooms.v2.create.allowVoiceHint")}
            checked={value.allowVoice ?? true} disabled={disabled} onChange={(allowVoice) => set({ allowVoice })} />
        )}
      </div>
    </div>
  );
}

/** 步进按钮:视觉 36×36 圆角 10 的 surface-2 方块,命中区 44×44。 */
function StepButton({ testId, label, disabled, onClick, children }: { testId: string; label: string; disabled: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button type="button" data-testid={testId} aria-label={label} disabled={disabled} onClick={onClick}
      className="group inline-flex size-tap items-center justify-center rounded-button focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">
      <span aria-hidden className="inline-flex size-9 items-center justify-center rounded-badge bg-surface-2 text-ink transition-colors duration-fast group-active:bg-hair-2 [&_svg]:size-[18px]">
        {children}
      </span>
    </button>
  );
}
