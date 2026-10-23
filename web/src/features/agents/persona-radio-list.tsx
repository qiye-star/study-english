import "./locales";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Avatar } from "~/components/avatar";
import { cn } from "~/lib/cn";
import type { Persona } from "./types";
import { useAgentsConfig, usePersonas } from "./use-agents-data";

export interface PersonaRadioListProps {
  /** 当前角色 id(null = 不使用角色:没有任何一行被选中) */
  selectedId: string | null;
  /** 带学进行中等:整组禁用 */
  disabled?: boolean;
  onSelect(persona: Persona): void;
  /** 末行「更多角色 / 管理…」;不传则不显示(调用方用它打开 PersonaPicker) */
  onMore?(): void;
  /** 节标题(随列表一起渲染,这样智能体关闭时整节不出现) */
  heading?: string;
  /** 列表之后的内容(同样在智能体关闭时一起消失) */
  footer?: ReactNode;
}

const focusClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/**
 * 设置面板里的角色单选列表(chat home FR5,懒加载块):内置 + 自建角色,行 testid 与选择器相同(`agent-persona-<id>`)。
 * 只做「选」;不使用角色、新建 / 编辑自建角色都在 PersonaPicker 里(经 onMore 打开)。
 */
export function PersonaRadioList({ selectedId, disabled = false, onSelect, onMore, heading, footer }: PersonaRadioListProps) {
  const { t } = useTranslation();
  const { config } = useAgentsConfig();
  const enabled = !!config?.enabled;
  const { personas, state, reload } = usePersonas(enabled);
  const list = personas ?? [];
  const tabStopId = list.some((q) => q.id === selectedId) ? selectedId : list[0]?.id;
  const arrowKeys = (event: KeyboardEvent<HTMLElement>) => {
    const keys: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    const step = keys[event.key];
    if (!step) return;
    const radios = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'));
    const index = radios.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const target = radios[(index + step + radios.length) % radios.length];
    target.focus();
    target.click();
  };
  if (!enabled) return null; // 智能体关闭(或还没取到 config):整节不渲染,同 ChatPersonaControl
  return (
    <div data-testid="agent-persona-radio-list">
      {heading && <h3 className="pb-1 text-meta font-medium text-ink-2">{heading}</h3>}
      {state === "error" && (
        <p role="alert" className="flex items-center gap-2 py-1 text-sub text-ink-2">
          {t("web.agents.radio.loadFailed")}
          <button type="button" onClick={reload} className="min-h-tap font-semibold text-blue">{t("web.agents.common.retry")}</button>
        </p>
      )}
      <div role="radiogroup" aria-label={t("web.agents.radio.label")} aria-disabled={disabled || undefined} onKeyDown={arrowKeys}
        className="divide-y-[0.5px] divide-hair-2">
        {list.map((p) => {
          const checked = p.id === selectedId;
          return (
            <button key={p.id} type="button" role="radio" aria-checked={checked} data-testid={`agent-persona-${p.id}`}
              // roving tabindex:选中项(没有选中时第一项)可 Tab 进入,其余用方向键
              tabIndex={p.id === tabStopId ? 0 : -1}
              disabled={disabled || p.disabled} onClick={() => !checked && onSelect(p)}
              className={cn("flex min-h-row w-full items-center gap-3 py-2 text-left disabled:opacity-60", focusClass)}>
              <span aria-hidden className="flex-none"><Avatar name={p.name} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-semibold text-ink">{p.name}</span>
                <span className="block truncate text-meta text-ink-2">{p.intro}</span>
              </span>
              <span aria-hidden className={cn("flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full border-[1.5px] liquid:rounded-tile",
                checked ? "border-blue bg-blue text-on-blue" : "border-hair liquid:border-transparent liquid:bg-wash")}>
                {checked && <CheckIcon className="h-3.5 w-3.5" />}
              </span>
            </button>
          );
        })}
      </div>
      {onMore && (
        <button type="button" data-testid="agent-persona-more" disabled={disabled} onClick={onMore}
          className={cn("flex min-h-row w-full items-center gap-2 border-t-[0.5px] border-hair-2 py-2 text-left text-body font-medium text-blue disabled:opacity-50", focusClass)}>
          <span className="min-w-0 flex-1">{t("web.agents.radio.more")}</span>
          <ChevronRightIcon aria-hidden className="h-[18px] w-[18px] flex-none text-ink-3" />
        </button>
      )}
      {footer}
    </div>
  );
}
