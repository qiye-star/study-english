import { Link, useParams } from "react-router-dom";
import { getAssessment } from "../api/endpoints";
import { AudioPlayer } from "../components/audio-player";
import { ChevronDownIcon } from "../components/icons";
import { Screen, SectionTitle, TopBar } from "../components/layout";
import { ScoreHero, ScoreMeter } from "../components/score";
import { ErrorState, Skeleton } from "../components/states";
import { useAsync } from "../hooks/use-async";
import { formatBytes, formatDateTime, formatDuration, scoreTone, TONE_BAR, TONE_SOFT, TONE_TEXT } from "../lib/format";
import { parseWords, type WordScore } from "../lib/parsers";
import { S } from "../strings";

/** 逐词热力条:每个词一段,颜色按分数档位;一眼看出哪里掉了分 */
function HeatStrip({ words }: { words: WordScore[] }) {
  return (
    <div className="flex h-2.5 w-full gap-px overflow-hidden rounded-full" role="img" aria-label={S.assessments.heatStrip}>
      {words.map((w, i) => (
        <span key={i} className={`h-full min-w-[2px] flex-1 ${TONE_BAR[scoreTone(w.score)]} ${scoreTone(w.score) === "none" ? "opacity-40" : ""}`} title={`${w.word} ${w.score === null ? "—" : Math.round(w.score)}`} />
      ))}
    </div>
  );
}

function Word({ w }: { w: WordScore }) {
  const tone = scoreTone(w.score);
  const flagged = w.errorType !== "None";
  return (
    <span className={`inline-flex min-h-[40px] flex-col items-center justify-center rounded-lg px-2.5 py-1 leading-tight ${TONE_SOFT[tone]} ${flagged ? "ring-1 ring-inset ring-current/30" : ""}`}>
      <span className={`text-base font-medium ${w.errorType === "Omission" ? "line-through decoration-[1.5px]" : ""}`}>{w.word}</span>
      <span className="num text-2xs opacity-80">{w.score === null ? "—" : Math.round(w.score)}</span>
    </span>
  );
}

function Words({ words }: { words: WordScore[] }) {
  const problems = words.filter((w) => w.errorType !== "None" || (w.score !== null && w.score < 60));
  return (
    <section className="space-y-3" aria-label={S.assessments.words}>
      <SectionTitle aside={S.assessments.wordCount(words.length)}>{S.assessments.words}</SectionTitle>
      <div className="panel space-y-3 p-4">
        <HeatStrip words={words} />
        <div className="flex flex-wrap gap-1.5">
          {words.map((w, i) => (
            <Word key={i} w={w} />
          ))}
        </div>
        <p className="text-xs leading-snug text-muted">{S.assessments.wordsHint}</p>
      </div>

      <SectionTitle aside={problems.length ? problems.length : undefined}>{S.assessments.problems}</SectionTitle>
      {problems.length === 0 ? (
        <p className="px-0.5 text-sm text-good">{S.assessments.noProblems}</p>
      ) : (
        <ul className="panel divide-rows">
          {problems.map((w, i) => (
            <li key={i} className="row flex-col items-stretch gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-base font-medium">{w.word}</span>
                <span className={`num text-sm ${TONE_TEXT[scoreTone(w.score)]}`}>
                  {S.assessments.errorTypes[w.errorType] || ""} {w.score === null ? "" : Math.round(w.score)}
                </span>
              </div>
              {w.phonemes.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {w.phonemes.map((p, j) => (
                    <span key={j} className={`chip num ${TONE_SOFT[scoreTone(p.score)]}`}>
                      /{p.phoneme}/ {p.score === null ? "" : Math.round(p.score)}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-right">{children}</dd>
    </div>
  );
}

export function AssessmentDetailPage() {
  const { id = "" } = useParams();
  const { data: a, error, reload } = useAsync(() => getAssessment(id), [id]);
  const words = a ? parseWords(a.result) : null;

  return (
    <>
      <TopBar title={S.assessments.detail} eyebrow={a ? `${S.assessments.source[a.source] ?? a.source} · ${formatDateTime(a.created_at)}` : undefined} back="/assessments" />
      <Screen className="space-y-5">
        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !a ? (
          <Skeleton rows={3} variant="blocks" />
        ) : (
          <>
            {/* 主角:录音 */}
            <section className="fade-in space-y-3" aria-label={S.assessments.audio}>
              <AudioPlayer assessmentId={a.id} seed={a.id.length * 131} />
              <blockquote className="whitespace-pre-wrap break-words px-1 text-md leading-relaxed">{a.reference_text || "—"}</blockquote>
            </section>

            <section className="panel fade-in flex items-center gap-5 p-4" aria-label={S.assessments.overall}>
              <ScoreHero score={a.scores?.pronunciation_score} label={S.assessments.scores.pronunciation_score} />
              <div className="min-w-0 flex-1 space-y-2.5">
                <ScoreMeter label={S.assessments.scores.accuracy_score} score={a.scores?.accuracy_score} />
                <ScoreMeter label={S.assessments.scores.fluency_score} score={a.scores?.fluency_score} />
                <ScoreMeter label={S.assessments.scores.completeness_score} score={a.scores?.completeness_score} />
              </div>
            </section>

            {words ? <Words words={words} /> : <p className="text-center text-sm text-muted">{S.assessments.noResult}</p>}

            <section className="space-y-3">
              <SectionTitle>{S.assessments.info}</SectionTitle>
              <dl className="panel divide-y divide-line px-4">
                {a.username && (
                  <Row label={S.assessments.user}>
                    <Link to={`/users/${encodeURIComponent(a.user_id ?? "")}`} className="font-medium text-accent">
                      @{a.username}
                    </Link>
                  </Row>
                )}
                <Row label={S.assessments.sourceLabel}>{S.assessments.source[a.source] ?? a.source}</Row>
                <Row label={S.assessments.language}>
                  <span className="num">{a.language || "—"}</span>
                </Row>
                <Row label={S.assessments.duration}>
                  <span className="num">{formatDuration(a.duration_ms)}</span>
                </Row>
                <Row label={S.assessments.size}>
                  <span className="num">{formatBytes(a.audio_bytes)}</span>
                </Row>
                <Row label={S.assessments.time}>
                  <span className="num">{formatDateTime(a.created_at)}</span>
                </Row>
              </dl>
            </section>

            {a.result && (
              <details className="panel group px-4">
                <summary className="flex min-h-[48px] cursor-pointer items-center justify-between text-sm font-medium text-fg-2">
                  {S.assessments.rawResult}
                  <ChevronDownIcon width={18} height={18} className="text-muted transition-transform group-open:rotate-180" />
                </summary>
                <pre className="mb-3 max-h-96 overflow-auto rounded-lg bg-sunken p-3 font-mono text-2xs leading-snug">{JSON.stringify(a.result, null, 2)}</pre>
              </details>
            )}
          </>
        )}
      </Screen>
    </>
  );
}
