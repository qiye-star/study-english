import type { MatchTurn } from "./api";
import { S } from "./strings";

function Flag({ text }: { text: string }) {
  return <span className="badge bg-warn-soft text-fg">{text}</span>;
}

/** 逐轮转写:AI 与学习者交替;学习者轮带发音/流利分与 english/echo/short 标记。转写是用户内容,只在本页显示。 */
export function MatchTurns({ turns }: { turns: MatchTurn[] }) {
  let n = 0;
  return (
    <ol className="space-y-2" aria-label={S.match.turns}>
      {turns.map((t, i) => {
        if (t.role === "ai") {
          return (
            <li key={i} className="flex gap-3 text-sm">
              <span className="w-14 shrink-0 pt-0.5 text-2xs text-fg-2">{S.match.partner}</span>
              <p className="min-w-0 flex-1 whitespace-pre-wrap break-words rounded-lg bg-sunken px-3 py-2">{t.text}</p>
            </li>
          );
        }
        n += 1;
        return (
          <li key={i} className="flex gap-3 text-sm">
            <span className="num w-14 shrink-0 pt-0.5 text-2xs text-fg-2">
              {S.match.learner} {n}
            </span>
            <div className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2">
              <p className="whitespace-pre-wrap break-words">{t.text || "—"}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-2xs text-fg-2">
                <span className="num">
                  {S.match.pron} {t.pron ?? "—"}
                </span>
                <span className="num">
                  {S.match.fluency} {t.fluency ?? "—"}
                </span>
                {t.english === false && <Flag text={S.match.notEnglish} />}
                {t.echo && <Flag text={S.match.echo} />}
                {t.short && <Flag text={S.match.short} />}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
