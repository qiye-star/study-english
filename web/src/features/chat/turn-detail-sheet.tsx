import { LoaderIcon, StarIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import { Skeleton } from "@renderer/components/ui/skeleton";
import { PronunciationAssessmentFulltextResult } from "@renderer/components/pronunciation-assessments/pronunciation-assessment-fulltext-result";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { PRACTICE_SERVER_ERRORS, briefWords, getAssessment, type AssessmentDetail, MobileScoreResult, savePracticeItem, useShadowSheet } from "~/features/practice";
import type { UiMessage } from "./ui-message";
import { poorWords } from "./voice-words";
import { lookupContext } from "~/lib/lookup-context";

/** 点开语音/文字气泡的徽标:评测分数与弱词(列表里已有摘要则立即显示)、完整结果(打开时才请求)、语法详情(children)、"跟读这句"、收藏。 */
export function TurnDetailSheet({ message, onClose, children }: { message: UiMessage | null; onClose(): void; children?: ReactNode }) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const { open: openShadow } = useShadowSheet();
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

  // 加载中给结果区一个接近最终高度的下限,避免骨架 → 结果时整张抽屉高度跳动
  const loadingDetail = !error && !(scores && detail);

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
      <BottomSheetContent data-testid="turn-detail" className="max-h-[85dvh] overflow-y-auto">
        <BottomSheetHeader title={t("web.chat.voice.details")} description={t("web.chat.voice.detailsDescription")} srOnlyDescription />
        {message && (
          <div className="space-y-4 pb-1">
            <p data-lookup-context className="select-text break-words rounded-card bg-blue-tint px-3.5 py-3 text-title font-medium leading-dialogue text-ink">{message.content}</p>
            {assessmentId && (
              <section data-testid="turn-detail-assessment" className={loadingDetail ? "min-h-72 space-y-3" : "space-y-3"}>
                {scores ? <MobileScoreResult scores={scores} /> : error ? null : <Skeleton className="h-32" />}
                {weak.length > 0 && (
                  <p data-testid="detail-weak-words" className="text-sub text-ink">
                    <span className="text-ink-2">{t("web.chat.voice.weakWords")}</span> <span {...lookupContext} className="font-medium text-amber">{weak.join(", ")}</span>
                  </p>
                )}
                {detail ? (
                  <PronunciationAssessmentFulltextResult words={detailWords ?? []} currentTime={0} src={message.voice?.audioUrl} />
                ) : error ? (
                  <p role="alert" className="text-sub text-red">{error}</p>
                ) : scores ? (
                  <Skeleton className="h-16" />
                ) : null}
              </section>
            )}
            {children}
            <div className="flex gap-2">
              <Button data-testid="detail-practice" className="h-12 flex-1 rounded-button text-body font-semibold" onClick={() => { onClose(); openShadow({ text: message.content, source: "chat" }); }}>
                {t("web.chat.voice.practiceThis")}
              </Button>
              <Button variant="outline" data-testid="detail-save" className="h-12 w-12 rounded-button border-[0.5px] border-hair bg-surface p-0 text-ink" disabled={saving}
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
