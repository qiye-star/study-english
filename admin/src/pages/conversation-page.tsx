import { Link, useParams } from "react-router-dom";
import { getConversation } from "../api/endpoints";
import { Screen, TopBar } from "../components/layout";
import { EmptyState, ErrorState, Skeleton } from "../components/states";
import { Transcript } from "../components/transcript";
import { useAsync } from "../hooks/use-async";
import { formatDateTime } from "../lib/format";
import { S } from "../strings";

export function ConversationPage() {
  const { id = "" } = useParams();
  const { data, error, reload } = useAsync(() => getConversation(id), [id]);
  const c = data?.conversation;
  return (
    <>
      <TopBar title={c?.name || S.chat.title} eyebrow={c ? `@${c.username}` : undefined} back={c ? `/users/${encodeURIComponent(c.user_id)}` : "/users"} />
      <Screen className="space-y-4">
        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data ? (
          <Skeleton rows={4} variant="blocks" />
        ) : (
          <>
            <p className="flex flex-wrap items-center justify-center gap-x-2 text-xs text-muted">
              <Link to={`/users/${encodeURIComponent(data.conversation.user_id)}`} className="font-medium text-accent">
                @{data.conversation.username}
              </Link>
              <span aria-hidden="true">·</span>
              <span className="num">{S.chat.messages(data.messages.length)}</span>
              <span aria-hidden="true">·</span>
              <span>
                {S.chat.started} <span className="num">{formatDateTime(data.conversation.created_at)}</span>
              </span>
            </p>
            {data.messages.length === 0 ? (
              <EmptyState message={S.chat.emptyMessages} />
            ) : (
              <div className="fade-in">
                <Transcript messages={data.messages} />
              </div>
            )}
          </>
        )}
      </Screen>
    </>
  );
}
