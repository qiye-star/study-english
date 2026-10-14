import { SparklesIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { cn } from "@renderer/lib/utils";
import "./changelog.css";
import "./locales";
import { useChangelogUnread } from "./use-unread";
import { useOneTimeHint } from "./use-one-time-hint";

/** 顶栏右侧 44px 图标链接,外观同练习页的「练习清单」(IconButton 的链接版)。 */
const ICON_LINK = cn(
  "relative inline-flex h-tap w-tap flex-none items-center justify-center rounded-button text-ink transition-colors duration-fast",
  "hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:h-[22px] [&_svg]:w-[22px]",
);

/**
 * 练习页顶栏的「更新日志」入口(扩展点 practiceHeaderActions 的核心贡献,计划 R-2、R-3):星花图标(不用铃铛,以免被当成消息通知);
 * 没有任何已发布条目、或请求失败时整个不显示;有未读时右上角红点 + 慢速扩散的提示环,第一次出现未读时下方弹一条一次性小提示。
 */
export function ChangelogEntry() {
  const { t } = useTranslation();
  const state = useChangelogUnread();
  const hint = useOneTimeHint(state.unread);
  if (state.status === "idle" || state.latestId === null) return null;
  const unread = state.unread;
  return (
    <div className="relative flex-none">
      <Link
        to="/practice/changelog"
        data-testid="changelog-entry"
        aria-label={unread > 0 ? t("web.changelog.entryUnread", { count: unread }) : t("web.changelog.entry")}
        onClick={hint.dismiss}
        className={ICON_LINK}
      >
        {unread > 0 ? <span aria-hidden className="cl-ring" /> : null}
        <SparklesIcon aria-hidden />
        {unread > 0 ? (
          <span
            data-testid="changelog-dot"
            aria-hidden
            className="absolute right-2 top-2 h-[9px] w-[9px] rounded-full bg-red shadow-[0_0_0_2px_rgb(var(--bg))]"
          />
        ) : null}
      </Link>
      {hint.show ? (
        <div role="status" data-testid="changelog-hint" className="cl-hint">
          {t("web.changelog.hint", { count: unread })}
        </div>
      ) : null}
    </div>
  );
}
