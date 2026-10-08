import { parseGrammar } from "../lib/parsers";
import { S } from "../strings";
import { CheckIcon } from "./icons";

/** 用户消息下方的语法批注,做成"旁注":左侧细线,原文划掉 → 修正,分类标签。形状认不出时回退为紧凑 JSON。 */
export function GrammarNoteView({ grammar }: { grammar: Record<string, unknown> }) {
  const note = parseGrammar(grammar);
  if (!note) {
    return (
      <details className="mt-1.5 max-w-full rounded-lg bg-sunken px-3 py-1.5 text-xs text-muted">
        <summary className="flex min-h-[28px] cursor-pointer items-center">{S.chat.rawGrammar}</summary>
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono">{JSON.stringify(grammar)}</pre>
      </details>
    );
  }
  if (!note.hasErrors || note.errors.length === 0) {
    return (
      <span className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-good">
        <CheckIcon width={14} height={14} />
        {S.chat.grammarOk}
      </span>
    );
  }
  return (
    <div data-testid="grammar-note" className="mt-2 w-full border-l-2 border-warn/70 pl-3 text-left text-sm">
      <ul className="space-y-2">
        {note.errors.map((e, i) => (
          <li key={i} className="space-y-0.5">
            <p className="break-words leading-snug">
              <span className="text-bad line-through decoration-bad/50 decoration-[1.5px]">{e.original}</span>
              <span className="mx-1.5 text-muted">→</span>
              <span className="font-medium text-good">{e.corrected || "∅"}</span>
              <span className="chip ml-2 bg-sunken align-middle text-muted">{S.grammarCategories[e.category] ?? S.grammarCategories.other}</span>
            </p>
            {e.explanation && <p className="text-xs leading-snug text-muted">{e.explanation}</p>}
          </li>
        ))}
      </ul>
      {note.corrected && (
        <p className="mt-2 text-sm leading-snug text-fg-2">
          <span className="eyebrow mr-1.5 normal-case tracking-normal">{S.chat.corrected}</span>
          {note.corrected}
        </p>
      )}
    </div>
  );
}
