import type { ComponentType, ReactNode, SVGProps } from "react";
import { cn } from "@renderer/lib/utils";
import { LQ_PANEL } from "./liquid";

/**
 * 空状态(设计稿 .empty):E1 面板、64px 井里 40px ink-3 描边图标、15/600 标题、13 次要说明、一个次要胶囊按钮。
 * 只在液态分支里使用(经典页面保持原来的写法)。
 */
export function EmptyState({ icon: Icon, title, body, action, testId, className }: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <div data-testid={testId} className={cn("flex flex-col items-center px-4 py-7 text-center", LQ_PANEL, className)}>
      <span aria-hidden className="well mb-3 flex size-16 items-center justify-center rounded-full text-ink-3">
        <Icon className="size-10" strokeWidth={1.6} />
      </span>
      <p className="text-body font-semibold text-ink">{title}</p>
      {body ? <p className="mt-1 max-w-[28ch] text-sub text-ink-2">{body}</p> : null}
      {action ? <div className="mt-3.5">{action}</div> : null}
    </div>
  );
}
