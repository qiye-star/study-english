import { useState } from "react";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { errorText } from "../../hooks/use-async";
import { formatBytes } from "../../lib/format";
import { runHousekeeping, scanHousekeeping, type AuditScan, type OrphanScan, type RoomAudioScan } from "./api";
import { S } from "./strings";

const D = S.data;

/** 孤儿录音:先扫描(数量、字节、样例路径),确认后按扫描 token 删除;文件集变了服务端要求重扫。 */
export function OrphanRecordingsCard() {
  const [scan, setScan] = useState<OrphanScan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const doScan = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setScan(await scanHousekeeping("orphan_recordings"));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-label={D.orphanTitle}>
      <div className="panel-head">
        <h2 className="text-sm font-semibold text-fg-2">{D.orphanTitle}</h2>
        <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void doScan()}>
          {busy ? D.scanning : D.scan}
        </button>
      </div>
      <div className="space-y-2 px-4 pb-4 text-sm">
        <p className="text-xs text-fg-2">{D.orphanHelp}</p>
        {scan && (
          <>
            <p className="num font-medium">{D.orphanResult(scan.count, formatBytes(scan.bytes))}</p>
            {scan.samples.length > 0 && (
              <ul className="max-h-40 overflow-auto rounded-lg bg-sunken px-3 py-2 font-mono text-xs text-fg-2">
                {scan.samples.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {scan.count > 0 && (
              <button type="button" className="btn-danger btn-sm" onClick={() => setConfirming(true)}>
                {D.deleteOrphans}
              </button>
            )}
          </>
        )}
        {notice && (
          <p role="status" className="text-good">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="text-bad">
            {error}
          </p>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        title={D.deleteOrphansTitle}
        body={scan ? D.orphanResult(scan.count, formatBytes(scan.bytes)) : undefined}
        reasonRequired
        danger
        confirmText={D.delete}
        onConfirm={async (reason) => {
          const out = await runHousekeeping("orphan_recordings", { token: scan?.token, reason });
          setConfirming(false);
          setScan(null);
          setNotice(D.deleted(out?.deleted ?? 0));
        }}
        onClose={() => setConfirming(false)}
      />
    </section>
  );
}

const ROOM_AUDIO_MIN_DAYS = 30;
const ROOM_AUDIO_DEFAULT_DAYS = 365;

/**
 * 房间语音清理(rooms v2 §12):音频永久保存,这是唯一的删除途径,从不自动运行。
 * 天数(默认建议 365,最少 30)→ 预演扫描(数量、字节、房间数)→ 输入确认短语 + 理由 → 二次验证 → 按 token 执行。
 * 改天数后旧的扫描作废,需要重新扫描。
 */
export function RoomAudioCard() {
  const [days, setDays] = useState(String(ROOM_AUDIO_DEFAULT_DAYS));
  const [scan, setScan] = useState<RoomAudioScan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const n = Number(days);
  const daysOk = Number.isInteger(n) && n >= ROOM_AUDIO_MIN_DAYS && n <= 36500;

  const doScan = async () => {
    if (!daysOk) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setScan(await scanHousekeeping("room_audio", n));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-label={D.roomAudioTitle}>
      <div className="panel-head">
        <h2 className="text-sm font-semibold text-fg-2">{D.roomAudioTitle}</h2>
      </div>
      <div className="space-y-2 px-4 pb-4 text-sm">
        <p className="text-xs text-fg-2">{D.roomAudioHelp}</p>
        <div className="flex items-end gap-2">
          <label className="space-y-1">
            <span className="block text-xs font-medium text-fg-2">{D.roomAudioDays}</span>
            <input
              className="field-sm num w-28"
              inputMode="numeric"
              value={days}
              onChange={(e) => {
                setDays(e.target.value);
                setScan(null);
              }}
            />
          </label>
          <button type="button" className="btn-ghost btn-sm" disabled={busy || !daysOk} onClick={() => void doScan()}>
            {busy ? D.scanning : D.scan}
          </button>
        </div>
        {!daysOk && <p className="text-xs text-bad">{D.roomAudioMin(ROOM_AUDIO_MIN_DAYS)}</p>}
        {scan && (
          <>
            <p className="num font-medium">{D.orphanResult(scan.count, formatBytes(scan.bytes))}</p>
            <p className="num text-xs text-fg-2">{D.roomAudioRooms(scan.rooms)}</p>
            {scan.samples.length > 0 && (
              <ul className="max-h-40 overflow-auto rounded-lg bg-sunken px-3 py-2 font-mono text-xs text-fg-2">
                {scan.samples.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {scan.count > 0 && (
              <button type="button" className="btn-danger btn-sm" onClick={() => setConfirming(true)}>
                {D.deleteRoomAudio}
              </button>
            )}
          </>
        )}
        {notice && (
          <p role="status" className="text-good">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="text-bad">
            {error}
          </p>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        title={D.deleteRoomAudioTitle}
        body={scan ? D.deleteRoomAudioBody(scan.count, formatBytes(scan.bytes), scan.olderThanDays) : undefined}
        requireTyping={scan?.confirm}
        reasonRequired
        danger
        confirmText={D.delete}
        onConfirm={async (reason) => {
          if (!scan) return;
          const out = await runHousekeeping("room_audio", { token: scan.token, olderThanDays: scan.olderThanDays, reason, confirm: scan.confirm });
          setConfirming(false);
          setScan(null);
          setNotice(D.deleted(out?.deleted ?? 0));
        }}
        onClose={() => setConfirming(false)}
      />
    </section>
  );
}

/** 审计清理:天数不小于保留期;删除后服务端写锚点。 */
export function AuditPurgeCard() {
  const [scan, setScan] = useState<AuditScan | null>(null);
  const [days, setDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const doScan = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await scanHousekeeping("audit");
      setScan(s);
      setDays(String(s.retentionDays));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const n = Number(days);
  const tooSmall = !!scan && (!Number.isInteger(n) || n < scan.retentionDays);

  return (
    <section className="panel" aria-label={D.auditTitle}>
      <div className="panel-head">
        <h2 className="text-sm font-semibold text-fg-2">{D.auditTitle}</h2>
        <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void doScan()}>
          {busy ? D.scanning : D.scan}
        </button>
      </div>
      <div className="space-y-2 px-4 pb-4 text-sm">
        {scan && (
          <>
            <p className="text-xs text-fg-2">{D.auditHelp(scan.retentionDays)}</p>
            <p className="num font-medium">{D.auditCount(scan.count, scan.retentionDays)}</p>
            <div className="flex items-end gap-2">
              <label className="space-y-1">
                <span className="block text-xs font-medium text-fg-2">{D.olderThan}</span>
                <input className="field-sm w-28" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
              </label>
              <button type="button" className="btn-danger btn-sm" disabled={tooSmall} onClick={() => setConfirming(true)}>
                {D.purge}
              </button>
            </div>
            {tooSmall && <p className="text-xs text-bad">{D.tooSmall(scan.retentionDays)}</p>}
          </>
        )}
        {notice && (
          <p role="status" className="text-good">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="text-bad">
            {error}
          </p>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        title={D.purgeTitle}
        reasonRequired
        danger
        confirmText={D.purge}
        onConfirm={async (reason) => {
          const out = await runHousekeeping("audit", { olderThanDays: n, reason });
          setConfirming(false);
          setScan(null);
          setNotice(D.deleted(out?.deleted ?? 0));
        }}
        onClose={() => setConfirming(false)}
      />
    </section>
  );
}
