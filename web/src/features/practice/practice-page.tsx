import { HistoryIcon, ListChecksIcon, LoaderIcon, MicIcon, SquareIcon, Volume2Icon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@renderer/components/ui/button";
import { Textarea } from "@renderer/components/ui/textarea";
import { cn } from "@renderer/lib/utils";
import { ApiError } from "~/api/client";
import { loadServerAiConfig, type ServerAiConfig } from "~/api/server-config";
import { MAX_RECORDING_MS, toAssessmentWav } from "~/audio/convert";
import { describeAudioError } from "~/audio/describe-error";
import type { RecorderEnv, RecordingResult } from "~/audio/recorder";
import { useRecorder } from "~/audio/use-recorder";
import { useAuth } from "~/auth/auth-context";
import { ttsErrorMessage, useTtsPlayer } from "~/features/chat/use-tts-player";
import { PageHeader } from "~/layout/page-header";
import { PRACTICE_DRAFT_KEY as DRAFT_KEY } from "~/lib/device-data";
import { readJson, writeJson } from "~/lib/storage";
import { PRACTICE_SERVER_ERRORS, assessPronunciation } from "./assessment-api";

const isString = (v: unknown): v is string => typeof v === "string";

export function formatClock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function PracticePage({ recorderEnv }: { recorderEnv?: RecorderEnv }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [reference, setReference] = useState(
    () => (location.state as { reference?: string } | null)?.reference ?? readJson(DRAFT_KEY, isString) ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [kept, setKept] = useState<RecordingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const submitting = useRef(false);
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      inflight.current?.abort(); // 卸载时中止进行中的上传
    };
  }, []);

  const tRef = useRef(t);
  tRef.current = t;
  const [ai, setAi] = useState<ServerAiConfig | null>(null);
  const [aiFailed, setAiFailed] = useState(false);
  const referenceRef = useRef(reference);
  referenceRef.current = reference;
  const [failedFor, setFailedFor] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadServerAiConfig(api).then((c) => { if (alive) setAi(c); }).catch((): void => { if (alive) setAiFailed(true); });
    return () => { alive = false; };
  }, [api]);
  // 复用对话页的朗读播放器:点击的同步阶段先播放静音解锁 <audio>(iOS),卸载时自动中止并暂停
  const tts = useTtsPlayer(api, {
    onError: (err) => {
      setFailedFor(referenceRef.current);
      toast.error(ttsErrorMessage(tRef.current, err));
    },
    onNothingToRead: () => toast.error(tRef.current("web.chat.nothingToRead")),
  });
  const rawListenState = tts.states.reference ?? "idle";
  // 参考文本变化后,上一次失败的错误外观不再适用
  const listenState = rawListenState === "error" && failedFor !== reference ? "idle" : rawListenState;
  const stopTts = tts.stop;
  // 参考文本变化后,范读内容已过时,停止播放
  useEffect(() => {
    stopTts();
  }, [reference, stopTts]);

  useEffect(() => {
    writeJson(DRAFT_KEY, reference);
  }, [reference]);

  const submit = useCallback(
    async (recording: RecordingResult) => {
      if (submitting.current) return; // 防止重复提交
      submitting.current = true;
      setKept(recording); // 上传成功前一直保留录音,失败后可重试
      setBusy(true);
      setError(null);
      const controller = new AbortController();
      inflight.current = controller;
      try {
        const { wav } = await toAssessmentWav(recording.blob);
        const res = await assessPronunciation(api, { wav, reference: reference.trim(), language: "en-US", save: true, signal: controller.signal });
        if (!mounted.current) return;
        if (!res.assessmentId) throw new ApiError(500, "Could not save the recording");
        setKept(null);
        navigate(`/practice/assessments/${res.assessmentId}`);
      } catch (err) {
        // 非 JSON 的 2xx 等未知错误由 translateServerError 落到通用文案
        if (mounted.current) setError(describeAudioError(t, err, PRACTICE_SERVER_ERRORS));
      } finally {
        submitting.current = false;
        if (inflight.current === controller) inflight.current = null;
        if (mounted.current) setBusy(false);
      }
    },
    [api, navigate, reference, t],
  );

  const recorder = useRecorder({
    env: recorderEnv,
    onAutoStop: (result) => (result.stoppedBy === "max_duration" ? void submit(result) : setKept(result)),
  });

  const toggle = async () => {
    if (recorder.state === "recording") {
      const result = await recorder.stop();
      if (result) await submit(result);
      return;
    }
    if (recorder.state !== "idle") return; // "starting" 时 stop() 无效,不允许操作
    setError(null);
    setKept(null);
    tts.stop(); // 不要把扬声器的范读录进麦克风
    await recorder.start();
  };

  const recording = recorder.state === "recording";
  const shownError = error ?? (recorder.error ? describeAudioError(t, recorder.error) : null);
  const status = busy ? "processing" : recording ? "recording" : shownError ? "error" : kept ? "kept" : "idle";
  // 停止按钮只在状态确为 "recording" 时可用;"starting" 期间整体禁用
  const canRecord = recording || (reference.trim().length > 0 && !busy && recorder.state === "idle");

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        title={t("web.practice.title")}
        actions={
          <div className="flex">
            <Button asChild variant="ghost" className="h-11" data-testid="practice-list">
              <Link to="/practice/list"><ListChecksIcon className="mr-1 h-4 w-4" />{t("web.practice.list.entry")}</Link>
            </Button>
            <Button asChild variant="ghost" className="h-11" data-testid="practice-history">
              <Link to="/practice/history"><HistoryIcon className="mr-1 h-4 w-4" />{t("web.practice.history")}</Link>
            </Button>
          </div>
        }
      />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <label htmlFor="reference" className="text-sm text-muted-foreground">{t("web.practice.referenceLabel")}</label>
        <Textarea id="reference" data-testid="reference-input" rows={5} maxLength={2000} className="text-base"
          placeholder={t("web.practice.referencePlaceholder")} value={reference} disabled={recording || busy}
          onChange={(e) => setReference(e.target.value)} />
        {!reference.trim() && <p className="text-xs text-muted-foreground">{t("web.practice.referenceHint")}</p>}
        <Button type="button" variant="outline" data-testid="practice-listen" data-state={listenState} className="h-11 self-start"
          disabled={!reference.trim() || !ai?.defaultTts.model || recorder.state !== "idle" || busy}
          onClick={() => void tts.play("reference", reference, ai!.defaultTts.model, ai!.defaultTts.voice)}>
          {listenState === "loading" ? <LoaderIcon className="mr-2 h-4 w-4 animate-spin" />
            : listenState === "playing" ? <SquareIcon className="mr-2 h-4 w-4" /> : <Volume2Icon className="mr-2 h-4 w-4" />}
          {listenState === "playing" ? t("web.practice.stopListening") : t("web.practice.listen")}
        </Button>
        {aiFailed && <p data-testid="practice-listen-unavailable" className="text-xs text-muted-foreground">{t("web.practice.listenUnavailable")}</p>}
        <div data-testid="practice-status" data-state={status} className="mt-auto flex flex-col items-center gap-3 pb-4">
          <span data-testid="record-timer" className="font-mono text-sm tabular-nums">
            {formatClock(recorder.elapsedMs)} / {formatClock(MAX_RECORDING_MS)}
          </span>
          <button type="button" data-testid="record-toggle" onClick={toggle} disabled={!canRecord}
            aria-label={recording ? t("web.recorder.stop") : t("web.recorder.start")}
            className={cn(
              "flex h-20 w-20 items-center justify-center rounded-full shadow-lg transition disabled:opacity-40",
              recording ? "animate-pulse bg-red-600 text-white" : "bg-primary text-primary-foreground",
            )}>
            {busy ? <LoaderIcon className="h-8 w-8 animate-spin" /> : recording ? <SquareIcon className="h-8 w-8" /> : <MicIcon className="h-8 w-8" />}
          </button>
          {busy && <p className="text-sm text-muted-foreground">{t("web.practice.assessing")}</p>}
          {kept && !busy && (
            <div className="w-full space-y-2 rounded-md border p-3 text-sm">
              {(kept.stoppedBy === "background" || kept.stoppedBy === "track_ended") && (
                <p>{t(kept.stoppedBy === "background" ? "web.recorder.background" : "web.recorder.trackEnded", { seconds: Math.round(kept.durationMs / 1000) })}</p>
              )}
              <div className="flex gap-2">
                <Button data-testid="practice-assess-kept" className="h-11 flex-1" onClick={() => void submit(kept)}>{t("web.practice.assessKept")}</Button>
                <Button data-testid="practice-discard" variant="outline" className="h-11 flex-1" onClick={() => { setKept(null); setError(null); }}>{t("web.practice.discard")}</Button>
              </div>
            </div>
          )}
          {shownError && <p role="alert" data-testid="practice-error" className="text-center text-sm text-destructive">{shownError}</p>}
        </div>
      </div>
    </div>
  );
}
