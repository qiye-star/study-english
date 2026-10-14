import { useCallback, useEffect, useState, useSyncExternalStore, type ComponentType, type ReactNode, type SVGProps } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { setStepUpHandler } from "../api/client";
import * as session from "../api/session";
import { hasRole, type AdminSession, type Role } from "../api/session";
// strings only (not the feature index): the wordbook page imports this file, so avoid an import cycle
import { S as WORDBOOK_STRINGS } from "../features/wordbook/strings";
import { LinkIcon } from "../features/links/link-icon";
import { S as LINKS_STRINGS } from "../features/links/strings";
import { AgentIcon } from "../features/agents/agent-icon";
import { S as AGENTS_STRINGS } from "../features/agents/strings";
import { CatalogIcon } from "../features/catalog/catalog-icon";
import { S as CATALOG_STRINGS } from "../features/catalog/strings";
import { LibraryIcon } from "../features/library/library-icon";
import { S as LIBRARY_STRINGS } from "../features/library/strings";
import { ChangelogIcon } from "../features/changelog/changelog-icon";
import { S as CHANGELOG_STRINGS } from "../features/changelog/strings";
import { S } from "../strings";
import {
  BackIcon,
  BookIcon,
  ChartIcon,
  ChatsIcon,
  DatabaseIcon,
  DesktopIcon,
  FlagIcon,
  GearIcon,
  KeyIcon,
  ListIcon,
  LogoutIcon,
  MegaphoneIcon,
  MicIcon,
  PulseIcon,
  ScrollIcon,
  ServerIcon,
  ShieldIcon,
  SlidersIcon,
  TextIcon,
  TicketIcon,
  UsersIcon,
} from "./icons";
import { StepUpDialog } from "./step-up-dialog";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

export interface NavItem {
  to: string;
  label: string;
  icon: Icon;
  min: Role;
  /** 只在路径完全相等时高亮(用于 "/"、"/rank" 这类有子路由兄弟的项) */
  end?: boolean;
}

const I = S.shell.items;
const G = S.shell.groups;

/** 侧栏导航(数据驱动,按最低角色过滤;服务端每个端点另有角色校验)。 */
export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: G.overview,
    items: [
      { to: "/", label: I.overview, icon: PulseIcon, min: "viewer", end: true },
      { to: "/system", label: I.system, icon: ServerIcon, min: "viewer" },
    ],
  },
  {
    group: G.content,
    items: [
      { to: "/users", label: I.users, icon: UsersIcon, min: "viewer" },
      { to: "/assessments", label: I.recordings, icon: MicIcon, min: "viewer" },
      { to: "/invites", label: I.invites, icon: TicketIcon, min: "operator" },
      { to: "/wordbook", label: WORDBOOK_STRINGS.title, icon: BookIcon, min: "viewer" },
      { to: "/library", label: LIBRARY_STRINGS.title, icon: LibraryIcon, min: "viewer" },
      { to: "/catalog", label: CATALOG_STRINGS.title, icon: CatalogIcon, min: "viewer" },
    ],
  },
  {
    group: G.rank,
    items: [
      { to: "/rank", label: I.rank, icon: ShieldIcon, min: "viewer", end: true },
      { to: "/rank/rules", label: I.rankRules, icon: SlidersIcon, min: "viewer" },
    ],
  },
  {
    group: G.rooms,
    items: [
      { to: "/rooms", label: I.rooms, icon: ChatsIcon, min: "viewer" },
      { to: "/reports", label: I.reports, icon: FlagIcon, min: "operator" },
    ],
  },
  { group: G.usage, items: [{ to: "/usage", label: I.usage, icon: ChartIcon, min: "viewer" }] },
  {
    group: G.config,
    items: [
      { to: "/settings", label: I.settings, icon: GearIcon, min: "viewer" },
      { to: "/prompts", label: I.prompts, icon: TextIcon, min: "viewer" },
      { to: "/links", label: LINKS_STRINGS.title, icon: LinkIcon, min: "viewer" },
      { to: "/agents", label: AGENTS_STRINGS.title, icon: AgentIcon, min: "viewer" },
      { to: "/announcements", label: I.announcements, icon: MegaphoneIcon, min: "operator" },
      { to: "/changelog", label: CHANGELOG_STRINGS.title, icon: ChangelogIcon, min: "viewer" },
    ],
  },
  {
    group: G.ops,
    items: [
      { to: "/logs", label: I.logs, icon: ListIcon, min: "operator" },
      { to: "/data", label: I.data, icon: DatabaseIcon, min: "superadmin" },
    ],
  },
  {
    group: G.security,
    items: [
      { to: "/audit", label: I.audit, icon: ScrollIcon, min: "viewer" },
      // min viewer: everyone manages their own sessions / TOTP / password there; the accounts table is superadmin-only
      { to: "/security", label: I.security, icon: KeyIcon, min: "viewer" },
    ],
  },
];

