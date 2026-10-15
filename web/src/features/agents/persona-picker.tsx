import "./locales";
import { LQ_CHIP, LQ_CHIP_ON, LQ_NOTE } from "~/components/liquid";
import { AlertTriangleIcon, CheckIcon, PencilIcon, PlusIcon, SparklesIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar } from "~/components/avatar";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { IconButton } from "~/components/icon-button";
import { SegmentedControl } from "~/components/segmented-control";
import { cn } from "~/lib/cn";
import { PersonaEditorSheet } from "./persona-editor-sheet";
import { isBuiltin, type Persona } from "./types";
import { useAgentsConfig, usePersonas } from "./use-agents-data";

export type PickerTab = "all" | "builtin" | "mine";

export interface PersonaPickerProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  selectedId: string | null;
  onSelect?(persona: Persona | null): void;
  /** 显示「不使用角色」(对话、默认角色) */
  allowNone?: boolean;
  /** manage:点我的角色 = 编辑(设置页「我的角色」) */
  mode?: "select" | "manage";
  initialTab?: PickerTab;
}

const focusClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

function Badge({ builtin }: { builtin: boolean }) {
  const { t } = useTranslation();
  return (
    <span className={cn("flex-none rounded-[5px] px-1.5 text-label font-medium", builtin ? "bg-surface-2 text-ink-2" : "bg-blue-tint text-blue", LQ_CHIP, "liquid:h-auto")}>
      {t(builtin ? "web.agents.picker.builtin" : "web.agents.picker.mine")}
    </span>
  );
}

function Check({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={cn("flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full border-[1.5px] liquid:rounded-tile",
      on ? `border-blue bg-blue text-on-blue ${LQ_CHIP_ON}` : "border-hair liquid:border-transparent liquid:bg-wash")}>
      {on && <CheckIcon className="h-3.5 w-3.5" />}
    </span>
  );
}

