import { useEffect, useRef, useState } from "react";
import { errorText } from "../../hooks/use-async";
import { formatDuration, formatTime } from "../../lib/format";
import { fetchRoomAudio, type AdminMessage, type AdminVoice } from "./api";
import { S } from "./strings";

const T = S.timeline;
const V = S.voice;

/** 同一时间只播一条:开始播放时先停下正在播的那一条(review m13) */
let stopCurrent: (() => void) | null = null;

/** 「播放」:带会话 Cookie 取音频(服务端每次写审计 `room.audio.play`),用 blob URL 播放,结束后释放。 */
function PlayButton({ roomId, messageId }: { roomId: string; messageId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<{ el: HTMLAudioElement; url: string } | null>(null);

  const release = () => {
    const cur = audio.current;
    audio.current = null;
    if (stopCurrent === stop) stopCurrent = null;
    if (!cur) return;
    cur.el.onended = null;
    cur.el.onerror = null;
    cur.el.pause();
    URL.revokeObjectURL(cur.url);
  };
  /** 被别的播放键打断:回到「播放」 */
  const stop = () => {
    release();
    setState("idle");
  };
  useEffect(() => release, []);

  const toggle = async () => {
    if (state === "playing") {
      release();
      setState("idle");
      return;
    }
    setError(null);
    setState("loading");
    try {
      const blob = await fetchRoomAudio(roomId, messageId);
      release();
      if (stopCurrent) stopCurrent();
      const url = URL.createObjectURL(blob);
      const el = new Audio(url);
      audio.current = { el, url };
      stopCurrent = stop;
      el.onended = () => stop();
      // 解码失败(文件损坏、刚被清理)在 play() 之后才报:不留在「停止」
      el.onerror = () => {
        stop();
        setError(V.playFailed);
      };
      await el.play();
      if (audio.current?.el === el) setState("playing");
    } catch (e) {
      release();
      setState("idle");
      setError(e instanceof Error && e.name === "NotAllowedError" ? V.playFailed : errorText(e));
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="btn-ghost btn-sm" disabled={state === "loading"} onClick={() => void toggle()}>
        {state === "loading" ? V.loading : state === "playing" ? V.stop : V.play}
      </button>
      {error && (
        <span role="alert" className="text-2xs text-bad">
          {error}
        </span>
      )}
    </span>
  );
}

function VoiceBody({ m, voice, roomId, canPlay }: { m: AdminMessage; voice: AdminVoice; roomId: string; canPlay: boolean }) {
  const transcript = voice.transcript ?? (voice.status === "done" ? m.text : null);
  return (
    <div className={`mt-1 space-y-1 ${m.hidden ? "text-muted" : ""}`}>
      <p className="flex flex-wrap items-center gap-2 text-xs">
        <span className="badge bg-accent-soft text-accent">{V.badge}</span>
        <span className="num text-fg-2">{formatDuration(voice.durationMs)}</span>
        <span className={`badge ${voice.status === "failed" ? "bg-bad-soft text-bad" : "bg-sunken text-fg-2"}`}>{V.status[voice.status] ?? voice.status}</span>
        {voice.audio ? canPlay && <PlayButton roomId={roomId} messageId={m.id} /> : <span className="text-muted">{V.purged}</span>}
      </p>
      {transcript && <p className={`whitespace-pre-wrap break-words text-sm leading-relaxed ${m.hidden ? "line-through" : ""}`}>{transcript}</p>}
      {voice.translation && (
        <p className="whitespace-pre-wrap break-words text-xs text-fg-2">
          <span className="mr-1 text-muted">{V.translation}</span>
          {voice.translation}
        </p>
      )}
    </div>
  );
}

function systemText(m: AdminMessage): string {
  const meta = (m.meta ?? {}) as Record<string, string>;
  return T.system[m.text]?.(meta) ?? m.text;
}

/**
 * 管理端消息时间线:公共通道默认;打开「显示私聊」后助手私聊以缩进的浅底块出现。系统消息居中小字;
 * 已隐藏的消息保留原文(删除线)并带「已隐藏」徽标。每条成员/AI 消息可「隐藏」(operator)。
 * 语音消息显示时长、转写状态、转写与译文;operator 可「播放」(审计),音频被清理后显示「音频已清理」。
 */
export function RoomTimeline({
  roomId,
  messages,
  canModerate,
  onHide,
  hasEarlier,
  onLoadEarlier,
}: {
  roomId: string;
  messages: AdminMessage[];
  /** operator 及以上:隐藏消息、播放语音 */
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
              {m.voice ? (
                <VoiceBody m={m} voice={m.voice} roomId={roomId} canPlay={canModerate} />
              ) : (
                <p className={`mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed ${m.hidden ? "text-muted line-through" : ""}`}>{m.text}</p>
              )}
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
