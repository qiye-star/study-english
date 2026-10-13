import { Link } from "react-router-dom";
import { useAsync } from "../../hooks/use-async";
import { formatBytes } from "../../lib/format";
import { fetchUserLibrary } from "./api";
import { S } from "./strings";

const n = (v: number) => v.toLocaleString("en-US");

/** 用户详情页的「跟读库」占用条(spec §12;配额含按用户覆盖,覆盖本身在「治理」页签的配额表里改)。 */
export function UserLibraryUsage({ userId }: { userId: string }) {
  const { data, error } = useAsync(() => fetchUserLibrary(userId), [userId]);
  if (error) return <p className="text-xs text-muted">{S.usage.failed}</p>;
  if (!data || (!data.enabled && data.items === 0)) return null;
  return (
    <section aria-label={S.usage.title} className="panel fade-in flex items-center justify-between gap-3 px-4 py-3 text-sm">
      <div className="min-w-0">
        <p className="eyebrow">{S.usage.title}</p>
        <p className="num mt-0.5">{S.usage.line(n(data.items), n(data.maxItems), formatBytes(data.bytes), n(data.quotaMb))}</p>
      </div>
      <Link className="btn-ghost btn-sm shrink-0" to={`/library?user=${encodeURIComponent(userId)}`}>
        {S.usage.view}
      </Link>
    </section>
  );
}
