import { RotateCcwIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@renderer/components/ui/alert-dialog";
import { Button } from "@renderer/components/ui/button";
import { Skeleton } from "@renderer/components/ui/skeleton";
import { PronunciationAssessmentFulltextResult } from "@renderer/components/pronunciation-assessments/pronunciation-assessment-fulltext-result";
import { WavesurferPlayer } from "@renderer/components/misc/wavesurfer-player";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { PageHeader } from "~/layout/page-header";
import { PRACTICE_SERVER_ERRORS, deleteAssessment, getAssessment, getAssessmentAudio, type AssessmentDetail } from "./assessment-api";
import { MobileScoreResult } from "./mobile-score-result";

export function AssessmentPage() {
  const { id = "" } = useParams();
  const { api } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<AssessmentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    setDetail(null);
    setError(null);
    setAudioUrl(null);
    setAudioError(false);
    setCurrentTime(0);
    setConfirming(false);
    getAssessment(api, id)
      .then((d) => alive && setDetail(d))
      .catch((err) => alive && setError(translateServerError(tRef.current, err, PRACTICE_SERVER_ERRORS)));
    getAssessmentAudio(api, id)
      .then((blob) => {
        if (!alive) return;
        url = URL.createObjectURL(blob);
        setAudioUrl(url);
      })
      .catch(() => alive && setAudioError(true));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [api, id]);

  const remove = async () => {
    try {
      await deleteAssessment(api, id);
      navigate("/practice/history", { replace: true });
    } catch (err) {
      setError(translateServerError(t, err, PRACTICE_SERVER_ERRORS));
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader title={t("web.practice.result.title")} back="/practice/history"
        actions={detail && (
          <Button variant="ghost" size="icon" className="h-11 w-11" data-testid="assessment-delete"
            aria-label={t("web.common.delete")} onClick={() => setConfirming(true)}>
            <Trash2Icon className="h-5 w-5" />
          </Button>
        )} />
      {error && <p role="alert" className="p-4 text-sm text-destructive">{error}</p>}
      {!detail && !error && <Skeleton className="m-4 h-40" />}
      {detail && (
        <div className="space-y-4 p-4">
          <p data-testid="assessment-reference" data-lookup-context className="select-text text-base leading-relaxed">
            {detail.referenceText}
          </p>
          <MobileScoreResult scores={detail.scores} />
          <div data-testid="assessment-audio">
            {audioUrl ? (
              <WavesurferPlayer id={`assessment-${id}`} src={audioUrl} height={64} setCurrentTime={setCurrentTime} />
            ) : audioError ? (
              <p className="text-sm text-muted-foreground">{t("web.practice.result.audioUnavailable")}</p>
            ) : (
              <Skeleton className="h-16" />
            )}
          </div>
          <div data-testid="assessment-words">
            <PronunciationAssessmentFulltextResult words={detail.result?.detailResult?.words ?? []}
              currentTime={currentTime} src={audioUrl ?? undefined} />
          </div>
          <Button data-testid="assessment-again" className="h-11 w-full"
            onClick={() => navigate("/practice", { state: { reference: detail.referenceText } })}>
            <RotateCcwIcon className="mr-2 h-4 w-4" />{t("web.practice.result.again")}
          </Button>
        </div>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("web.practice.result.deleteConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>{t("web.practice.result.deleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t("web.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction data-testid="assessment-delete-confirm" className="h-11" onClick={() => void remove()}>
              {t("web.common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
