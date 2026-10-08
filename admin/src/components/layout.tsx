import type { ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { S } from "../strings";
import { BackIcon, MicIcon, PulseIcon, UsersIcon } from "./icons";

const TABS = [
  { to: "/", label: S.tabs.overview, icon: PulseIcon, match: (p: string) => p === "/" },
  { to: "/users", label: S.tabs.users, icon: UsersIcon, match: (p: string) => p.startsWith("/users") || p.startsWith("/conversations") },
  { to: "/assessments", label: S.tabs.recordings, icon: MicIcon, match: (p: string) => p.startsWith("/assessments") },
];

/** 顶栏高度(不含安全区),供吸顶元素计算 top */
export const TOP_BAR_H = 52;

export function TabBar() {
  const { pathname } = useLocation();
  return (
    <nav aria-label="主导航" className="fixed inset-x-0 bottom-0 z-30 bg-surface/92 shadow-float backdrop-blur-xl" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="mx-auto flex max-w-col">
        {TABS.map(({ to, label, icon: Ico, match }) => {
          const active = match(pathname);
          return (
            <NavLink
              key={to}
              to={to}
              aria-current={active ? "page" : undefined}
              className={`relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-2xs font-medium transition-colors ${
                active ? "text-accent" : "text-muted hover:text-fg-2"
              }`}
            >
              <span
                aria-hidden="true"
                className={`absolute top-0 h-[2px] w-8 rounded-b-full bg-accent transition-[opacity,transform] duration-200 ${active ? "opacity-100 scale-x-100" : "opacity-0 scale-x-50"}`}
              />
              <Ico width={22} height={22} strokeWidth={active ? 2 : 1.75} />
              {label}
            </NavLink>
          );
        })}
      </div>
    </nav>
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

/** 手机宽度铺满;桌面居中成一列。 */
export function AppShell() {
  return (
    <div className="min-h-dvh bg-bg">
      <div
        className="mx-auto min-h-dvh max-w-col bg-bg sm:border-x sm:border-line"
        style={{ paddingBottom: "calc(4.5rem + env(safe-area-inset-bottom))", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}
      >
        <Outlet />
      </div>
      <TabBar />
    </div>
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
