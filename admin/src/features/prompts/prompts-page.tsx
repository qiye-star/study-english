import { Link } from "react-router-dom";
import { Page } from "../../components/layout";
import { ErrorState, Skeleton } from "../../components/states";
import { useAsync } from "../../hooks/use-async";
import { formatDateTime } from "../../lib/format";
import { listPrompts, type PromptSummary } from "./api";
import { S } from "./strings";

function PromptCard({ item }: { item: PromptSummary }) {
  return (
    <Link to={`/prompts/${encodeURIComponent(item.key)}`} className="panel block px-4 py-4 transition-colors hover:bg-sunken">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">{item.label}</h2>
          <p className="mt-0.5 font-mono text-xs text-fg-2">{item.key}</p>
        </div>
        <span className="badge bg-sunken text-fg-2">{S.kind[item.kind]}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        {item.publishedVersion !== null ? (
          <span className="badge bg-good-soft text-good">{S.published(item.publishedVersion)}</span>
        ) : (
          <span className="badge bg-sunken text-fg-2">{S.notPublished}</span>
        )}
        {item.hasDraft && <span className="badge bg-warn-soft text-warn">{S.hasDraft}</span>}
        {item.publishedAt && <span className="num text-xs text-fg-2">{S.publishedAt(formatDateTime(item.publishedAt))}</span>}
      </div>
    </Link>
  );
}

/** `/prompts`:四个可版本化提示词的卡片 + 晋级赛提示词的只读入口(在段位规则中管理)。 */
export function PromptsPage() {
  const { data, loading, error, reload } = useAsync(listPrompts, []);
  return (
    <Page title={S.promptsPage}>
      <p className="text-sm text-fg-2">{S.intro}</p>
      {data ? (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
          {data.map((item) => <PromptCard key={item.key} item={item} />)}
          <div className="panel px-4 py-4">
            <h2 className="text-[15px] font-semibold">{S.rankCardTitle}</h2>
            <p className="mt-1 text-sm text-fg-2">{S.rankCardBody}</p>
            <Link to="/rank/rules" className="mt-3 inline-block text-sm font-medium text-accent">{S.rankCardLink}</Link>
          </div>
        </div>
      ) : loading ? (
        <Skeleton rows={4} variant="blocks" />
      ) : (
        <ErrorState message={error ?? ""} onRetry={reload} />
      )}
    </Page>
  );
}
