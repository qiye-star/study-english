import { type LucideIcon, MessagesSquareIcon, MicIcon, UserIcon, UsersRoundIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { GlassTabBar, tabBarItemClass } from "~/components/glass-tab-bar";
import { useRoomsEnabled } from "~/features/rooms";

interface Tab {
  to: string;
  icon: LucideIcon;
  label: string;
  testId: string;
  /** 属于这个 tab 的其他页面(背单词从练习页进入,停留其中时仍高亮「练习」) */
  also?: string[];
}

const PRACTICE: Tab = { to: "/practice", icon: MicIcon, label: "web.nav.practice", testId: "nav-practice", also: ["/wordbook"] };
const CHAT: Tab = { to: "/chat", icon: MessagesSquareIcon, label: "web.nav.chat", testId: "nav-chat" };
const ROOMS: Tab = { to: "/rooms", icon: UsersRoundIcon, label: "web.nav.rooms", testId: "nav-rooms" };
const ME: Tab = { to: "/me", icon: UserIcon, label: "web.nav.me", testId: "nav-me" };

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

export function BottomNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const items = useRoomsEnabled() ? [PRACTICE, CHAT, ROOMS, ME] : [PRACTICE, CHAT, ME];
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
