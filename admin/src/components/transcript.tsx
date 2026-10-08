import { Link } from "react-router-dom";
import type { ChatMessage } from "../api/types";
import { formatTime } from "../lib/format";
import { S } from "../strings";
import { AudioPlayer } from "./audio-player";
import { GrammarNoteView } from "./grammar-note";
import { ChevronIcon } from "./icons";
import { ScoreBadge } from "./score";

function seedOf(id: string): number {
  let h = 7;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h || 1;
}

/**
 * 气泡:学习者说的话用"墨色"气泡(右),助手用描边气泡(左);
 * 语法旁注与录音附在学习者气泡下方,占满同一列宽。
 */
function Bubble({ m }: { m: ChatMessage }) {
  const mine = m.role === "user";
  const assessmentId = m.assessment?.id ?? m.assessment_id;
  return (
    <li data-role={m.role} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <div className={`flex max-w-[86%] flex-col ${mine ? "items-end" : "items-start"}`}>
        <div
          className={`whitespace-pre-wrap break-words px-3.5 py-2.5 text-base leading-relaxed ${
            mine ? "rounded-2xl rounded-br-[6px] bg-fg text-bg" : "rounded-2xl rounded-bl-[6px] border border-line bg-surface text-fg"
          }`}
        >
          {m.content}
        </div>
        {mine && m.grammar && <GrammarNoteView grammar={m.grammar} />}
        {assessmentId && (
          <div className="mt-2 w-[min(22rem,78vw)] space-y-1.5">
            <AudioPlayer assessmentId={assessmentId} compact seed={seedOf(assessmentId)} />
            <div className="flex items-center justify-between gap-2 px-0.5">
              {m.assessment ? <ScoreBadge score={m.assessment.scores?.pronunciation_score} label={S.chat.score} /> : <span />}
              <Link to={`/assessments/${encodeURIComponent(assessmentId)}`} className="inline-flex min-h-[32px] items-center gap-0.5 text-xs font-medium text-accent">
                {S.chat.viewAssessment}
                <ChevronIcon width={14} height={14} />
              </Link>
            </div>
          </div>
        )}
        <span className="num mt-1 px-1 text-2xs text-muted">{formatTime(m.created_at)}</span>
      </div>
    </li>
  );
}

export function Transcript({ messages }: { messages: ChatMessage[] }) {
  return (
    <ul aria-label={S.chat.title} className="space-y-4">
      {messages.map((m) =>
        m.role === "system" ? (
          <li key={m.id} data-role="system" className="px-6 text-center">
            <span className="inline-block max-w-full break-words rounded-md bg-sunken px-2 py-1 text-xs leading-snug text-muted">{m.content}</span>
          </li>
        ) : (
          <Bubble key={m.id} m={m} />
        ),
      )}
    </ul>
  );
}
