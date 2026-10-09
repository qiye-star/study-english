import { useEffect, useState, type FormEvent } from "react";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { DataTable } from "../../components/data-table";
import { Dialog } from "../../components/dialog";
import { Page } from "../../components/layout";
import { ErrorState, Skeleton } from "../../components/states";
import { errorText } from "../../hooks/use-async";
import { formatDateTime } from "../../lib/format";
import { S as Shared } from "../../strings";
import {
  archiveAnnouncement,
  createAnnouncement,
  listAnnouncements,
  updateAnnouncement,
  type Announcement,
  type AnnouncementInput,
  type AnnouncementLevel,
} from "./api";
import { MaintenanceCard } from "./maintenance-card";
import { S } from "./strings";

const A = S.announcements;
const MAX = 280;

const pad = (n: number) => String(n).padStart(2, "0");
/** ISO → `<input type="datetime-local">` 的本地时间值 */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

/** 网页横幅预览:与网页端一致(warning = 琥珀色调,info = 中性底,文字 ink)。 */
export function BannerPreview({ level, text, dismissible }: { level: AnnouncementLevel; text: string; dismissible: boolean }) {
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm text-fg ${level === "warning" ? "border-warn/30 bg-warn-soft" : "border-line bg-sunken"}`}>
      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{text || "…"}</p>
      {dismissible && (
        <span aria-hidden="true" className="text-muted">
          ×
        </span>
      )}
    </div>
  );
}

function AnnouncementForm({ initial, onSaved, onClose }: { initial: Announcement | null; onSaved: () => void; onClose: () => void }) {
  const [level, setLevel] = useState<AnnouncementLevel>(initial?.level ?? "info");
  const [zh, setZh] = useState(initial?.textZh ?? "");
  const [en, setEn] = useState(initial?.textEn ?? "");
  const [starts, setStarts] = useState(toLocalInput(initial?.startsAt ?? new Date().toISOString()));
  const [ends, setEnds] = useState(toLocalInput(initial?.endsAt ?? null));
  const [dismissible, setDismissible] = useState(initial?.dismissible ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = zh.trim().length > 0 && zh.length <= MAX && en.length <= MAX && !!starts && (!ends || ends > starts);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!valid || busy) return;
    const data: AnnouncementInput = {
      level,
      textZh: zh.trim(),
      textEn: en.trim(),
      startsAt: fromLocalInput(starts) as string,
      endsAt: fromLocalInput(ends),
      dismissible,
    };
    setBusy(true);
    setError(null);
    try {
      if (initial) await updateAnnouncement(initial.id, data);
      else await createAnnouncement(data);
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title={initial ? A.edit : A.create}
      width={640}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            {Shared.dialogs.cancel}
          </button>
          <button type="button" className="btn-primary btn-sm" disabled={!valid || busy} onClick={() => void submit()}>
            {A.save}
          </button>
        </>
      }
    >
      <form className="space-y-3" onSubmit={submit}>
        <div role="radiogroup" aria-label={A.level} className="inline-flex gap-0.5 rounded-lg bg-sunken p-0.5">
          {(["info", "warning"] as const).map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={l === level}
              onClick={() => setLevel(l)}
              className={`min-h-[30px] min-w-[64px] rounded-[7px] px-3 text-sm font-medium ${l === level ? "bg-surface text-fg shadow-card" : "text-muted"}`}
            >
              {A.levels[l]}
            </button>
          ))}
        </div>
        {(
          [
            ["zh", A.zh, zh, setZh],
            ["en", A.en, en, setEn],
          ] as const
        ).map(([key, label, value, set]) => (
          <div key={key} className="space-y-1">
            <div className="flex justify-between text-xs font-medium text-fg-2">
              <label htmlFor={`ann-${key}`}>{label}</label>
              <span className={`num ${value.length > MAX ? "text-bad" : ""}`}>{A.count(value.length)}</span>
            </div>
            <textarea id={`ann-${key}`} className="field-sm h-auto min-h-[64px] py-2" value={value} maxLength={MAX} onChange={(e) => set(e.target.value)} />
          </div>
        ))}
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="block text-xs font-medium text-fg-2">{A.startsAt}</span>
            <input type="datetime-local" className="field-sm" value={starts} onChange={(e) => setStarts(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-medium text-fg-2">{A.endsAt}</span>
            <input type="datetime-local" className="field-sm" value={ends} onChange={(e) => setEnds(e.target.value)} />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={dismissible} onChange={(e) => setDismissible(e.target.checked)} />
          {A.dismissible}
        </label>
        <div className="space-y-1">
          <p className="text-xs font-medium text-fg-2">{A.preview}</p>
          <BannerPreview level={level} text={zh} dismissible={dismissible} />
        </div>
        {error && (
          <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-bad">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

const STATUS_CLASS: Record<string, string> = {
  active: "bg-good-soft text-good",
  scheduled: "bg-accent-soft text-accent",
  ended: "bg-sunken text-fg-2",
  archived: "bg-sunken text-muted",
};

/** 公告与维护(operator;维护开关仅 superadmin):维护卡 + 公告列表 + 新建/编辑表单(含 280 字计数与横幅预览)。 */
export function AnnouncementsPage() {
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Announcement | null | "new">(null);
  const [archiving, setArchiving] = useState<Announcement | null>(null);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);

  useEffect(() => {
    let live = true;
    Promise.resolve(listAnnouncements())
      .then((rows) => live && setItems(rows ?? []))
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [tick]);

  return (
    <Page
      title={S.announcementsPage}
      actions={
        <button type="button" className="btn-primary btn-sm" onClick={() => setEditing("new")}>
          {A.create}
        </button>
      }
    >
      <MaintenanceCard />
      <section className="panel" aria-label={A.list}>
        <div className="panel-head">
          <h2 className="text-sm font-semibold text-fg-2">{A.list}</h2>
        </div>
        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : items === null ? (
          <Skeleton rows={2} />
        ) : (
          <DataTable
            caption={A.list}
            rows={items}
            rowKey={(a) => a.id}
            empty={A.empty}
            columns={[
              {
                key: "level",
                header: A.level,
                render: (a) => <span className={`badge ${a.level === "warning" ? "bg-warn-soft text-warn" : "bg-sunken text-fg-2"}`}>{A.levels[a.level]}</span>,
              },
              { key: "text", header: A.text, render: (a) => <span className="line-clamp-2 max-w-[420px]">{a.textZh}</span> },
              {
                key: "window",
                header: A.window,
                render: (a) => <span className="num whitespace-nowrap text-xs">{`${formatDateTime(a.startsAt)} → ${a.endsAt ? formatDateTime(a.endsAt) : A.open}`}</span>,
              },
              { key: "dismissible", header: A.dismissible, render: (a) => (a.dismissible ? A.yes : A.no) },
              { key: "status", header: A.status, render: (a) => <span className={`badge ${STATUS_CLASS[a.status] ?? ""}`}>{A.statuses[a.status]}</span> },
              {
                key: "actions",
                header: A.actions,
                align: "right",
                render: (a) =>
                  a.status === "archived" ? null : (
                    <span className="inline-flex gap-1">
                      <button type="button" className="btn-quiet btn-sm" onClick={() => setEditing(a)}>
                        {A.edit}
                      </button>
                      <button type="button" className="btn-quiet btn-sm" onClick={() => setArchiving(a)}>
                        {A.archive}
                      </button>
                    </span>
                  ),
              },
            ]}
          />
        )}
      </section>
      {editing !== null && (
        <AnnouncementForm
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      <ConfirmDialog
        open={archiving !== null}
        title={A.archiveTitle}
        body={A.archiveBody}
        confirmText={A.archive}
        onConfirm={async () => {
          if (archiving) await archiveAnnouncement(archiving.id);
          setArchiving(null);
          reload();
        }}
        onClose={() => setArchiving(null)}
      />
    </Page>
  );
}
