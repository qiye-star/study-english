import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { hasRole, useAdminSession } from "../../api/session";
import { ConfirmDialog, MIN_REASON } from "../../components/confirm-dialog";
import { Dialog } from "../../components/dialog";
import { Page } from "../../components/layout";
import { ErrorState, Skeleton } from "../../components/states";
import { StatusDot } from "../../components/status-dot";
import { S as Shell } from "../../strings";
import { errorText, useAsync } from "../../hooks/use-async";
import { formatDateTime } from "../../lib/format";
import {
  closeRoom,
  reopenRoom,
  getRoom,
  getRoomMessages,
  hideMessage,
  kickMember,
  patchRoomSettings,
  setRoomAi,
  type AdminMessage,
  type JoinMode,
  type Lane,
  type RoomDetail,
  type RoomMember,
  type RoomSettingsChanges,
} from "./api";
import { RoomTimeline } from "./room-timeline";
import { S } from "./strings";

const D = S.detail;
const T = S.timeline;

type Pending =
  | { kind: "close" }
  | { kind: "reopen" }
  | { kind: "ai"; muted: boolean }
  | { kind: "kick"; member: RoomMember }
  | { kind: "hide"; message: AdminMessage }
  | null;

function Members({ members, canModerate, onKick }: { members: RoomMember[]; canModerate: boolean; onKick: (m: RoomMember) => void }) {
  if (members.length === 0) return <p className="px-4 py-6 text-center text-sm text-muted">{D.noMembers}</p>;
  return (
    <ul className="divide-rows">
      {members.map((m) => {
        const active = !m.kicked && !m.leftAt;
        return (
          <li key={m.userId} data-testid={`member-${m.userId}`} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium">
                <StatusDot tone={m.online ? "good" : "neutral"} />
                <Link className="truncate hover:underline" to={`/users/${m.userId}`}>
                  {m.name ?? T.unknownUser}
                </Link>
                {m.role === "owner" && active && <span className="badge bg-accent-soft text-accent">{D.roles.owner}</span>}
                {m.kicked && <span className="badge bg-bad-soft text-bad">{D.kicked}</span>}
                {!m.kicked && m.leftAt && <span className="badge bg-sunken text-muted">{D.left}</span>}
              </p>
              <p className="num mt-0.5 text-2xs text-muted">
                {m.online ? D.online : D.offline} · {formatDateTime(m.joinedAt)}
              </p>
            </div>
            {canModerate && !m.kicked && (
              <button type="button" className="btn-quiet btn-sm" onClick={() => onKick(m)}>
                {D.kick}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const ST = S.settings;
const NAME_MAX = 30;
const SIZE_MAX = 8;

function SettingRow({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <div data-testid={`setting-${id}`} className="flex items-baseline justify-between gap-3 px-4 py-1.5 text-sm">
      <dt className="shrink-0 text-fg-2">{label}</dt>
      <dd className="num min-w-0 truncate text-right font-medium">{value}</dd>
    </div>
  );
}

/** 7 项设置 + 锁定 + 邀请链接是否已生成(不显示 token);operator 可改 5 项,保存需填理由。 */
function SettingsCard({ room, canEdit, onEdit }: { room: RoomDetail; canEdit: boolean; onEdit: () => void }) {
  const s = room.settings;
  const onOff = (v: boolean) => (v ? ST.on : ST.off);
  return (
    <section className="panel" aria-label={ST.title}>
      <div className="panel-head">
        <h2 className="text-sm font-semibold">{ST.title}</h2>
        {canEdit && (
          <button type="button" className="btn-quiet btn-sm" onClick={onEdit}>
            {ST.edit}
          </button>
        )}
      </div>
      <dl className="pb-2">
        <SettingRow id="name" label={ST.name} value={s.name || ST.unnamed} />
        <SettingRow id="scenario" label={ST.scenario} value={ST.scenarios[s.scenario] ?? s.scenario} />
        <SettingRow id="level" label={ST.level} value={s.level} />
        <SettingRow id="joinMode" label={ST.joinMode} value={ST.joinModes[s.joinMode] ?? s.joinMode} />
        <SettingRow id="maxMembers" label={ST.maxMembers} value={ST.maxMembersValue(s.maxMembers)} />
        <SettingRow id="aiPublic" label={ST.aiPublic} value={onOff(s.aiPublic)} />
        <SettingRow id="allowVoice" label={ST.allowVoice} value={onOff(s.allowVoice)} />
        <SettingRow id="locked" label={ST.locked} value={ST.lockedValue[String(s.locked)]} />
        <SettingRow id="invite" label={ST.invite} value={ST.inviteValue[String(s.hasInvite)]} />
      </dl>
    </section>
  );
}

function SettingsDialog({ room, open, onClose, onSaved }: { room: RoomDetail; open: boolean; onClose: () => void; onSaved: () => void }) {
  const s = room.settings;
  const [name, setName] = useState(s.name);
  const [joinMode, setJoinMode] = useState<JoinMode>(s.joinMode);
  const [size, setSize] = useState(String(s.maxMembers));
  const [aiPublic, setAiPublic] = useState(s.aiPublic);
  const [allowVoice, setAllowVoice] = useState(s.allowVoice);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(s.name);
    setJoinMode(s.joinMode);
    setSize(String(s.maxMembers));
    setAiPublic(s.aiPublic);
    setAllowVoice(s.allowVoice);
    setReason("");
    setError(null);
    setBusy(false);
  }, [open, s]);

  const n = Number(size);
  const sizeOk = Number.isInteger(n) && n >= 2 && n <= SIZE_MAX && n >= room.memberCount;
  const trimmed = name.trim();
  const nameOk = [...trimmed].length <= NAME_MAX;
  const changes: RoomSettingsChanges = {};
  if (trimmed && trimmed !== s.name) changes.name = trimmed;
  if (joinMode !== s.joinMode) changes.joinMode = joinMode;
  if (sizeOk && n !== s.maxMembers) changes.maxMembers = n;
  if (aiPublic !== s.aiPublic) changes.aiPublic = aiPublic;
  if (allowVoice !== s.allowVoice) changes.allowVoice = allowVoice;
  const canSave = !busy && sizeOk && nameOk && Object.keys(changes).length > 0 && reason.trim().length >= MIN_REASON;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await patchRoomSettings(room.id, changes, reason.trim());
      onSaved();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={ST.editTitle}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            {Shell.dialogs.cancel}
          </button>
          <button type="button" className="btn-primary btn-sm" disabled={!canSave} onClick={() => void save()}>
            {ST.save}
          </button>
        </>
      }
    >
      <p className="text-xs leading-relaxed text-fg-2">{ST.editHelp}</p>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-2">{ST.name}</span>
        <input className="field-sm" value={name} onChange={(e) => setName(e.target.value)} />
        {!nameOk && <span className="block text-xs text-bad">{ST.nameHint}</span>}
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-2">{ST.joinMode}</span>
          <select className="field-sm" value={joinMode} onChange={(e) => setJoinMode(e.target.value as JoinMode)}>
            {(["code", "approval"] as const).map((m) => (
              <option key={m} value={m}>
                {ST.joinModes[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-2">{ST.maxMembers}</span>
          <input className="field-sm num" inputMode="numeric" value={size} onChange={(e) => setSize(e.target.value)} />
        </label>
      </div>
      {!sizeOk && <p className="text-xs text-bad">{ST.sizeHint(room.memberCount)}</p>}
      <div className="flex gap-6 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={aiPublic} onChange={(e) => setAiPublic(e.target.checked)} />
          {ST.aiPublic}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={allowVoice} onChange={(e) => setAllowVoice(e.target.checked)} />
          {ST.allowVoice}
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-fg-2">{Shell.dialogs.reason}</span>
        <textarea
          className="field-sm h-auto min-h-[64px] py-2"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          placeholder={Shell.dialogs.reasonHint}
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

/** /rooms/:id:成员、时间线(公共默认,私聊需确认并写审计)、关闭房间 / 禁用 AI / 隐藏消息 / 移出成员(都要理由)。 */
export function RoomDetailPage() {
  const { id = "" } = useParams();
  const session = useAdminSession();
  const canModerate = hasRole(session, "operator");
  const room = useAsync(() => getRoom(id), [id]);
  const [lane, setLane] = useState<Lane>("public");
  const [askPrivate, setAskPrivate] = useState(false);
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(
    async (beforeSeq: number | null) => {
      setTimelineError(null);
      try {
        const t = await getRoomMessages(id, { lane, beforeSeq });
        setMessages((cur) => (beforeSeq === null ? t.messages : [...t.messages, ...cur]));
        setNextBefore(t.nextBeforeSeq);
      } catch (e) {
        setTimelineError(errorText(e));
      } finally {
        setLoaded(true);
      }
    },
    [id, lane],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  const refresh = () => {
    room.reload();
    void load(null);
  };

  const r = room.data;
  const confirmProps = (() => {
    if (!pending || !r) return null;
    switch (pending.kind) {
      case "close":
        return { title: D.closeTitle, body: D.closeBody, danger: true, run: (reason: string) => closeRoom(id, reason) };
      case "reopen":
        return { title: D.reopenTitle, body: D.reopenBody, danger: false, run: (reason: string) => reopenRoom(id, reason) };
      case "ai":
        return pending.muted
          ? { title: D.muteTitle, body: D.muteBody, danger: true, run: (reason: string) => setRoomAi(id, true, reason) }
          : { title: D.unmuteTitle, body: D.unmuteBody, danger: false, run: (reason: string) => setRoomAi(id, false, reason) };
      case "kick":
        return { title: D.kickTitle(pending.member.name ?? T.unknownUser), body: D.kickBody, danger: true, run: (reason: string) => kickMember(id, pending.member.userId, reason) };
      case "hide":
        return { title: T.hideTitle, body: T.hideBody, danger: true, run: (reason: string) => hideMessage(id, pending.message.id, reason) };
    }
  })();

  return (
    <Page
      title={r ? r.name || r.topic || S.list.noTopic : S.roomDetailPage}
      actions={
        r && canModerate ? (
          <>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setPending({ kind: "ai", muted: !r.aiMuted })}>
              {r.aiMuted ? D.unmuteAi : D.muteAi}
            </button>
            {r.status === "open" && (
              <button type="button" className="btn-danger btn-sm" onClick={() => setPending({ kind: "close" })}>
                {D.close}
              </button>
            )}
            {r.status === "closed" && (
              <button type="button" className="btn-primary btn-sm" onClick={() => setPending({ kind: "reopen" })}>
                {D.reopen}
              </button>
            )}
          </>
        ) : undefined
      }
    >
      <Link to="/rooms" className="text-sm text-accent hover:underline">
        ← {D.back}
      </Link>
      {room.error ? (
        <ErrorState message={room.error} onRetry={room.reload} />
      ) : !r ? (
        <Skeleton rows={3} />
      ) : (
        <>
          <section className="panel flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 text-sm">
            <StatusDot
              tone={r.status === "open" ? "good" : "neutral"}
              label={`${S.status[r.status]}${r.closeReason ? ` · ${S.closeReasons[r.closeReason] ?? r.closeReason}` : ""}`}
            />
            <span className="num text-fg-2">{S.list.code} {r.code ?? r.lastCode}</span>
            <span className="text-fg-2">
              {D.owner} {r.owner.id === null ? T.deletedOwner : (r.owner.name ?? T.unknownUser)}
            </span>
            <span className="num text-fg-2">
              {D.created} {formatDateTime(r.createdAt)}
            </span>
            {r.closedAt && (
              <span className="num text-fg-2">
                {D.closed} {formatDateTime(r.closedAt)}
              </span>
            )}
            {r.reopenCount > 0 && <span className="num text-fg-2">{D.reopenedTimes(r.reopenCount)}</span>}
            {r.aiMuted && <span className="badge bg-warn-soft text-warn">{D.aiMuted}</span>}
            <span className="text-fg-2">{D.reportCount(r.reportCount)}</span>
          </section>

          <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-4">
            <section className="panel" aria-label={T.title}>
              <div className="panel-head">
                <h2 className="text-sm font-semibold">{T.title}</h2>
                <label className="flex items-center gap-2 text-sm text-fg-2">
                  {T.showPrivate}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={lane === "all"}
                    aria-label={T.showPrivate}
                    onClick={() => (lane === "all" ? setLane("public") : setAskPrivate(true))}
                    className={`relative h-5 w-9 rounded-full transition-colors ${lane === "all" ? "bg-accent" : "bg-line-strong"}`}
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface transition-[left] ${lane === "all" ? "left-[18px]" : "left-0.5"}`} />
                  </button>
                </label>
              </div>
              {timelineError ? (
                <div className="p-4">
                  <ErrorState message={timelineError} onRetry={() => void load(null)} />
                </div>
              ) : !loaded ? (
                <div className="p-4">
                  <Skeleton rows={3} />
                </div>
              ) : (
                <RoomTimeline
                  roomId={id}
                  messages={messages}
                  canModerate={canModerate}
                  onHide={(message) => setPending({ kind: "hide", message })}
                  hasEarlier={nextBefore !== null}
                  onLoadEarlier={() => void load(nextBefore)}
                />
              )}
            </section>
            <div className="space-y-4">
              <SettingsCard room={r} canEdit={canModerate && r.status === "open"} onEdit={() => setEditing(true)} />
              <aside className="panel" aria-label={D.members}>
                <div className="panel-head">
                  <h2 className="text-sm font-semibold">{D.members}</h2>
                  <span className="num text-xs text-muted">
                    {r.memberCount} / {r.onlineCount}
                  </span>
                </div>
                <Members members={r.members} canModerate={canModerate} onKick={(member) => setPending({ kind: "kick", member })} />
              </aside>
            </div>
          </div>
        </>
      )}

      <Dialog
        open={askPrivate}
        title={T.privateTitle}
        onClose={() => setAskPrivate(false)}
        footer={
          <>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setAskPrivate(false)}>
              {Shell.dialogs.cancel}
            </button>
            <button
              type="button"
              className="btn-primary btn-sm"
              onClick={() => {
                setAskPrivate(false);
                setLane("all");
              }}
            >
              {T.continue}
            </button>
          </>
        }
      >
        <p className="leading-relaxed text-fg-2">{T.privateBody}</p>
      </Dialog>

      {r && canModerate && (
        <SettingsDialog
          room={r}
          open={editing}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={confirmProps !== null}
        title={confirmProps?.title ?? ""}
        body={confirmProps?.body}
        danger={confirmProps?.danger}
        reasonRequired
        onClose={() => setPending(null)}
        onConfirm={async (reason) => {
          await confirmProps?.run(reason);
          setPending(null);
          refresh();
        }}
      />
    </Page>
  );
}
