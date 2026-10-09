import { LanguagesIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/cn";

/**
 * 输入条最左侧的圆形助手入口(spec §5.2):44px 圆、主色实底 + 白色 language 图标;打开时 blue-tint;
 * 面板关闭或收成一行时有新建议 → 右上角 10px 琥珀未读点。车道 WA,任务 WA2 替换实现,签名不变;
 * data-testid="room-assist-open" 保持不变(房间页与 E2E 测试依赖它)。
 *
 * F5 桩:v1 的 language 图标键(aria-pressed 表示面板已打开)。
 */
export function AssistEntry({ open, disabled, onToggle }: { open: boolean; unread: boolean; disabled: boolean; onToggle(): void }): JSX.Element {
  const { t } = useTranslation();
  return (
    <button type="button" data-testid="room-assist-open" aria-label={t("web.rooms.assist.open")} aria-pressed={open} disabled={disabled}
      onClick={onToggle}
      className={cn("flex size-tap flex-none items-center justify-center rounded-button transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-[21px]",
        open ? "bg-blue-tint text-blue" : "text-ink-2 hover:bg-surface-2")}>
      <LanguagesIcon aria-hidden />
    </button>
  );
}
