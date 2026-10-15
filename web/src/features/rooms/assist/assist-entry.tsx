import { LanguagesIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/cn";
import { LQ_CHIP_ON } from "~/components/liquid";

/**
 * 输入条最左侧的圆形助手入口(spec §5.2,视觉稿 .aibtn):44px 圆、主色实底 + on-blue 的 language 图标(与「助手润色」标同一图形);
 * 打开时 blue-tint 底 + 蓝色图标。面板关闭或收成一行时有新建议 → 右上角 10px 琥珀未读点(2px 底色描边,深色下跟随底色)。
 * data-testid="room-assist-open" 保持不变(房间页与 E2E 测试依赖它)。
 */
export function AssistEntry({ open, unread, disabled, onToggle }: { open: boolean; unread: boolean; disabled: boolean; onToggle(): void }): JSX.Element {
  const { t } = useTranslation();
  return (
    <button type="button" data-testid="room-assist-open" aria-label={unread ? t("web.rooms.dock.entryUnread") : t("web.rooms.dock.entry")}
      aria-pressed={open} disabled={disabled} onClick={onToggle}
      className={cn("relative flex size-tap flex-none items-center justify-center rounded-full transition-colors duration-fast",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-[22px]",
        open ? `bg-blue-tint text-blue ${LQ_CHIP_ON}` : "bg-blue text-on-blue shadow-[0_4px_10px_-4px_rgb(var(--blue)/0.55)] active:bg-blue/90")}>
      <LanguagesIcon aria-hidden />
      {unread && (
        <span data-testid="assist-unread" aria-hidden
          className="absolute right-0.5 top-0.5 size-2.5 rounded-full bg-[#E08A1E] shadow-[0_0_0_2px_rgb(var(--background))] dark:bg-amber" />
      )}
    </button>
  );
}