/** 当前路径对应的导航项(最长前缀),用于顶栏面包屑 */
export function navItemFor(pathname: string): { group: string; item: NavItem } | null {
  let best: { group: string; item: NavItem } | null = null;
  for (const g of NAV) {
    for (const item of g.items) {
      const hit = item.to === "/" ? pathname === "/" : pathname === item.to || pathname.startsWith(item.to + "/");
      if (hit && (!best || item.to.length > best.item.to.length)) best = { group: g.group, item };
    }
  }
  if (!best && pathname.startsWith("/conversations")) best = { group: G.content, item: NAV[1].items[0] };
  return best;
}

/** 页面内 TopBar 的高度(吸顶偏移) */
export const TOP_BAR_H = 52;

/** 裁定 R-7:只支持 ≥ 1024px 的桌面浏览器。没有 matchMedia(jsdom)时按桌面处理。 */
export const DESKTOP_QUERY = "(min-width: 1024px)";

function desktopNow(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia(DESKTOP_QUERY).matches;
}

function subscribeDesktop(cb: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener?.("change", cb);
  return () => mql.removeEventListener?.("change", cb);
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribeDesktop, desktopNow, () => true);
}

function Sidebar({ current }: { current: AdminSession | null }) {
  return (
    <aside className="flex w-sidebar shrink-0 flex-col overflow-y-auto border-r border-line bg-surface px-2.5 py-3">
      <div className="flex items-center gap-2 px-2 pb-3.5 pt-1.5 text-[15px] font-semibold tracking-tight">
        <span aria-hidden="true" className="grid h-[26px] w-[26px] place-items-center rounded-lg bg-fg text-[12px] font-bold text-bg">
          En
        </span>
        {S.shell.brand}
      </div>
      <nav aria-label={S.shell.nav} className="flex flex-col gap-0.5">
        {NAV.map((g) => {
          const items = g.items.filter((i) => hasRole(current, i.min));
          if (items.length === 0) return null;
          return (
            <div key={g.group} className="flex flex-col gap-0.5">
              <p className="px-2.5 pb-1 pt-3 text-2xs tracking-[0.06em] text-fg-2">{g.group}</p>
              {items.map(({ to, label, icon: Ico, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors ${
                      isActive ? "bg-accent-soft font-semibold text-accent" : "text-fg-2 hover:bg-sunken hover:text-fg"
                    }`
                  }
                >
                  <Ico width={18} height={18} />
                  {label}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function ShellHeader({ current }: { current: AdminSession | null }) {
  const { pathname } = useLocation();
  const crumb = navItemFor(pathname);
  return (
    <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line bg-surface px-5">
      <div className="min-w-0 truncate text-[13px] text-fg-2">
        {crumb ? (
          <>
            {crumb.group} / <b className="text-[15px] font-semibold text-fg">{crumb.item.label}</b>
          </>
        ) : (
          <b className="text-[15px] font-semibold text-fg">{S.shell.brand}</b>
        )}
      </div>
      <div className="flex-1" />
      <span className="rounded-md px-2 py-0.5 text-2xs text-fg-2 ring-1 ring-inset ring-line">{window.location.host}</span>
      {current && (
        <div className="flex items-center gap-2 text-[13px]">
          <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full bg-sunken text-[12px] font-semibold ring-1 ring-inset ring-line">
            {current.username.slice(0, 1).toUpperCase()}
          </span>
          {current.username}
          <span className="badge bg-sunken text-fg-2 ring-1 ring-inset ring-line">{S.shell.roles[current.role]}</span>
        </div>
      )}
      <button type="button" className="btn-quiet btn-sm" onClick={() => void session.logout()}>
        <LogoutIcon width={16} height={16} />
        {S.common.logout}
      </button>
    </header>
  );
}

/** 安全模式红条、维护模式琥珀条 */
function StatusBars({ current }: { current: AdminSession | null }) {
  if (!current) return null;
  return (
    <>
      {current.safeMode && (
        <div role="status" className="shrink-0 border-b border-bad/25 bg-bad-soft px-5 py-2 text-[13px] font-medium text-bad">
          {S.shell.safeMode}
        </div>
      )}
      {current.maintenanceMode !== "off" && (
        <div role="status" className="shrink-0 border-b border-warn/25 bg-warn-soft px-5 py-2 text-[13px] font-medium text-warn">
          {S.shell.maintenance[current.maintenanceMode]}
        </div>
      )}
    </>
  );
}

/** < 1024px:整页提示,不渲染业务页(仍可退出登录)。 */
export function DesktopOnly({ current }: { current: AdminSession | null }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg px-6 text-center">
      <DesktopIcon width={40} height={40} className="text-fg-2" />
      <h1 className="text-lg font-semibold">{S.shell.desktopOnlyTitle}</h1>
      <p className="max-w-[360px] text-sm leading-relaxed text-fg-2">{S.shell.desktopOnlyBody}</p>
      {current && <p className="text-xs text-fg-2">{S.shell.signedInAs(current.username)}</p>}
      {current && (
        <button type="button" className="btn-ghost btn-sm" onClick={() => void session.logout()}>
          {S.common.logout}
        </button>
      )}
    </main>
  );
}

/** v2 外壳:232px 侧栏 + 顶栏 + 状态条 + 可滚动内容区(最大 1200);承载二次验证弹窗。 */
export function AppShell() {
  const current = session.useAdminSession();
  const desktop = useIsDesktop();
  const [pending, setPending] = useState<((ok: boolean) => void) | null>(null);

  useEffect(() => setStepUpHandler(() => new Promise<boolean>((resolve) => setPending(() => resolve))), []);

  const finish = useCallback(
    (ok: boolean) => {
      pending?.(ok);
      setPending(null);
      if (ok) void session.refreshSession();
    },
    [pending],
  );

  if (!desktop) return <DesktopOnly current={current} />;
  return (
    <div className="flex h-dvh bg-bg">
      <Sidebar current={current} />
      <div className="flex min-w-0 flex-1 flex-col">
        <ShellHeader current={current} />
        <StatusBars current={current} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-content">
            <Outlet />
          </div>
        </div>
      </div>
      <StepUpDialog open={pending !== null} totp={!!current?.totpEnabled} onDone={() => finish(true)} onClose={() => finish(false)} />
    </div>
  );
}

/** v2 页面骨架:标题行(可带操作按钮)+ 内容。 */
export function Page({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <main className="space-y-4 px-6 py-5">
      <div className="flex min-h-[36px] items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </main>
  );
}

export function TopBar({
  title,
  subtitle,
  eyebrow,
  back,
  right,
}: {
  title: string;
  subtitle?: string;
  /** 标题上方的小字标签(等宽、大写),用于 ID、计数等 */
  eyebrow?: string;
  back?: string | boolean;
  right?: ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = () => {
    // key === "default" 说明是直接打开的深链,没有可回退的历史
    if (location.key !== "default") navigate(-1);
    else navigate(typeof back === "string" ? back : "/");
  };
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/88 backdrop-blur-xl" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="flex items-center gap-1 pl-1 pr-2" style={{ height: TOP_BAR_H }}>
        {back ? (
          <button type="button" aria-label={S.common.back} className="tap flex items-center justify-center rounded-lg text-fg active:bg-sunken" onClick={goBack}>
            <BackIcon />
          </button>
        ) : (
          <div className="w-3" />
        )}
        <div className="min-w-0 flex-1">
          {eyebrow && <p className="eyebrow truncate font-mono normal-case tracking-normal">{eyebrow}</p>}
          <h1 className="truncate text-md font-semibold leading-tight">{title}</h1>
          {subtitle && <p className="truncate text-xs leading-tight text-muted">{subtitle}</p>}
        </div>
        {right}
      </div>
    </header>
  );
}

export function Screen({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <main className={`px-4 py-4 ${className}`}>{children}</main>;
}

/** 分段控件:等宽选项,选中项为浮起的白色块 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className = "",
  size = "md",
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="tablist" aria-label={label} className={`inline-flex w-full gap-0.5 rounded-lg bg-sunken p-0.5 ${className}`}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={`flex-1 whitespace-nowrap rounded-[8px] px-2 font-medium transition-[background-color,color,box-shadow] ${size === "sm" ? "min-h-[36px] text-xs" : "min-h-[40px] text-sm"} ${
              active ? "bg-surface text-fg shadow-card" : "text-muted hover:text-fg-2"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** 下划线页签:可横向滚动,用于用户详情的内容切换 */
export function UnderlineTabs<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="-mx-4 flex overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={`relative min-h-[44px] shrink-0 whitespace-nowrap px-3 text-base transition-colors first:pl-0 ${active ? "font-semibold text-fg" : "font-medium text-muted hover:text-fg-2"}`}
          >
            {o.label}
            <span aria-hidden="true" className={`absolute inset-x-3 bottom-0 h-[2px] rounded-t-full bg-accent transition-opacity first:inset-x-0 ${active ? "opacity-100" : "opacity-0"}`} />
          </button>
        );
      })}
    </div>
  );
}

/** 筛选胶囊 */
export function Chips<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`min-h-[36px] rounded-full border px-3.5 text-sm font-medium transition-colors ${
              active ? "border-fg bg-fg text-bg" : "border-line bg-surface text-fg-2 hover:border-line-strong"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** 页内区块标题 */
export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-0.5">
      <h2 className="text-sm font-semibold text-fg-2">{children}</h2>
      {aside && <div className="num text-xs text-muted">{aside}</div>}
    </div>
  );
}