/** 选择角色(视觉稿 5 屏):全部 / 内置 / 我的,创建入口;编辑器打开时本面板先关闭,不嵌套对话框。 */
export function PersonaPicker({ open, onOpenChange, selectedId, onSelect, allowNone = false, mode = "select", initialTab = "all" }: PersonaPickerProps) {
  const { t } = useTranslation();
  const { config } = useAgentsConfig();
  const { personas, state, reload } = usePersonas(open);
  const [tab, setTab] = useState<PickerTab>(initialTab);
  const [editing, setEditing] = useState<Persona | "new" | null>(null);
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  const all = personas ?? [];
  const mine = all.filter((p) => !isBuiltin(p));
  const list = all.filter((p) => tab === "all" || (tab === "builtin") === isBuiltin(p));
  const max = config?.personasMax ?? 10;
  const full = mine.length >= max;
  const select = mode === "select";

  return (
    <>
      <BottomSheet open={open && !editing} onOpenChange={onOpenChange}>
        <BottomSheetContent data-testid="agent-persona-picker" className="max-h-[85dvh] overflow-y-auto">
          <BottomSheetHeader title={t("web.agents.picker.title")} description={t("web.agents.picker.subtitle")} />
          <SegmentedControl<PickerTab> label={t("web.agents.picker.tabsLabel")} value={tab} onChange={setTab} options={[
            { value: "all", label: t("web.agents.picker.all"), testId: "agent-picker-tab-all" },
            { value: "builtin", label: t("web.agents.picker.builtin"), testId: "agent-picker-tab-builtin" },
            { value: "mine", label: t("web.agents.picker.mine"), testId: "agent-picker-tab-mine" },
          ]} />
          {state === "error" && (
            <p role="alert" className="mt-3 flex items-center gap-2 text-sub text-ink-2">
              {t("web.agents.picker.loadFailed")}
              <button type="button" onClick={reload} className="min-h-tap font-semibold text-blue">{t("web.agents.common.retry")}</button>
            </p>
          )}
          <div role={select ? "radiogroup" : undefined} aria-label={t("web.agents.picker.title")} className="mt-2 divide-y-[0.5px] divide-hair-2">
            {allowNone && select && tab === "all" && (
              <button type="button" role="radio" aria-checked={selectedId === null} data-testid="agent-persona-none" onClick={() => onSelect?.(null)}
                className={cn("flex min-h-row w-full items-center gap-3 py-2 text-left", focusClass)}>
                <span aria-hidden className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-surface-2 text-ink-2">
                  <SparklesIcon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-semibold text-ink">{t("web.agents.picker.none")}</span>
                  <span className="block truncate text-meta text-ink-2">{t("web.agents.picker.noneHint")}</span>
                </span>
                <Check on={selectedId === null} />
              </button>
            )}
            {list.map((p) => {
              const builtin = isBuiltin(p);
              const disabled = p.disabled;
              const editable = !builtin;
              const onRow = select ? () => onSelect?.(p) : editable ? () => setEditing(p) : undefined;
              return (
                <div key={p.id} className="flex items-center gap-1">
                  <button type="button" role={select ? "radio" : undefined} aria-checked={select ? p.id === selectedId : undefined}
                    data-testid={`agent-persona-${p.id}`} disabled={(select && disabled) || !onRow} onClick={onRow}
                    className={cn("flex min-h-row min-w-0 flex-1 items-center gap-3 py-2 text-left disabled:cursor-default", focusClass, select && disabled && "opacity-60")}>
                    <span aria-hidden className="flex-none"><Avatar name={p.name} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-body font-semibold text-ink">
                        <span className="truncate">{p.name}</span>
                        <Badge builtin={builtin} />
                        {disabled && <span className={cn("flex-none rounded-[5px] bg-amber-tint px-1.5 text-label font-medium text-amber", LQ_CHIP, "liquid:h-auto")}>{t("web.agents.chip.disabled")}</span>}
                      </span>
                      <span className="block truncate text-meta text-ink-2">{p.intro}</span>
                    </span>
                    {select && <Check on={p.id === selectedId} />}
                  </button>
                  {editable && (
                    <IconButton data-testid={`agent-persona-edit-${p.id}`} label={t("web.agents.picker.edit", { name: p.name })} className="text-ink-2" onClick={() => setEditing(p)}>
                      <PencilIcon />
                    </IconButton>
                  )}
                </div>
              );
            })}
          </div>
          {tab === "mine" && state === "ready" && mine.length === 0 && <p className="py-3 text-center text-meta text-ink-2">{t("web.agents.picker.empty")}</p>}
          {tab !== "builtin" && (
            <button type="button" data-testid="agent-persona-create" disabled={full} onClick={() => setEditing("new")}
              className={cn("mt-2.5 flex min-h-row w-full items-center gap-2.5 rounded-card border border-dashed border-hair px-3 text-body font-semibold text-blue disabled:opacity-50", focusClass)}>
              <PlusIcon aria-hidden className="h-[18px] w-[18px]" />{t("web.agents.picker.create")}
              {full && <span className="ml-auto text-meta font-normal text-ink-2">{t("web.agents.picker.limit", { max })}</span>}
            </button>
          )}
          <p className={`mt-3.5 flex gap-2 rounded-[10px] bg-amber-tint px-3 py-2 text-meta text-amber ${LQ_NOTE}`}>
            <AlertTriangleIcon aria-hidden className="mt-px h-4 w-4 flex-none" />{t("web.agents.picker.note")}
          </p>
        </BottomSheetContent>
      </BottomSheet>
      <PersonaEditorSheet open={!!editing} persona={editing === "new" ? null : editing}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
        onSaved={(p) => {
          const created = editing === "new";
          setEditing(null);
          reload();
          if (select && created) onSelect?.(p);
        }}
        onDeleted={() => { setEditing(null); reload(); }} />
    </>
  );
}
