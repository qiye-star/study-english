import { ClapperboardIcon, type LucideIcon, MessagesSquareIcon, MicIcon, UserIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { GlassTabBar, tabBarItemClass } from "~/components/glass-tab-bar";
import { useLibraryEnabled } from "~/features/library";

interface Tab {
  to: string;
  icon: LucideIcon;
  label: string;
  testId: string;
  /** 属于这个 tab 的其他页面(背单词从练习页进入,停留其中时仍高亮「练习」) */
  also?: string[];
}

const PRACTICE: Tab = { to: "/practice", icon: MicIcon, label: "web.nav.practice", testId: "nav-practice", also: ["/wordbook"] };
// 「对话」覆盖整个联机子树(计划 L6 R8):联机分区在 /rooms 下,切换条在 pages/chat-hub.tsx
const CHAT: Tab = { to: "/chat", icon: MessagesSquareIcon, label: "web.nav.chat", testId: "nav-chat", also: ["/rooms"] };
// 跟读库(spec E9):独立标签,`/library` 与 `/library/:id` 下保持高亮;关闭时不出现
const LIBRARY: Tab = { to: "/library", icon: ClapperboardIcon, label: "web.nav.library", testId: "nav-library" };
const ME: Tab = { to: "/me", icon: UserIcon, label: "web.nav.me", testId: "nav-me" };

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

export function BottomNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const libraryOn = useLibraryEnabled();
  // 练习 · 对话 · 跟读库 · 我的(跟读库关闭时少一个;最多 4 个。联机在「对话」里的切换条,计划 L6)
  const items = [PRACTICE, CHAT, ...(libraryOn ? [LIBRARY] : []), ME];
  return (
    <GlassTabBar label={t("web.nav.label")} columns={items.length}>
      {items.map(({ to, icon: Icon, label, testId, also = [] }) => {
        const active = [to, ...also].some((base) => under(pathname, base));
        return (
          <li key={to}>
            <Link to={to} data-testid={testId} aria-current={active ? "page" : undefined} className={tabBarItemClass(active)}>
              <Icon aria-hidden />
              {t(label)}
            </Link>
          </li>
        );
      })}
    </GlassTabBar>
  );
}
