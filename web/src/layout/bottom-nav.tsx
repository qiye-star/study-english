import { MessagesSquareIcon, MicIcon, UserIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { GlassTabBar, tabBarItemClass } from "~/components/glass-tab-bar";

const ITEMS = [
  { to: "/practice", icon: MicIcon, label: "web.nav.practice", testId: "nav-practice" },
  { to: "/chat", icon: MessagesSquareIcon, label: "web.nav.chat", testId: "nav-chat" },
  { to: "/me", icon: UserIcon, label: "web.nav.me", testId: "nav-me" },
] as const;

export function BottomNav() {
  const { t } = useTranslation();
  return (
    <GlassTabBar label={t("web.nav.label")} columns={ITEMS.length}>
      {ITEMS.map(({ to, icon: Icon, label, testId }) => (
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
