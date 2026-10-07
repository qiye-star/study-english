import { BarChart3Icon, ClockIcon, HistoryIcon, ListChecksIcon, LoaderIcon, MicIcon, SquareIcon, Volume2Icon } from "lucide-react";
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
import { IconChip } from "~/components/icon-chip";
import { ListRow, SectionGroup } from "~/components/section-group";
import { SurfaceCard } from "~/components/surface-card";
import { ttsErrorMessage, useTtsPlayer } from "~/features/chat/use-tts-player";
import { PageHeader } from "~/layout/page-header";
import { PRACTICE_DRAFT_KEY as DRAFT_KEY } from "~/lib/device-data";
import { readJson, writeJson } from "~/lib/storage";
import { PRACTICE_SERVER_ERRORS, assessPronunciation } from "./assessment-api";

const isString = (v: unknown): v is string => typeof v === "string";

/** 跟读卡里的两个 48px 按钮(先听范读 / 开始录音) */
const BUTTON = cn(
  "inline-flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-button px-4 text-body font-semibold tracking-[-0.005em]",
  "transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  "disabled:pointer-events-none disabled:opacity-40 [&_svg]:h-5 [&_svg]:w-5 [&_svg]:flex-none",
);
/** 顶栏右侧 44px 图标链接,外观同 IconButton */
const ICON_LINK = cn(
  "relative inline-flex h-tap w-tap flex-none items-center justify-center rounded-button text-ink transition-colors duration-fast",
  "hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:h-[22px] [&_svg]:w-[22px]",
);

/** 顶栏副标题:今天的日期(随界面语言) */
function useToday(language: string): string {
  const [now] = useState(() => new Date());
  try {
    return now.toLocaleDateString(language, { weekday: "short", month: "long", day: "numeric" });
  } catch {
    return now.toLocaleDateString();
  }
}

export function formatClock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function PracticePage({ recorderEnv }: { recorderEnv?: RecorderEnv }) {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const today = useToday(i18n.language);
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
        subtitle={today}
        actions={
          <Link to="/practice/list" data-testid="practice-list" aria-label={t("web.practice.list.title")} className={ICON_LINK}>
            <ListChecksIcon aria-hidden />
          </Link>
        }
      />
      <div className="px-gutter pb-6">
        <SectionGroup title={t("web.practice.home.shadowing")} bare>
          <SurfaceCard className="p-3.5">
            <label htmlFor="reference" className="eyebrow">{t("web.practice.referenceLabel")}</label>
            <Textarea id="reference" data-testid="reference-input" rows={4} maxLength={2000}
              className="mt-1.5 min-h-[96px] resize-none rounded-button border-0 bg-surface-2 px-3 py-2.5 text-title font-medium leading-dialogue tracking-[-0.01em] text-ink placeholder:text-ink-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
              placeholder={t("web.practice.referencePlaceholder")} value={reference} disabled={recording || busy}
              onChange={(e) => setReference(e.target.value)} />
            {!reference.trim() && <p className="mt-2 text-meta text-ink-2">{t("web.practice.referenceHint")}</p>}
            <div data-testid="practice-status" data-state={status}>
              <div className="mt-2.5 flex items-center gap-1.5 text-meta text-ink-2">
                <ClockIcon aria-hidden className={cn("h-3.5 w-3.5", recording && "text-blue motion-safe:animate-pulse")} />
                <span data-testid="record-timer" className="num">
                  {formatClock(recorder.elapsedMs)} / {formatClock(MAX_RECORDING_MS)}
                </span>
                {busy && <span className="ml-auto text-blue">{t("web.practice.assessing")}</span>}
              </div>
              <div className="mt-3.5 flex gap-2">
                <button type="button" data-testid="practice-listen" data-state={listenState}
                  className={cn(BUTTON, "border-[0.5px] border-hair bg-surface text-ink active:bg-surface-2")}
                  disabled={!reference.trim() || !ai?.defaultTts.model || recorder.state !== "idle" || busy}
                  onClick={() => void tts.play("reference", reference, ai!.defaultTts.model, ai!.defaultTts.voice)}>
                  {listenState === "loading" ? <LoaderIcon aria-hidden className="animate-spin" />
                    : listenState === "playing" ? <SquareIcon aria-hidden /> : <Volume2Icon aria-hidden />}
                  {listenState === "playing" ? t("web.practice.stopListening") : t("web.practice.listen")}
                </button>
                <button type="button" data-testid="record-toggle" onClick={toggle} disabled={!canRecord}
                  aria-label={recording ? t("web.recorder.stop") : t("web.recorder.start")}
                  className={cn(BUTTON, "bg-blue text-on-blue active:bg-blue/90")}>
                  {busy ? <LoaderIcon aria-hidden className="animate-spin" /> : recording ? <SquareIcon aria-hidden className="fill-current" /> : <MicIcon aria-hidden />}
                  <span aria-hidden>{busy ? t("web.practice.assessing") : recording ? t("web.recorder.stop") : t("web.recorder.start")}</span>
                </button>
              </div>
              {aiFailed && <p data-testid="practice-listen-unavailable" className="mt-2 text-meta text-ink-2">{t("web.practice.listenUnavailable")}</p>}
              {kept && !busy && (
                <div className="mt-3 space-y-2 rounded-button bg-surface-2 p-3 text-sub">
                  {(kept.stoppedBy === "background" || kept.stoppedBy === "track_ended") && (
                    <p>{t(kept.stoppedBy === "background" ? "web.recorder.background" : "web.recorder.trackEnded", { seconds: Math.round(kept.durationMs / 1000) })}</p>
                  )}
                  <div className="flex gap-2">
                    <Button data-testid="practice-assess-kept" className="h-tap flex-1" onClick={() => void submit(kept)}>{t("web.practice.assessKept")}</Button>
                    <Button data-testid="practice-discard" variant="outline" className="h-tap flex-1" onClick={() => { setKept(null); setError(null); }}>{t("web.practice.discard")}</Button>
                  </div>
                </div>
              )}
              {shownError && <p role="alert" data-testid="practice-error" className="mt-3 text-sub text-destructive">{shownError}</p>}
            </div>
          </SurfaceCard>
        </SectionGroup>
        <SectionGroup title={t("web.practice.home.more")}>
          <ListRow icon={<IconChip tone="gray" icon={HistoryIcon} />} title={t("web.practice.historyTitle")} to="/practice/history" testId="practice-history" />
          <ListRow icon={<IconChip tone="gray" icon={BarChart3Icon} />} title={t("web.me.progress")} to="/progress" testId="practice-progress" />
        </SectionGroup>
      </div>
    </div>
  );
}
