import { Link } from "react-router-dom";
import { Page } from "../../components/layout";
import { ErrorState, Skeleton } from "../../components/states";
import { useAsync } from "../../hooks/use-async";
import { formatBytes } from "../../lib/format";
import { getStorage } from "./api";
import { BackupsTable } from "./backups-table";
import { AuditPurgeCard, OrphanRecordingsCard, RoomAudioCard } from "./housekeeping-card";
import { S } from "./strings";

const T = S.storage;

/** 存储用量:房间语音(永久保存)/ 暂存 / 跟读录音、按月增长、语音存储 Top 10。只读。 */
function StorageCard() {
  const storage = useAsync(getStorage, []);
  const s = storage.data;
  return (
    <section className="panel" aria-label={T.title}>
      <div className="panel-head">
        <h2 className="text-sm font-semibold text-fg-2">{T.title}</h2>
      </div>
      <div className="px-4 pb-4 text-sm">
        {storage.error ? (
          <ErrorState message={storage.error} onRetry={storage.reload} />
        ) : !s ? (
          <Skeleton rows={2} />
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-6">
            <div className="space-y-1">
              <p className="num font-medium">{T.roomAudio(s.roomAudio.files, formatBytes(s.roomAudio.bytes))}</p>
              <p className="num text-fg-2">{T.staging(formatBytes(s.roomAudio.stagingBytes))}</p>
              <p className="num text-fg-2">{T.recordings(s.recordings.files, formatBytes(s.recordings.bytes))}</p>
              <p className="pt-1 text-xs text-muted">{T.keepNote}</p>
            </div>
            <div>
              <h3 className="mb-1 text-xs font-medium text-fg-2">{T.byMonth}</h3>
              {s.roomAudio.byMonth.length === 0 ? (
                <p className="text-xs text-muted">{T.noMonths}</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted">
                      <th className="py-1 font-medium">{T.month}</th>
                      <th className="py-1 text-right font-medium">{T.files}</th>
                      <th className="py-1 text-right font-medium">{T.size}</th>
                    </tr>
                  </thead>
                  <tbody className="num">
                    {s.roomAudio.byMonth.map((m) => (
                      <tr key={m.month}>
                        <td className="py-0.5">{m.month}</td>
                        <td className="py-0.5 text-right">{m.files}</td>
                        <td className="py-0.5 text-right">{formatBytes(m.bytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div>
              <h3 className="mb-1 text-xs font-medium text-fg-2">{T.topUsers}</h3>
              {s.topVoiceUsers.length === 0 ? (
                <p className="text-xs text-muted">{T.noUsers}</p>
              ) : (
                <ol className="space-y-0.5 text-xs">
                  {s.topVoiceUsers.map((u) => (
                    <li key={u.userId} className="flex items-baseline justify-between gap-2">
                      <Link className="truncate text-accent hover:underline" to={`/users/${u.userId}`}>
                        {u.username ?? T.deletedUser}
                      </Link>
                      <span className="num shrink-0 text-fg-2">{formatBytes(u.bytes)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** 数据与备份(superadmin):存储用量、备份表、孤儿录音、审计清理、房间语音清理;删除/下载/清理都要二次验证(客户端自动弹框重放)。 */
export function DataPage() {
  return (
    <Page title={S.dataPage}>
      <StorageCard />
      <BackupsTable />
      <div className="grid grid-cols-2 gap-3">
        <OrphanRecordingsCard />
        <AuditPurgeCard />
        <RoomAudioCard />
      </div>
    </Page>
  );
}
