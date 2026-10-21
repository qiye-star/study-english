import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { LQ_PAGE } from "~/components/liquid";
import { SegmentedControl, type SegmentedOption } from "~/components/segmented-control";
import { useRoomsEnabled } from "~/features/rooms";

/**
 * 「对话」分区外壳(计划 L6):AI 对话(`/chat`)与联机(`/rooms`)之间的两段切换。
 * 只有这里同时认识两边;`features/chat` 与 `features/rooms` 互相不引入。路由在 `app.tsx` 里包住,不在这里定义。
 *
 * - 联机关闭、或配置尚未拿到 / 拿取失败:只渲染页面本身(`embedded` 为 undefined),与改动前一致。
 * - 切换用 replace:分区像页签,不进返回栈(R6)。
 */
export type ChatHubSection = "chat" | "rooms" | "rooms-ended";
export interface HubEmbed { title?: string; switcher: ReactNode }

type HubTab = "chat" | "rooms";

export function ChatHubLayout({ section, children }: { section: ChatHubSection; children: (embedded: HubEmbed | undefined) => ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const roomsOn = useRoomsEnabled();
  if (!roomsOn) return <>{children(undefined)}</>;
  const options: SegmentedOption<HubTab>[] = [
    { value: "chat", label: t("web.chatHub.chat"), testId: "hub-tab-chat" },
    { value: "rooms", label: t("web.chatHub.rooms"), testId: "hub-tab-rooms" },
  ];
  const switcher = (
    <div data-testid="chat-hub-switch" className={`px-gutter pb-2 ${LQ_PAGE}`}>
      <SegmentedControl<HubTab>
        label={t("web.chatHub.label")}
        value={section === "chat" ? "chat" : "rooms"}
        onChange={(value) => navigate(value === "chat" ? "/chat" : "/rooms", { replace: true })}
        options={options}
        className="flex w-full"
        optionClassName="flex-1"
      />
    </div>
  );
  // 「已结束的房间」是带返回键的二级页:保留它自己的标题(R7)。
  return <>{children({ title: section === "rooms-ended" ? undefined : t("web.chatHub.title"), switcher })}</>;
}
