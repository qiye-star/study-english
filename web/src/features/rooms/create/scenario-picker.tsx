import { useTranslation } from "react-i18next";
import { cn } from "~/lib/cn";
import type { RoomsConfig } from "../rooms-api";
import { LQ_CHIP, LQ_CHIP_ON } from "~/components/liquid";

/** 场景名按界面语言取中文或英文(情景池由服务端下发,brief 不下发)。 */
export function scenarioTitle(scenarios: RoomsConfig["scenarios"] | undefined, key: string, language: string): string {
  const found = scenarios?.find((s) => s.key === key);
  if (!found) return key;
  return language.startsWith("zh") ? found.titleZh : found.titleEn;
}

/**
 * 场景选择片(视觉稿 V1 `.chips`):横向可换行,34 高、圆角 10、13px;选中浅蓝底蓝字。命中区上下扩到 44。
 * 首个是「自由聊天」(服务端情景池顺序即 spec §3.3 顺序)。单选:点已选中的不取消。
 */
export function ScenarioPicker({ scenarios, value, onChange, label, disabled = false }: {
  scenarios: RoomsConfig["scenarios"]; value: string; onChange(key: string): void; label: string; disabled?: boolean;
}) {
  const { i18n } = useTranslation();
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {scenarios.map((s) => {
        const on = s.key === value;
        return (
          <button key={s.key} type="button" aria-pressed={on} disabled={disabled} data-testid={`room-scenario-${s.key}`}
            onClick={() => { if (!on) onChange(s.key); }}
            className={cn("hit-expand inline-flex h-[34px] items-center rounded-badge px-3 text-sub transition-colors duration-fast",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
              on ? `bg-blue-tint font-semibold text-blue ${LQ_CHIP_ON}` : `bg-surface-2 font-medium text-ink-2 ${LQ_CHIP}`)}>
            {scenarioTitle(scenarios, s.key, i18n.language)}
          </button>
        );
      })}
    </div>
  );
}
