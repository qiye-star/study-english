import { LoaderIcon, StarIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@renderer/components/ui/button";
import { SheetDescription, SheetHeader, SheetTitle } from "@renderer/components/ui/sheet";
import { Skeleton } from "@renderer/components/ui/skeleton";
import { PronunciationAssessmentFulltextResult } from "@renderer/components/pronunciation-assessments/pronunciation-assessment-fulltext-result";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent } from "~/components/bottom-sheet";
import { PRACTICE_SERVER_ERRORS, briefWords, getAssessment, type AssessmentDetail } from "~/features/practice/assessment-api";
import { MobileScoreResult } from "~/features/practice/mobile-score-result";
import { goPractice, savePracticeItem } from "~/features/practice/save-practice-item";
import type { UiMessage } from "./ui-message";
import { poorWords } from "./voice-words";

/** 点开语音/文字气泡的徽标:评测分数与弱词(列表里已有摘要则立即显示)、完整结果(打开时才请求)、语法详情(children)、"跟读这句"、收藏。 */
export function TurnDetailSheet({ message, onClose, children }: { message: UiMessage | null; onClose(): void; children?: ReactNode }) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const tRef = useRef(t);
  tRef.current = t;
  const [detail, setDetail] = useState<AssessmentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const assessmentId = message?.assessmentId ?? null;
  const content = message?.content ?? null;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setError(null);
    if (!assessmentId) return;
    getAssessment(api, assessmentId).then(
      (d) => { if (alive) setDetail(d); },
      (err) => { if (alive) setError(translateServerError(tRef.current, err, PRACTICE_SERVER_ERRORS)); },
    );
    return () => { alive = false; };
  }, [api, assessmentId]);

  const scores = detail?.scores ?? message?.assessment?.scores ?? null;
  const detailWords = detail?.result?.detailResult?.words;
  const weak = useMemo(
    () => poorWords(detailWords ? briefWords(detailWords) : message?.assessment?.words, 8),
    [detailWords, message?.assessment?.words],
  );

  const save = async () => {
    if (!content || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await savePracticeItem(api, tRef.current, content, "chat");
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  return (
    <BottomSheet open={message !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <BottomSheetContent data-testid="turn-detail" className="max-h-[85dvh] overflow-y-auto rounded-t-xl pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <SheetHeader>
          <SheetTitle className="text-left">{t("web.chat.voice.details")}</SheetTitle>
          <SheetDescription className="sr-only">{t("web.chat.voice.detailsDescription")}</SheetDescription>
        </SheetHeader>
        {message && (
          <div className="mt-3 space-y-4">
            <p data-lookup-context className="select-text break-words text-base">{message.content}</p>
            {assessmentId && (
              <section data-testid="turn-detail-assessment" className="space-y-3">
                {scores ? <MobileScoreResult scores={scores} /> : error ? null : <Skeleton className="h-32" />}
                {weak.length > 0 && (
                  <p data-testid="detail-weak-words" className="text-sm">
                    <span className="text-muted-foreground">{t("web.chat.voice.weakWords")}</span> {weak.join(", ")}
                  </p>
                )}
                {detail ? (
                  <PronunciationAssessmentFulltextResult words={detailWords ?? []} currentTime={0} src={message.voice?.audioUrl} />
                ) : error ? (
                  <p role="alert" className="text-sm text-destructive">{error}</p>
                ) : scores ? (
                  <Skeleton className="h-16" />
                ) : null}
              </section>
            )}
            {children}
            <div className="flex gap-2">
              <Button data-testid="detail-practice" className="h-11 flex-1" onClick={() => { onClose(); goPractice(navigate, message.content); }}>
                {t("web.chat.voice.practiceThis")}
              </Button>
              <Button variant="outline" data-testid="detail-save" className="h-11 min-w-11" disabled={saving}
                aria-label={t("web.chat.voice.save")} onClick={() => void save()}>
                {saving ? <LoaderIcon className="h-5 w-5 animate-spin" /> : <StarIcon className="h-5 w-5" />}
              </Button>
            </div>
          </div>
        )}
      </BottomSheetContent>
    </BottomSheet>
  );
}
