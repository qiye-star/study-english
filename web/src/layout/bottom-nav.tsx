import { MessagesSquareIcon, MicIcon, UserIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { cn } from "@renderer/lib/utils";

const ITEMS = [
  { to: "/practice", icon: MicIcon, label: "web.nav.practice", testId: "nav-practice" },
  { to: "/chat", icon: MessagesSquareIcon, label: "web.nav.chat", testId: "nav-chat" },
  { to: "/me", icon: UserIcon, label: "web.nav.me", testId: "nav-me" },
] as const;

export function BottomNav() {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("web.nav.label")} className="border-t bg-background pb-[env(safe-area-inset-bottom)]">
      <ul className="grid grid-cols-3">
        {ITEMS.map(({ to, icon: Icon, label, testId }) => (
          <li key={to}>
            <NavLink
              to={to}
              data-testid={testId}
              className={({ isActive }) =>
                cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs",
                  isActive ? "font-medium text-primary" : "text-muted-foreground",
                )
              }
            >
              <Icon className="h-5 w-5" aria-hidden />
              {t(label)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
