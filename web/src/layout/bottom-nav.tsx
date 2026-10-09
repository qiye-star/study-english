import { MessagesSquareIcon, MicIcon, UserIcon, UsersRoundIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { GlassTabBar, tabBarItemClass } from "~/components/glass-tab-bar";
import { useRoomsEnabled } from "~/features/rooms";

const PRACTICE = { to: "/practice", icon: MicIcon, label: "web.nav.practice", testId: "nav-practice" };
const CHAT = { to: "/chat", icon: MessagesSquareIcon, label: "web.nav.chat", testId: "nav-chat" };
const ROOMS = { to: "/rooms", icon: UsersRoundIcon, label: "web.nav.rooms", testId: "nav-rooms" };
const ME = { to: "/me", icon: UserIcon, label: "web.nav.me", testId: "nav-me" };

export function BottomNav() {
  const { t } = useTranslation();
  const items = useRoomsEnabled() ? [PRACTICE, CHAT, ROOMS, ME] : [PRACTICE, CHAT, ME];
  return (
    <GlassTabBar label={t("web.nav.label")} columns={items.length}>
      {items.map(({ to, icon: Icon, label, testId }) => (
        <li key={to}>
          <NavLink to={to} data-testid={testId} className={({ isActive }) => tabBarItemClass(isActive)}>
            <Icon aria-hidden />
            {t(label)}
          </NavLink>
        </li>
      ))}
    </GlassTabBar>
  );
}
