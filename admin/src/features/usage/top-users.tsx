import { Link } from "react-router-dom";
import { DataTable } from "../../components/data-table";
import type { TopUser } from "./api";
import { money } from "./kpi-row";
import { S } from "./strings";

/** Top 用户表:用户名点进用户详情。 */
export function TopUsers({
  users,
  currency,
  by,
  onByChange,
}: {
  users: TopUser[];
  currency: string;
  by: "cost" | "calls";
  onByChange: (by: "cost" | "calls") => void;
}) {
  return (
    <section className="panel" aria-label={S.topUsers}>
      <div className="panel-head">
        <h2 className="text-sm font-semibold text-fg-2">{S.topUsers}</h2>
        <div role="group" aria-label={S.topUsers} className="flex gap-0.5 rounded-lg bg-sunken p-0.5">
          {(["cost", "calls"] as const).map((b) => (
            <button
              key={b}
              type="button"
              aria-pressed={b === by}
              onClick={() => onByChange(b)}
              className={`min-h-[28px] rounded-[7px] px-2 text-xs font-medium ${b === by ? "bg-surface text-fg shadow-card" : "text-muted hover:text-fg-2"}`}
            >
              {S.topBy[b]}
            </button>
          ))}
        </div>
      </div>
      <DataTable
        caption={S.topUsers}
        rows={users}
        rowKey={(u) => u.userId}
        empty={S.empty}
        columns={[
          {
            key: "user",
            header: S.table.user,
            render: (u) => (
              <Link to={`/users/${u.userId}`} className="font-medium text-accent hover:underline">
                {u.username ?? `#${u.userId} ${S.deletedUser}`}
              </Link>
            ),
          },
          { key: "calls", header: S.table.calls, numeric: true, render: (u) => u.calls.toLocaleString("zh-CN") },
          { key: "cost", header: S.table.cost, numeric: true, render: (u) => money(u.cost, currency) },
        ]}
      />
    </section>
  );
}
