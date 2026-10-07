import { ChevronRightIcon } from "lucide-react";
import { useId, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@renderer/lib/utils";

/**
 * 分组:13px 次要色标题(前距 22px)+ 圆角 14 的列表容器,行间 0.5px 分隔线。
 * action 放在标题右侧,通常是 <Link className="tap-link text-sub font-medium text-blue">全部 24 ›</Link>。
 * bare 时不画列表容器(组内放卡片等)。
 *   <SectionGroup title="学习"><ListRow … /><ListRow … /></SectionGroup>
 */
export function SectionGroup({
  title,
  action,
  bare = false,
  className,
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  bare?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section role="group" aria-labelledby={id} className={className}>
      <div className="mx-0.5 mb-2 mt-section flex min-h-[18px] items-center justify-between text-sub font-semibold tracking-[0.01em] text-ink-2">
        <h2 id={id}>{title}</h2>
        {action}
      </div>
      {bare ? (
        children
      ) : (
        <div className="divide-y-[0.5px] divide-hair-2 overflow-hidden rounded-card border-[0.5px] border-hair bg-surface">{children}</div>
      )}
    </section>
  );
}

/** 传 to 或 onClick 之一;同时传时 to 优先。 */
interface RowTarget {
  to?: string;
  onClick?: () => void;
}

/**
 * 列表行:最小高 56px;icon(通常 IconChip)/ 标题 15px + 副标题 12px / 右侧值 + 箭头。
 * 传 to 渲染为路由链接,传 onClick 渲染为按钮,都不传则为静态行。trailing 替换右侧值区(如 Switch、ToneBadge)。
 * chevron 默认在可交互行上显示。
 *   <ListRow icon={<IconChip tone="blue" icon={BarChartIcon} />} title="学习进度" subtitle="近 7 天" to="/progress" testId="me-progress" />
 */
export function ListRow({
  icon,
  title,
  subtitle,
  value,
  trailing,
  chevron,
  testId,
  className,
  ...target
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  testId?: string;
  className?: string;
} & RowTarget) {
  const interactive = Boolean(target.to || target.onClick);
  const showChevron = chevron ?? interactive;
  const classes = cn(
    "flex min-h-row w-full items-center gap-3 py-2.5 pl-3.5 pr-3 text-left",
    interactive && "transition-colors duration-fast active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
    className,
  );
  const body = (
    <>
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium tracking-[-0.005em] text-ink">{title}</span>
        {subtitle ? <span className="mt-0.5 block text-meta text-ink-2">{subtitle}</span> : null}
      </span>
      {trailing ?? (value !== undefined || showChevron ? (
        <span className="flex flex-none items-center gap-1 text-body text-ink-2">
          {value}
          {showChevron ? <ChevronRightIcon aria-hidden className="h-[18px] w-[18px] text-ink-3" /> : null}
        </span>
      ) : null)}
      {trailing && showChevron ? <ChevronRightIcon aria-hidden className="h-[18px] w-[18px] flex-none text-ink-3" /> : null}
    </>
  );
  if (target.to) {
    return (
      <Link to={target.to} data-testid={testId} className={classes}>
        {body}
      </Link>
    );
  }
  if (target.onClick) {
    return (
      <button type="button" onClick={target.onClick} data-testid={testId} className={classes}>
        {body}
      </button>
    );
  }
  return (
    <div data-testid={testId} className={classes}>
      {body}
    </div>
  );
}
