import { formatTime } from "../../lib/format";
import type { AdminMessage } from "./api";
import { S } from "./strings";

const T = S.timeline;

function systemText(m: AdminMessage): string {
  const meta = (m.meta ?? {}) as Record<string, string>;
  return T.system[m.text]?.(meta) ?? m.text;
}

/**
 * 管理端消息时间线:公共通道默认;打开「显示私聊」后助手私聊以缩进的浅底块出现。系统消息居中小字;
 * 已隐藏的消息保留原文(删除线)并带「已隐藏」徽标。每条成员/AI 消息可「隐藏」(operator)。
 */
export function RoomTimeline({
  messages,
  canModerate,
  onHide,
  hasEarlier,
  onLoadEarlier,
}: {
  messages: AdminMessage[];
  canModerate: boolean;
  onHide: (m: AdminMessage) => void;
  hasEarlier: boolean;
  onLoadEarlier: () => void;
}) {
  if (messages.length === 0) return <p className="px-4 py-10 text-center text-sm text-muted">{T.empty}</p>;
  return (
    <ol className="space-y-2 px-4 py-3" aria-label={T.title}>
      {hasEarlier && (
        <li className="text-center">
          <button type="button" className="btn-quiet btn-sm" onClick={onLoadEarlier}>
            {T.loadEarlier}
          </button>
        </li>
      )}
      {messages.map((m) => {
        if (m.kind === "system") {
          return (
            <li key={m.id} data-testid={`msg-${m.seq}`} className="py-0.5 text-center text-2xs text-muted">
              {systemText(m)} · <span className="num">{formatTime(m.createdAt)}</span>
            </li>
          );
        }
        const isPrivate = m.lane === "private";
        const name = m.sender.kind === "ai" ? T.ai : m.sender.name ?? T.unknownUser;
        return (
          <li
            key={m.id}
            data-testid={`msg-${m.seq}`}
            className={`group flex items-start gap-3 rounded-lg px-3 py-2 ${isPrivate ? "ml-8 bg-sunken" : "hover:bg-sunken/60"}`}
          >
            <span className="num w-10 shrink-0 pt-0.5 text-right text-2xs text-muted">#{m.seq}</span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-xs text-fg-2">
                <span className="font-semibold text-fg">{name}</span>
                {isPrivate && m.audience && <span className="badge bg-surface text-fg-2">{T.privateLane(m.audience.name ?? T.unknownUser)}</span>}
                {m.assisted && <span className="badge bg-accent-soft text-accent">{T.assisted}</span>}
                {m.hidden && <span className="badge bg-bad-soft text-bad">{T.hidden}</span>}
                <span className="num text-muted">{formatTime(m.createdAt)}</span>
              </p>
              <p className={`mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed ${m.hidden ? "text-muted line-through" : ""}`}>{m.text}</p>
            </div>
            {canModerate && !m.hidden && !isPrivate && (
              <button type="button" className="btn-quiet btn-sm shrink-0" onClick={() => onHide(m)}>
                {T.hide}
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
