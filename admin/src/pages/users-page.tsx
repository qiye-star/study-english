import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listUsers } from "../api/endpoints";
import type { UserSummary } from "../api/types";
import { Avatar } from "../components/avatar";
import { ChevronIcon, SearchIcon } from "../components/icons";
import { Screen, TOP_BAR_H, TopBar } from "../components/layout";
import { PagedList } from "../components/states";
import { usePaged } from "../hooks/use-paged";
import { formatBytes, formatRelative } from "../lib/format";
import { S } from "../strings";

export function UserCard({ user }: { user: UserSummary }) {
  return (
    <li>
      <Link to={`/users/${encodeURIComponent(user.id)}`} className="row-link">
        <Avatar name={user.username} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold leading-tight">{user.username}</p>
          <p className="mt-0.5 truncate text-xs text-muted">
            {S.users.lastActive} {formatRelative(user.last_active_at)}
          </p>
        </div>
        <dl className="num shrink-0 text-right text-xs leading-tight text-muted">
          <div className="flex justify-end gap-2">
            <span>
              <dd className="inline font-medium text-fg">{user.conversations}</dd> <dt className="inline">{S.users.conversations}</dt>
            </span>
            <span>
              <dd className="inline font-medium text-fg">{user.assessments}</dd> <dt className="inline">{S.users.assessments}</dt>
            </span>
          </div>
          <div className="mt-0.5">
            <dd className="inline">{formatBytes(user.recording_bytes)}</dd>
          </div>
        </dl>
        <ChevronIcon className="shrink-0 text-line-strong" width={18} height={18} />
      </Link>
    </li>
  );
}

export function UsersPage() {
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);

  const paged = usePaged<UserSummary>(async (page) => {
    const r = await listUsers(q, page);
    return { items: r.users, next: r.next, total: r.total };
  }, [q]);

  return (
    <>
      <TopBar title={S.users.title} subtitle={paged.total !== undefined && !paged.loading ? S.users.total(paged.total) : undefined} />
      <div className="sticky z-10 bg-bg/88 px-4 pb-2 pt-3 backdrop-blur-xl" style={{ top: `calc(${TOP_BAR_H}px + env(safe-area-inset-top))` }}>
        <label className="relative block">
          <span className="sr-only">{S.users.search}</span>
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" width={18} height={18} />
          <input
            id="user-search"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={S.users.search}
            autoCapitalize="none"
            autoCorrect="off"
            className="field h-11 pl-10"
          />
        </label>
      </div>
      <Screen className="pt-2">
        <PagedList paged={paged} empty={q ? S.users.emptySearch : S.users.empty}>
          {(items) => items.map((u) => <UserCard key={u.id} user={u} />)}
        </PagedList>
      </Screen>
    </>
  );
}
