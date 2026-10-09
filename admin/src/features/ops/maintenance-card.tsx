import { useEffect, useState } from "react";
import * as session from "../../api/session";
import { hasRole, type MaintenanceMode } from "../../api/session";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { getMaintenance, setMaintenance } from "./api";
import { S } from "./strings";

const M = S.maintenance;
const MODES: MaintenanceMode[] = ["off", "read_only", "full"];
const MAX = 280;

/**
 * 维护模式卡(spec §9):三段式 off / read_only / full + 中英说明;应用时要求理由,
 * 打开维护(read_only/full)还要输入 MAINTENANCE_MODE,服务端要求二次验证(客户端自动弹框重放)。
 */
export function MaintenanceCard() {
  const current = session.useAdminSession();
  const canEdit = hasRole(current, "superadmin");
  const [loaded, setLoaded] = useState<{ mode: MaintenanceMode; messageZh: string; messageEn: string } | null>(null);
  const [mode, setMode] = useState<MaintenanceMode>(current?.maintenanceMode ?? "off");
  const [zh, setZh] = useState("");
  const [en, setEn] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.resolve(getMaintenance())
      .then((m) => {
        if (!live || !m) return;
        setLoaded(m);
        setMode(m.mode);
        setZh(m.messageZh);
        setEn(m.messageEn);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const baseMode = loaded?.mode ?? current?.maintenanceMode ?? "off";
  const dirty = mode !== baseMode || zh !== (loaded?.messageZh ?? "") || en !== (loaded?.messageEn ?? "");
  const turningOn = mode !== "off" && mode !== baseMode;

  const apply = async (reason: string) => {
    await setMaintenance({ mode, messageZh: zh, messageEn: en, reason, confirm: turningOn ? M.phrase : undefined });
    setLoaded({ mode, messageZh: zh, messageEn: en });
    setConfirming(false);
    setNotice(M.applied);
    void session.refreshSession(); // the shell's maintenance bar follows the session
  };

  return (
    <section className="panel" aria-label={M.title}>
      <div className="panel-head">
        <h2 className="text-sm font-semibold text-fg-2">{M.title}</h2>
        {!canEdit && <span className="text-xs text-fg-2">{M.superadminOnly}</span>}
      </div>
      <div className="space-y-3 px-4 pb-4">
        <div role="radiogroup" aria-label={M.title} className="inline-flex gap-0.5 rounded-lg bg-sunken p-0.5">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={m === mode}
              disabled={!canEdit}
              onClick={() => setMode(m)}
              className={`min-h-[32px] min-w-[72px] rounded-[7px] px-3 text-sm font-medium transition-colors ${
                m === mode ? (m === "off" ? "bg-surface text-fg shadow-card" : "bg-warn-soft text-warn shadow-card") : "text-muted hover:text-fg-2"
              }`}
            >
              {M.modes[m]}
            </button>
          ))}
        </div>
        <p className="text-xs text-fg-2">{M.modeHelp[mode]}</p>
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              [M.messageZh, zh, setZh],
              [M.messageEn, en, setEn],
            ] as const
          ).map(([label, value, set]) => (
            <label key={label} className="space-y-1">
              <span className="flex justify-between text-xs font-medium text-fg-2">
                <span>{label}</span>
                <span className="num">{S.announcements.count(value.length)}</span>
              </span>
              <textarea className="field-sm h-auto min-h-[56px] py-2" value={value} maxLength={MAX} disabled={!canEdit} onChange={(e) => set(e.target.value)} />
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button type="button" className={mode === "off" ? "btn-primary btn-sm" : "btn-danger btn-sm"} disabled={!canEdit || !dirty} onClick={() => setConfirming(true)}>
            {M.apply}
          </button>
          {notice && (
            <span role="status" className="text-sm text-good">
              {notice}
            </span>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        title={M.confirmTitle}
        body={mode === "off" ? M.offBody : M.confirmBody(M.modes[mode])}
        requireTyping={turningOn ? M.phrase : undefined}
        reasonRequired
        danger={mode !== "off"}
        onConfirm={apply}
        onClose={() => setConfirming(false)}
      />
    </section>
  );
}
