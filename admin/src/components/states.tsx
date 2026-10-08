import type { ReactNode } from "react";
import type { PagedResult } from "../hooks/use-paged";
import { S } from "../strings";
import { AlertIcon, SpinnerIcon } from "./icons";

/** 列表骨架:模拟一行行的头像 + 两行文字 */
export function Skeleton({ rows = 4, variant = "rows" }: { rows?: number; variant?: "rows" | "blocks" }) {
  return (
    <div role="status" aria-label={S.common.loading} className={variant === "rows" ? "panel divide-rows" : "space-y-3"}>
      {Array.from({ length: rows }, (_, i) =>
        variant === "rows" ? (
          <div key={i} className="row">
            <div className="skeleton h-10 w-10 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-3.5 w-[55%]" />
              <div className="skeleton h-3 w-[35%]" />
            </div>
          </div>
        ) : (
          <div key={i} className="skeleton rounded-xl" style={{ height: i === 0 ? 148 : 96 }} />
        ),
      )}
      <span className="sr-only">{S.common.loading}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="panel flex flex-col items-center gap-3 px-6 py-8 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-bad-soft text-bad">
        <AlertIcon width={22} height={22} />
      </div>
      <p className="break-words text-base text-fg">{message}</p>
      {onRetry && (
        <button type="button" className="btn-ghost min-w-[120px]" onClick={onRetry}>
          {S.common.retry}
        </button>
      )}
    </div>
  );
}

/** 空状态:一段静止的"无信号"直线 */
export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center text-muted">
      <svg width="96" height="28" viewBox="0 0 96 28" aria-hidden="true" className="text-line-strong">
        <path d="M2 14h20l4-6 5 12 4-8 3 2h20l4-4 5 8 4-6 3 2h20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="text-sm">{message}</p>
    </div>
  );
}

export function LoadMore({ paged }: { paged: Pick<PagedResult<unknown>, "hasMore" | "loadingMore" | "moreError" | "loadMore"> }) {
  if (!paged.hasMore) return null;
  return (
    <div className="space-y-2">
      {paged.moreError && (
        <p role="alert" className="text-center text-sm text-bad">
          {paged.moreError}
        </p>
      )}
      <button type="button" className="btn-ghost w-full" disabled={paged.loadingMore} onClick={paged.loadMore}>
        {paged.loadingMore ? (
          <>
            <SpinnerIcon width={16} height={16} />
            {S.common.loadingMore}
          </>
        ) : (
          S.common.loadMore
        )}
      </button>
    </div>
  );
}

/** 分页列表的统一外壳:加载 / 错误 / 空 / 列表 + 加载更多。 */
export function PagedList<T>({
  paged,
  empty,
  children,
  className = "panel divide-rows",
  skeletonRows = 5,
}: {
  paged: PagedResult<T>;
  empty: string;
  children: (items: T[]) => ReactNode;
  className?: string;
  skeletonRows?: number;
}) {
  if (paged.loading) return <Skeleton rows={skeletonRows} />;
  if (paged.error) return <ErrorState message={paged.error} onRetry={paged.reload} />;
  if (paged.items.length === 0) return <EmptyState message={empty} />;
  return (
    <>
      <ul className={`fade-in ${className}`}>{children(paged.items)}</ul>
      <div className="mt-3">
        <LoadMore paged={paged} />
      </div>
    </>
  );
}
