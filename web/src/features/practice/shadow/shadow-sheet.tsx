import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeftIcon, ChevronRightIcon, LoaderIcon, MicIcon, MicOffIcon, QuoteIcon, SparklesIcon, SquareIcon, Volume2Icon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type TouchEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { loadServerAiConfig, type ServerAiConfig } from "~/api/server-config";
import { claimAudio, releaseAudio } from "~/audio/audio-focus";
import type { RecorderEnv } from "~/audio/recorder";
import { useAuth } from "~/auth/auth-context";
import { ttsErrorMessage, useTtsPlayer } from "~/features/chat";
import { resolveTtsVoice } from "~/settings/tts-voice-pref";
import { cn } from "~/lib/cn";
import { formatClock } from "~/lib/format-clock";
import { savePracticeItem } from "../save-practice-item";
import { useShadowSession } from "../use-shadow-session";
import type { ShadowRequest } from "./shadow-context";
import "./shadow-sheet.css";
import "./shadow-locales";
import { ShadowResult } from "./shadow-result";

/** 弹窗里的录音上限(R-S12):设计稿「最长 1 分钟」;练习页仍是 5 分钟 */
export const SHEET_MAX_MS = 60_000;
const SWIPE_CLOSE_PX = 60;
const rise = (n: number) => ({ "--d": n }) as CSSProperties;

/** 模拟波形(R-S13):34 根竖条,高度与节奏由下标确定性给出;正式的音量驱动留作后续 */
const WAVE = Array.from({ length: 34 }, (_, i) => ({
  h: (0.35 + 0.6 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.45))).toFixed(2),
  dur: (0.38 + ((i * 37) % 30) / 100).toFixed(2),
  delay: -(((i * 53) % 70) / 100),
}));

function Wave({ still = false }: { still?: boolean }) {
  return (
    <div className={cn("shs-wave", still && "shs-wave--still")} aria-hidden>
      {WAVE.map((b, i) => (
        <i key={i} style={{ "--h": b.h, animationDuration: `${b.dur}s`, animationDelay: `${b.delay}s` } as CSSProperties} />
      ))}
    </div>
  );
}

/** 「我的录音」回放(R-S17):普通 <audio>,claimAudio 与 TTS 互斥;stop 是稳定的同一个函数(claimAudio / releaseAudio 按引用比较) */
function useMinePlayback() {
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const mounted = useRef(true);
  const stop = useCallback(function stopMine() {
    audio.current?.pause();
    releaseAudio(stopMine);
    if (mounted.current) setPlaying(false);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      audio.current?.pause();
      releaseAudio(stop);
    };
  }, [stop]);
  const toggle = useCallback((url: string | null) => {
    if (!url) return;
    if (playing) {
      stop();
      return;
    }
    const el = audio.current ?? new Audio();
    audio.current = el;
    el.onended = () => stop();
    el.src = url;
    claimAudio(stop);
    setPlaying(true);
    try {
      void Promise.resolve(el.play()).catch(() => stop());
    } catch {
      stop();
    }
  }, [playing, stop]);
  return { playing, toggle, stop };
}

export interface ShadowSheetProps {
  request: ShadowRequest;
  onClose(): void;
  /** 测试注入的录音环境 */
  recorderEnv?: RecorderEnv;
}

/**
 * 对话里的跟读弹窗(spec 2026-10-14-shadow-sheet;设计稿 shadow-sheet-v1/mockup-glass.html)。
 * 非模态 Radix Dialog + 自己的遮罩(R-S06):选词操作条(z-40)仍可点,查词抽屉(z-50)叠在弹窗之上。
 * 状态来自 useShadowSession(与练习页共用):待录音 / 录音中 / 评测中 / 出错(保留录音可重试)/ 结果。
 */
