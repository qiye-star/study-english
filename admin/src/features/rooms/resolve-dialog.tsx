import { useEffect, useState } from "react";
import { Dialog } from "../../components/dialog";
import { MIN_REASON } from "../../components/confirm-dialog";
import { SpinnerIcon } from "../../components/icons";
import { errorText } from "../../hooks/use-async";
import { S as Shell } from "../../strings";
import { resolveReport, type Report, type Resolution } from "./api";
import { S } from "./strings";

const OPTIONS: Resolution[] = ["dismissed", "removed_message", "kicked", "closed_room"];

/** 处理举报:四选一(忽略 / 隐藏消息 / 移出发送者 / 关闭房间)+ 理由;服务端同时执行对应动作。 */
export function ResolveDialog({ report, onClose, onDone }: { report: Report | null; onClose: () => void; onDone: () => void }) {
  const [resolution, setResolution] = useState<Resolution>("dismissed");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResolution("dismissed");
    setReason("");
    setBusy(false);
    setError(null);
  }, [report]);

  if (!report) return null;
  const senderless = !report.message || report.message.sender.kind !== "user";
  const canSubmit = reason.trim().length >= MIN_REASON && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await resolveReport(report.id, resolution, reason.trim());
      onDone();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title={S.resolve.title}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            {Shell.dialogs.cancel}
          </button>
          <button
            type="button"
            className={`${resolution === "dismissed" ? "btn-primary" : "btn-danger"} btn-sm`}
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {busy && <SpinnerIcon width={14} height={14} />}
            {Shell.dialogs.confirm}
          </button>
        </>
      }
    >
      {report.message && (
        <blockquote className="whitespace-pre-wrap break-words rounded-lg border-l-2 border-line bg-sunken px-3 py-2 text-sm">
          <span className="font-semibold">{report.message.sender.name ?? S.timeline.unknownUser}:</span> {report.message.text}
        </blockquote>
      )}
      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-xs font-medium text-fg-2">{S.resolve.action}</legend>
        {OPTIONS.map((o) => {
          const disabled = (o === "kicked" && senderless) || (o === "removed_message" && !report.message);
          return (
            <label key={o} className={`flex items-start gap-2 rounded-lg px-2 py-1.5 ${disabled ? "opacity-50" : "hover:bg-sunken"}`}>
              <input type="radio" name="resolution" value={o} className="mt-1" checked={resolution === o} disabled={disabled} onChange={() => setResolution(o)} />
              <span>
                <span className="block text-sm font-medium">{S.reports.resolutions[o]}</span>
                <span className="block text-xs text-muted">{S.resolve.hints[o]}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-2">{Shell.dialogs.reason}</span>
        <textarea
          className="field-sm h-auto min-h-[64px] py-2"
          value={reason}
          maxLength={200}
          placeholder={Shell.dialogs.reasonHint}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-bad">
          {error}
        </p>
      )}
    </Dialog>
  );
}
