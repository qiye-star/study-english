import { useState } from "react";
import { getOverview } from "../api/endpoints";
import { ActivityChart } from "../components/activity-chart";
import { Screen, TopBar } from "../components/layout";
import { ErrorState, Skeleton } from "../components/states";
import { useAsync } from "../hooks/use-async";
import { formatBytes, formatCompact } from "../lib/format";
import { S } from "../strings";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface px-3.5 py-3">
      <p className="eyebrow">{label}</p>
      <p className="num mt-1 text-xl font-semibold leading-none" title={value.toLocaleString("zh-CN")}>
        {formatCompact(value)}
      </p>
    </div>
  );
}

export function OverviewPage() {
  const [days, setDays] = useState(30);
  const { data, loading, error, reload } = useAsync(() => getOverview(days), [days]);

  return (
    <>
      <TopBar title={S.overview.title} subtitle={S.appName} />
      <Screen className="space-y-4">
        {error && !data ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data ? (
          <Skeleton rows={3} variant="blocks" />
        ) : (
          <>
            <section className="panel fade-in" aria-label={S.overview.title}>
              {/* 1px 的分割线靠 gap + 背景色实现,格子等高等宽 */}
              <div className="grid grid-cols-3 gap-px bg-line">
                <Stat label={S.overview.users} value={data.totals.users} />
                <Stat label={S.overview.conversations} value={data.totals.conversations} />
                <Stat label={S.overview.assessments} value={data.totals.assessments} />
                <Stat label={S.overview.messages} value={data.totals.messages} />
                <Stat label={S.overview.vocabulary} value={data.totals.vocabulary} />
                <Stat label={S.overview.practiceItems} value={data.totals.practice_items} />
              </div>
              <div className="flex items-center justify-between border-t border-line px-4 py-3">
                <span className="text-sm text-fg-2">{S.overview.recordings}</span>
                <span className="num text-base font-semibold">{formatBytes(data.totals.recording_bytes)}</span>
              </div>
            </section>
            <div className={`fade-in ${loading ? "opacity-60 transition-opacity" : "transition-opacity"}`}>
              {error && (
                <p role="alert" className="mb-2 text-center text-sm text-bad">
                  {error}
                </p>
              )}
              <ActivityChart daily={data.daily} days={days} onDaysChange={setDays} />
            </div>
          </>
        )}
      </Screen>
    </>
  );
}
