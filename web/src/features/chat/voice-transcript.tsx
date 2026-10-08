import { useMemo } from "react";
import type { AssessmentWordBrief } from "~/features/practice";
import { markTranscript } from "./voice-words";

/** 转写文字永远直接渲染,不依赖音频;有逐词评测时把读差的词标出来。 */
export function VoiceTranscript({ text, words }: { text: string; words?: AssessmentWordBrief[] }) {
  const pieces = useMemo(() => markTranscript(text, words), [text, words]);
  return (
    <p className="whitespace-pre-wrap break-words">
      {pieces.map((piece, i) => piece.poor
        ? <mark key={i} data-testid="voice-word-poor" className="rounded-[4px] bg-amber-tint px-[3px] text-amber">{piece.text}</mark>
        : <span key={i}>{piece.text}</span>)}
    </p>
  );
}
