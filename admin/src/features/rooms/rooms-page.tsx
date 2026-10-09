import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DataTable, type Column } from "../../components/data-table";
import { Page, Segmented } from "../../components/layout";
import { ErrorState, Skeleton } from "../../components/states";
import { StatusDot } from "../../components/status-dot";
import { useAsync } from "../../hooks/use-async";
import { formatRelative } from "../../lib/format";
import { listRooms, type RoomRow, type RoomStatusFilter } from "./api";
import { S } from "./strings";

const L = S.list;

/** /rooms:房间列表(spec §6)。状态切换、按房间号/话题/房主搜索;点行进入详情。 */
export function RoomsPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<RoomStatusFilter>("open");
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);
  useEffect(() => setPage(1), [status, q]);

  const { data, error, reload } = useAsync(() => listRooms({ status, q, page }), [status, q, page]);

  const columns: Column<RoomRow>[] = [
    {
      key: "topic",
      header: L.topic,
      render: (r) => (
        <span className="flex items-center gap-2">
          <span className="font-medium">{r.topic || L.noTopic}</span>
          {r.openReports > 0 && <span className="badge bg-warn-soft text-warn">{L.reports(r.openReports)}</span>}
        </span>
      ),
    },
    { key: "code", header: L.code, render: (r) => <span className="num text-fg-2">{r.code ?? r.lastCode}</span> },
    { key: "owner", header: L.owner, render: (r) => (r.owner.id === null ? S.timeline.deletedOwner : (r.owner.name ?? S.timeline.unknownUser)) },
    { key: "members", header: L.members, numeric: true, render: (r) => `${r.memberCount} / ${r.onlineCount}` },
    { key: "messages", header: L.messages, numeric: true, render: (r) => r.messageCount },
    { key: "active", header: L.lastActive, render: (r) => <span className="text-fg-2">{formatRelative(r.lastActiveAt)}</span> },
    {
      key: "state",
      header: L.state,
      render: (r) =>
        r.status === "open" ? (
          <StatusDot tone="good" label={S.status.open} />
        ) : (
          <StatusDot tone="neutral" label={`${S.status.closed}${r.closeReason ? ` · ${S.closeReasons[r.closeReason] ?? r.closeReason}` : ""}`} />
        ),
    },
  ];

  return (
    <Page title={S.roomsPage} actions={data ? <span className="num text-sm text-muted">{L.total(data.total)}</span> : undefined}>
      <div className="flex items-center gap-3">
        <Segmented
          className="!w-auto"
          size="sm"
          label={L.status}
          value={status}
          onChange={setStatus}
          options={(["open", "closed", "all"] as const).map((v) => ({ value: v, label: L.statuses[v] }))}
        />
        <input
          type="search"
          aria-label={L.search}
          placeholder={L.search}
          className="field-sm max-w-[320px]"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </div>
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <Skeleton rows={4} />
      ) : (
        <div className="panel">
          <DataTable
            columns={columns}
            rows={data.rooms}
            empty={status === "open" && !q ? L.emptyOpen : L.empty}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/rooms/${encodeURIComponent(r.id)}`)}
            caption={S.roomsPage}
          />
        </div>
      )}
      {data && (page > 1 || data.next) && (
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {L.prev}
          </button>
          <button type="button" className="btn-ghost btn-sm" disabled={!data.next} onClick={() => setPage((p) => p + 1)}>
            {L.next}
          </button>
        </div>
      )}
    </Page>
  );
}
