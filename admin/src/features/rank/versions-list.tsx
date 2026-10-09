import { useState } from "react";
import { Dialog } from "../../components/dialog";
import { DiffTable } from "../../components/diff-table";
import { RoleGate } from "../../components/role-gate";
import { useAsync } from "../../hooks/use-async";
import { formatDateTime } from "../../lib/format";
import { getVersion, type RankRules, type VersionItem } from "./api";
import { changeRows } from "./publish-dialog";
import { S } from "./strings";

function VersionDialog({ version, effective, onClose }: { version: number; effective: RankRules; onClose: () => void }) {
  const detail = useAsync(() => getVersion(version), [version]);
  const rows = detail.data?.rules ? changeRows(effective, detail.data.rules) : [];
  return (
    <Dialog open title={S.versions.diffTitle(version)} onClose={onClose} width={640}>
      {detail.loading && <p className="text-xs text-fg-2">…</p>}
      {detail.error && <p className="text-xs text-bad">{detail.error}</p>}
      {detail.data && (rows.length ? <DiffTable rows={rows} /> : <p className="text-xs text-fg-2">{S.versions.noDiff}</p>)}
    </Dialog>
  );
}

/** 版本列表:查看(与当前生效规则的差异)、以此为基础新建草稿(回滚 = 新版本)。 */
export function VersionsList({
  versions,
  current,
  effective,
  hasDraft,
  busy,
  onFork,
}: {
  versions: VersionItem[];
  current: number | null;
  effective: RankRules;
  hasDraft: boolean;
  busy: boolean;
  onFork: (version: number) => void;
}) {
  const [viewing, setViewing] = useState<number | null>(null);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="text-sm font-semibold">{S.versions.title}</h2>
      </div>
      {versions.length === 0 ? (
        <p className="px-4 pb-4 text-xs text-fg-2">{S.versions.empty}</p>
      ) : (
        <ul className="divide-rows">
          {versions.map((v) => (
            <li key={v.version} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="num w-10 font-medium">v{v.version}</span>
              {v.version === current && <span className="badge bg-good-soft text-fg">{S.versions.current}</span>}
              <span className="num text-xs text-fg-2">{formatDateTime(v.publishedAt)}</span>
              <span className="text-xs text-fg-2">{v.publishedBy}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-fg-2">{v.note}</span>
              <button type="button" className="btn-quiet btn-sm" onClick={() => setViewing(v.version)}>
                {S.versions.view}
              </button>
              <RoleGate min="operator">
                <button type="button" className="btn-ghost btn-sm" disabled={hasDraft || busy} onClick={() => onFork(v.version)}>
                  {S.versions.fork}
                </button>
              </RoleGate>
            </li>
          ))}
        </ul>
      )}
      {viewing !== null && <VersionDialog version={viewing} effective={effective} onClose={() => setViewing(null)} />}
    </section>
  );
}
