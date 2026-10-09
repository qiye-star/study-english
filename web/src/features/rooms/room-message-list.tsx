import { FlagIcon, LanguagesIcon } from "lucide-react";
import { memo, useMemo, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Avatar } from "~/components/avatar";
import { cn } from "~/lib/cn";
import type { RoomMessage } from "./protocol";
import type { RoomState } from "./room-state";

const AT_AI = /^(\s*@(?:ai|助手))(?=$|[\s:：,，])/i;

/** 成员消息正文:开头的 @ai / @助手 用钴蓝半粗标出(视觉稿 M2 的 .at)。 */
function MessageText({ text }: { text: string }) {
  const m = AT_AI.exec(text);
  if (!m) return <span className="whitespace-pre-wrap break-words">{text}</span>;
  return (
    <span className="whitespace-pre-wrap break-words">
      <span className="font-semibold text-blue">{m[1].trim()}</span>{text.slice(m[1].length)}
    </span>
  );
}

/** AI 回答:英文在前;以「中文:」开头的行作为 13px 次要色的中文说明。 */
function AiAnswer({ text }: { text: string }) {
  const lines = text.split("\n");
  const zhAt = lines.findIndex((l) => /^\s*中文[:：]/.test(l));
  const en = (zhAt < 0 ? lines : lines.slice(0, zhAt)).join("\n").trim();
  const zh = zhAt < 0 ? "" : lines.slice(zhAt).join("\n").trim();
  return (
    <>
      {en && <p className="mt-1.5 whitespace-pre-wrap break-words text-body leading-dialogue">{en}</p>}
      {zh && <p className="mt-1 whitespace-pre-wrap break-words text-sub leading-dialogue text-ink-2">{zh}</p>}
    </>
  );
}

/**
 * 公共消息列表(视觉稿 M2):别人 = 中性气泡 + 名字;自己 = blue-tint;@ai 回答 = 中性卡片(AI 助手 + 引用提问);系统 = 居中 11px。
 * 点别人的消息展开「举报」(44px)。系统消息按 i18n 模板渲染(服务端只存 key + 参数)。
 */
export const RoomMessageList = memo(function RoomMessageList({ state, reported, onLoadEarlier, onReport }: {
  state: RoomState; reported: ReadonlySet<string>; onLoadEarlier(): void; onReport(message: RoomMessage): void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const meId = state.me?.userId;
  const bySeq = useMemo(() => new Map(state.messages.map((m) => [m.seq, m])), [state.messages]);

  const reportRow = (m: RoomMessage, align: "start" | "end") => selected === m.id && (
    <div className={cn("mt-0.5 flex", align === "end" ? "justify-end" : "justify-start")}>
      {reported.has(m.id) ? (
        <span className="inline-flex h-tap items-center px-2 text-meta font-medium text-ink-2">{t("web.rooms.room.reported")}</span>
      ) : (
        <button type="button" data-testid="room-report" onClick={() => onReport(m)}
          className="inline-flex h-tap items-center gap-1 rounded-[9px] px-2 text-meta font-medium text-ink-2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-[15px]">
          <FlagIcon aria-hidden />{t("web.rooms.room.report")}
        </button>
      )}
    </div>
  );
  const toggle = (m: RoomMessage) => setSelected((cur) => (cur === m.id ? null : m.id));

  const render = (m: RoomMessage) => {
    if (m.kind === "system") {
      return (
        <p key={m.id} data-testid="room-message" data-kind="system" className="text-center text-label font-medium tracking-[0.02em] text-ink-2">
          {t(`web.rooms.room.system.${m.text}`, { ...((m.meta ?? {}) as Record<string, string>), defaultValue: "" })}
        </p>
      );
    }
    if (m.kind === "ai_answer") {
      const question = m.replyTo !== null ? bySeq.get(m.replyTo) : undefined;
      return (
        <div key={m.id} className="max-w-[92%] self-start">
          <div data-testid="room-message" data-kind="ai_answer" role="button" tabIndex={0} aria-expanded={selected === m.id}
            onClick={() => toggle(m)} onKeyDown={(e) => { if (e.key === "Enter") toggle(m); }}
            className="rounded-card border-[0.5px] border-hair bg-surface px-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="block text-label font-semibold uppercase tracking-eyebrow text-ink-2">{t("web.rooms.room.aiName")}</span>
            {question && (
              <p className="mt-1.5 line-clamp-2 border-l-2 border-hair pl-2 text-meta text-ink-2">{question.sender.name}: {question.text}</p>
            )}
            <AiAnswer text={m.text} />
          </div>
          {reportRow(m, "start")}
        </div>
      );
    }
    const mine = meId !== undefined && m.sender.id === meId;
    const name = m.sender.name ?? "?";
    return (
      <div key={m.id} className={cn("flex max-w-[88%] flex-col", mine ? "self-end" : "self-start")}>
        <div className={cn("flex gap-2", mine && "flex-row-reverse")}>
          {!mine && <Avatar name={name} size="sm" className="mt-0.5" />}
          <div data-testid="room-message" data-kind="text" data-mine={mine ? "true" : "false"}
            {...(mine ? {} : { role: "button", tabIndex: 0, "aria-expanded": selected === m.id,
              onClick: () => toggle(m), onKeyDown: (e: KeyboardEvent) => { if (e.key === "Enter") toggle(m); } })}
            className={cn("min-w-0 rounded-card px-3 py-2 text-body leading-dialogue tracking-[-0.005em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              mine ? "rounded-tr-inline bg-blue-tint" : "rounded-tl-inline border-[0.5px] border-hair bg-surface")}>
            {!mine && <span className="block text-meta font-semibold text-ink-2">{name}</span>}
            <MessageText text={m.text} />
            {m.assisted && (
              <span className="mt-0.5 flex items-center gap-[3px] text-label font-semibold text-blue">
                <LanguagesIcon aria-hidden className="size-[13px]" />{t("web.rooms.room.assisted")}
              </span>
            )}
            {m.aiStatus === "pending" && !state.aiTyping.includes(m.seq) && state.status !== "closed" && (
              <span className="mt-0.5 block text-label text-ink-2">{t("web.rooms.room.aiPending")}</span>
            )}
            {(m.aiStatus === "failed" || (m.aiStatus === "pending" && state.status === "closed")) && (
              <span className="mt-0.5 block text-label text-ink-2">{t("web.rooms.room.aiFailed")}</span>
            )}
          </div>
        </div>
        {!mine && reportRow(m, "start")}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {state.truncated && state.messages.length > 0 && (
        <button type="button" data-testid="room-load-earlier" onClick={onLoadEarlier}
          className="tap-link self-center !my-0 text-sub font-medium text-blue">{t("web.rooms.room.loadEarlier")}</button>
      )}
      {state.messages.map(render)}
      {state.pending.map((p) => (
        <div key={p.clientId} data-testid="room-pending" aria-busy="true"
          className="max-w-[88%] self-end rounded-card rounded-tr-inline bg-blue-tint px-3 py-2 text-body leading-dialogue opacity-60">
          <MessageText text={p.text} />
        </div>
      ))}
      {state.aiTyping.length > 0 && (
        <p role="status" className="self-start text-meta text-ink-2">{t("web.rooms.room.aiTyping")}</p>
      )}
    </div>
  );
});