export function ShadowSheet({ request, onClose, recorderEnv }: ShadowSheetProps) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const navigate = useNavigate();
  const tRef = useRef(t);
  tRef.current = t;
  const items = request.items;
  const [index, setIndex] = useState(Math.min(request.index, Math.max(0, items.length - 1)));
  const text = items[index] ?? "";
  const multi = items.length > 1;
  const isLast = !multi || index >= items.length - 1;

  const [ai, setAi] = useState<ServerAiConfig | null>(null);
  const [aiFailed, setAiFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadServerAiConfig(api).then((c) => { if (alive) setAi(c); }).catch((): void => { if (alive) setAiFailed(true); });
    return () => { alive = false; };
  }, [api]);

  // 范读:点击的同步阶段先播放静音解锁 <audio>(iOS);卸载时自动中止并暂停
  const tts = useTtsPlayer(api, {
    onError: (err) => toast.error(ttsErrorMessage(tRef.current, err)),
    onNothingToRead: () => toast.error(tRef.current("web.chat.nothingToRead")),
  });
  const stopTts = tts.stop;
  const mine = useMinePlayback();
  const stopMine = mine.stop;

  const session = useShadowSession({
    reference: text,
    recorderEnv,
    maxDurationMs: SHEET_MAX_MS,
    keepAudio: true,
    silenceError: t("web.practice.shadow.noSpeech"),
    beforeRecord: () => {
      stopTts(); // 不要把扬声器的范读 / 我的录音录进麦克风(iOS 音频路由)
      stopMine();
    },
  });
  const { reset } = session;

  const [faved, setFaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [favPending, setFavPending] = useState(false);
  const favLock = useRef(false);

  // 换句(上一句 / 下一句 / 完成后的下一句):丢弃一切,范读与我的录音停下
  useEffect(() => {
    reset();
    stopTts();
    stopMine();
    setFaved(false);
  }, [text, reset, stopTts, stopMine]);
  useEffect(() => {
    if (!session.mineUrl) stopMine();
  }, [session.mineUrl, stopMine]);

  const phase = session.phase;
  const busyNav = session.recording || session.busy || session.starting;
  const selectable = !busyNav; // 录音 / 评测中暂停选词操作条(没有 data-lookup-context,readSelection 读不到)
  const listenState = tts.states.reference ?? "idle";
  const hasVoice = !!ai?.defaultTts.model;
  const canListen = !!text && hasVoice && !busyNav;
  const listen = () => {
    if (!ai || !hasVoice) return;
    const voice = resolveTtsVoice("sentence", ai);
    void tts.play("reference", text, voice.model, voice.voice); // 同步段内 prime;不要在这之前 await
  };

  const fav = async () => {
    if (favLock.current || faved) return;
    favLock.current = true;
    setFavPending(true);
    try {
      if (await savePracticeItem(api, t, text, request.source)) setFaved(true);
    } finally {
      favLock.current = false;
      setFavPending(false);
    }
  };

  const keptNotice = session.kept && (session.kept.stoppedBy === "background" || session.kept.stoppedBy === "track_ended")
    ? t(session.kept.stoppedBy === "background" ? "web.recorder.background" : "web.recorder.trackEnded", { seconds: Math.round(session.kept.durationMs / 1000) })
    : null;
  const errorText = session.error ?? keptNotice ?? "";

  // 录音 / 评测 / 申请麦克风中关闭先确认(R-S16);确认出现时再关一次(Escape / 遮罩)= 继续
  const requestClose = () => {
    if (confirming) {
      setConfirming(false);
      return;
    }
    if (busyNav) setConfirming(true);
    else onClose();
  };
  useEffect(() => {
    if (!busyNav) setConfirming(false); // 录音结束(出分 / 出错 / 取消)时问题自动消失
  }, [busyNav]);

  const touchStart = useRef<number | null>(null);
  const onTouchEnd = (e: TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (start !== null && e.changedTouches[0].clientY - start > SWIPE_CLOSE_PX) requestClose();
  };

  const onContinue = () => {
    if (isLast) onClose();
    else setIndex(index + 1);
  };
  const openDetails = (assessmentId: string) => {
    onClose(); // 先关弹窗再导航
    navigate(`/practice/assessments/${assessmentId}`);
  };

  return (
    <DialogPrimitive.Root open modal={false} onOpenChange={(next) => { if (!next) requestClose(); }}>
      <DialogPrimitive.Portal>
        <div data-testid="shadow-scrim" className="shs-root shs-scrim" aria-hidden onClick={requestClose}>
          {/* R-S22:弹窗背后的极光只存在于遮罩里(遮罩只在弹窗打开时挂载),页面平时不变 */}
          <div className="shs-aurora" aria-hidden data-testid="shadow-aurora"><i /><i /><i /></div>
        </div>
        <DialogPrimitive.Content data-testid="shadow-sheet" data-phase={phase} aria-describedby={undefined}
          className="shs-root shs-sheet"
          onInteractOutside={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}>
          <div className="shs-grab-zone" onTouchStart={(e) => { touchStart.current = e.touches[0].clientY; }} onTouchEnd={onTouchEnd}>
            <span className="shs-grab" aria-hidden />
          </div>
          <div className="shs-top">
            <DialogPrimitive.Title className="shs-title">
              {t("web.practice.shadow.title")}
              {multi && (
                <span data-testid="shadow-position" className="shs-pos shs-tint">
                  {t("web.practice.shadow.position", { n: index + 1, total: items.length })}
                </span>
              )}
            </DialogPrimitive.Title>
            <button type="button" data-testid="shadow-close" className="shs-x shs-tint" aria-label={t("web.practice.shadow.close")} onClick={requestClose}>
              <XIcon aria-hidden />
            </button>
          </div>

          <div className="shs-scroll">
            {phase === "result" && session.result ? (
              <ShadowResult
                key={session.result.assessmentId}
                reference={text}
                scores={session.result.scores}
                words={session.result.words}
                mineUrl={session.mineUrl}
                playingMine={mine.playing}
                listenState={listenState}
                canListen={hasVoice}
                faved={faved}
                favBusy={favPending}
                nextKind={isLast ? "done" : "next"}
                onToggleMine={() => mine.toggle(session.mineUrl)}
                onListen={listen}
                onFav={() => void fav()}
                onAgain={() => { reset(); stopTts(); stopMine(); setFaved(false); }}
                onContinue={onContinue}
                onDetails={() => openDetails(session.result!.assessmentId)}
              />
            ) : (
              <>
                <div className="shs-ref shs-tint shs-rise" style={rise(1)}>
                  <div className="shs-eyebrow"><QuoteIcon aria-hidden />{t("web.practice.shadow.reference")}</div>
                  <p data-testid="shadow-reference" className="shs-sel" {...(selectable ? { "data-lookup-context": true } : {})}>{text}</p>
                </div>

                {multi && (
                  <div className="shs-nav shs-rise" style={rise(2)}>
                    <button type="button" data-testid="shadow-prev" className="shs-nav-btn shs-tint" disabled={busyNav || index === 0}
                      onClick={() => setIndex(index - 1)}>
                      <ChevronLeftIcon aria-hidden />{t("web.practice.shadow.prev")}
                    </button>
                    {items.length <= 8 && (
                      <div className="shs-dots" aria-hidden>
                        {items.map((_, i) => <i key={i} className={cn("shs-dot", i === index && "shs-dot--on")} />)}
                      </div>
                    )}
                    <button type="button" data-testid="shadow-next" className="shs-nav-btn shs-tint" disabled={busyNav || index >= items.length - 1}
                      onClick={() => setIndex(index + 1)}>
                      {t("web.practice.shadow.next")}<ChevronRightIcon aria-hidden />
                    </button>
                  </div>
                )}

                {phase === "idle" && <p data-testid="shadow-hint" className="shs-hint shs-rise" style={rise(3)}>{t("web.practice.shadow.hint")}</p>}

                {phase === "recording" && (
                  <div data-testid="shadow-recording" className="shs-rec shs-tint shs-rise" style={rise(3)}>
                    <div className="shs-timer shs-timer--live">
                      <span className="shs-pulse" aria-hidden />
                      {t("web.practice.shadow.recording")}
                      <span data-testid="shadow-timer" className="shs-clock num">{formatClock(session.elapsedMs)} <small>/ {formatClock(SHEET_MAX_MS)}</small></span>
                    </div>
                    <div className="shs-prog"><b style={{ transform: `scaleX(${Math.min(1, session.elapsedMs / SHEET_MAX_MS)})` }} /></div>
                    <Wave />
                  </div>
                )}

                {phase === "assessing" && (
                  <div data-testid="shadow-assessing" className="shs-rec shs-tint shs-rise" style={rise(3)}>
                    <div className="shs-timer">
                      <SparklesIcon aria-hidden className="shs-timer-icon" />
                      <span className="shs-shiny">{t("web.practice.shadow.assessingLong")}</span>
                    </div>
                    <div className="shs-indet"><b /></div>
                    <Wave still />
                  </div>
                )}

                {phase === "error" && (
                  <div role="alert" data-testid="shadow-error" className="shs-err shs-rise" style={rise(3)}>
                    <MicOffIcon aria-hidden />
                    <div>
                      {errorText}
                      {session.kept && session.error && <div className="shs-err-sub">{t("web.practice.shadow.keptNote")}</div>}
                    </div>
                  </div>
                )}

                {phase === "error" && session.kept && !session.busy && (
                  <div data-testid="shadow-kept" className="shs-kept shs-rise" style={rise(4)}>
                    <button type="button" data-testid="shadow-assess-kept" className="shs-btn shs-btn--primary" onClick={() => void session.assessKept()}>
                      {t("web.practice.shadow.assessKept")}
                    </button>
                    <button type="button" data-testid="shadow-discard" className="shs-btn shs-btn--ghost shs-tint" onClick={session.discardKept}>
                      {t("web.practice.shadow.discard")}
                    </button>
                  </div>
                )}

                <div className="shs-btns shs-rise" style={rise(5)}>
                  <button type="button" data-testid="shadow-listen" data-state={listenState} className="shs-btn shs-btn--ghost shs-tint"
                    disabled={!canListen && listenState !== "playing"} onClick={listen}>
                    {listenState === "loading" ? <LoaderIcon aria-hidden className="shs-spin" />
                      : listenState === "playing" ? <span className="shs-eq" aria-hidden><b /><b /><b /></span> : <Volume2Icon aria-hidden />}
                    {listenState === "playing" ? t("web.practice.shadow.listening") : t("web.practice.shadow.listen")}
                  </button>
                  {session.recording ? (
                    <button type="button" data-testid="shadow-stop" className="shs-btn shs-btn--stop" onClick={() => void session.toggle()}>
                      <SquareIcon aria-hidden className="fill-current" />{t("web.practice.shadow.stop")}
                    </button>
                  ) : session.busy ? (
                    <button type="button" data-testid="shadow-busy" className="shs-btn shs-btn--primary" disabled>
                      <LoaderIcon aria-hidden className="shs-spin" />{t("web.practice.shadow.assessing")}
                    </button>
                  ) : (
                    <button type="button" data-testid="shadow-record" className="shs-btn shs-btn--primary" disabled={session.starting || !text}
                      onClick={() => void session.toggle()}>
                      <MicIcon aria-hidden />{phase === "error" ? t("web.practice.shadow.retryRecord") : t("web.practice.shadow.record")}
                    </button>
                  )}
                </div>
                {aiFailed && <p data-testid="shadow-listen-unavailable" className="shs-note">{t("web.practice.shadow.listenUnavailable")}</p>}
              </>
            )}
          </div>
          {confirming && (
            <div data-testid="shadow-confirm" className="shs-confirm" role="alertdialog" aria-labelledby="shs-confirm-title" aria-describedby="shs-confirm-body">
              <div className="shs-confirm-card">
                <h5 id="shs-confirm-title">{t("web.practice.shadow.confirm.title")}</h5>
                <p id="shs-confirm-body">{t("web.practice.shadow.confirm.body")}</p>
                <div className="shs-btns">
                  <button type="button" data-testid="shadow-confirm-keep" className="shs-btn shs-btn--ghost shs-tint" onClick={() => setConfirming(false)}>
                    {t("web.practice.shadow.confirm.keep")}
                  </button>
                  <button type="button" data-testid="shadow-confirm-drop" className="shs-btn shs-btn--stop" onClick={onClose}>
                    {t("web.practice.shadow.confirm.drop")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
