import {
  ChevronLeftIcon, EyeIcon, EyeOffIcon, LanguagesIcon, MusicIcon, PauseIcon, PlayIcon, Repeat1Icon, RepeatIcon, SkipBackIcon, SkipForwardIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useParams } from "react-router-dom";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { PageHeader } from "~/layout/page-header";
import { nativeLanguageCode, useSettings } from "~/settings/settings-context";
import { useLibraryConfig } from "./config";
import { ElasticSlider } from "./fx/elastic-slider";
import { GlassSurface } from "./fx/glass-surface";
import { GradualBlur } from "./fx/gradual-blur";
import { LIBRARY_SERVER_ERRORS, getItem, patchItem, type LibraryItemDetail, type LibrarySegment, type TranslatedSegment } from "./library-api";
import { LibraryRoot } from "./library-root";
import "./locales";
import { PageError, PageLoading } from "./page-status";
import { useResume } from "./resume";
import { SegmentList } from "./segment-list";
import { mergeTranslations } from "./translation-state";
import { RATES, nextLoop, pctFromRate, rateFromPct, useMediaPlayer, type Rate } from "./use-media-player";
import { useMediaSource } from "./use-media-source";
import { usePosterUrl } from "./use-poster";
import { useTranslateToggle } from "./use-translate-toggle";
import { useTranslations } from "./use-translations";

/** `/library/:id`(spec §11.4):开关未到转圈,关闭回练习页(R-L6)。 */
export function LibraryPlayerPage() {
  const { id = "" } = useParams<{ id: string }>();
  const config = useLibraryConfig();
  if (config === null) return <PageLoading />;
  if (!config.enabled) return <Navigate to="/practice" replace />;
  return <PlayerScreen key={id} id={id} ai={config.ai} />;
}

function PlayerScreen({ id, ai }: { id: string; ai: boolean }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [detail, setDetail] = useState<LibraryItemDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    setError(null);
    getItem(api, id).then(setDetail, setError);
  }, [api, id]);
  useEffect(load, [load]);

  if (error) {
    return (
      <LibraryRoot>
        <PageHeader title={t("web.library.title")} back="/library" />
        <PageError message={translateServerError(t, error, LIBRARY_SERVER_ERRORS)} onRetry={load} />
      </LibraryRoot>
    );
  }
  if (!detail) return <PageLoading />;
  if (detail.status !== "ready") {
    // 处理中的条目只显示进度说明;失败的不进播放器(spec §11.4)
    const failed = detail.status === "failed" || detail.status === "canceled";
    return (
      <LibraryRoot>
        <PageHeader title={detail.title} back="/library" />
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center text-sub text-ink-2">
          <p data-testid="library-not-ready">{t(failed ? "web.library.player.failed" : "web.library.player.notReady")}</p>
          <Link to="/library"
            className="inline-flex min-h-tap items-center rounded-button px-4 font-semibold text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("web.library.player.back")}
          </Link>
        </div>
      </LibraryRoot>
    );
  }
  return <Player detail={detail} ai={ai} />;
}

function Player({ detail, ai }: { detail: LibraryItemDetail; ai: boolean }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const { language } = useSettings();
  const native = nativeLanguageCode(language);
  const canTranslate = ai && native !== "en-US"; // R-L32:英文界面没有可译的目标语言(同 chat 的 R16)
  const [segments, setSegments] = useState<LibrarySegment[]>(detail.segments);
  const [media, setMedia] = useState<HTMLMediaElement | null>(null);
  const { controller, state } = useMediaPlayer(media, segments, { rate: rateFromPct(detail.ratePct), index: detail.resumeIdx });
  const source = useMediaSource(detail.id, true, media);
  const poster = usePosterUrl(detail.id, detail.kind === "video");
  useResume(detail.id, controller, { initial: { resumeMs: detail.resumeMs, resumeIdx: detail.resumeIdx } });
  const [blind, setBlind] = useState(false);
  const [translateOn, setTranslateOn] = useTranslateToggle(detail.id);
  const showTranslation = canTranslate && translateOn;
  const [rateOpen, setRateOpen] = useState(false);
  const speedRef = useRef<HTMLDivElement>(null);
  const rateButton = useRef<HTMLButtonElement>(null);

  // 续播:元数据就绪后跳到上次的位置,只做一次(R-L14)
  const restored = useRef(false);
  useEffect(() => {
    if (!controller || !media || restored.current) return;
    const go = () => {
      if (restored.current) return;
      restored.current = true;
      controller.restore(detail.resumeMs, detail.resumeIdx);
    };
    if (media.readyState >= 1) {
      go();
      return;
    }
    media.addEventListener("loadedmetadata", go, { once: true });
    return () => media.removeEventListener("loadedmetadata", go);
  }, [controller, media, detail.resumeMs, detail.resumeIdx]);

  // 速度弹出层:Esc 或点别处关闭
  useEffect(() => {
    if (!rateOpen) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (speedRef.current?.contains(target) || rateButton.current?.contains(target)) return;
      setRateOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRateOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [rateOpen]);

  const rate = state?.rate ?? rateFromPct(detail.ratePct);
  const loop = state?.loop ?? "off";
  const playing = state?.playing ?? false;
  const current = state?.index ?? detail.resumeIdx;
  const changeRate = (next: Rate) => {
    if (!controller || next === rate) return;
    controller.setRate(next);
    void patchItem(api, detail.id, { ratePct: pctFromRate(next) }).catch(() => {});
  };
  const onSegmentSaved = useCallback((next: LibrarySegment) => {
    setSegments((list) => list.map((s) => (s.idx === next.idx ? next : s)));
  }, []);
  const onTranslated = useCallback((items: TranslatedSegment[]) => {
    setSegments((list) => mergeTranslations(list, items, native));
  }, [native]);
  const translations = useTranslations({ itemId: detail.id, enabled: showTranslation, segments, anchorIdx: current, native, onTranslated });
  const mediaProps = { ref: setMedia, src: source.url ?? undefined, preload: "metadata" as const, "data-testid": "library-media" };

  return (
    <LibraryRoot className="lib-player">
      <div className="lib-stage">
        {detail.kind === "video" ? (
          <video {...mediaProps} poster={poster ?? undefined} playsInline className="aspect-video w-full bg-black" />
        ) : (
          <div className="lib-stage-audio">
            <MusicIcon aria-hidden className="h-8 w-8" />
            <span className="text-sub">{t("web.library.player.audio")}</span>
            <audio {...mediaProps} />
          </div>
        )}
        {/* 压在视频上的顶栏胶囊:半透明 + 高光边,不模糊(R-L26) */}
        <div className="lib-bar">
          <Link to="/library" aria-label={t("web.common.back")} className="lib-bar-btn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronLeftIcon aria-hidden />
          </Link>
          <h1 className="lib-bar-title">{detail.title}</h1>
        </div>
        {source.error ? (
          <div role="alert" className="lib-stage-alert">
            <span>{t("web.library.player.mediaError")}</span>
            <button type="button" onClick={source.retry}
              className="min-h-tap rounded-button px-3 font-semibold text-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("web.common.retry")}
            </button>
          </div>
        ) : null}
      </div>
      <SegmentList itemId={detail.id} segments={segments} current={current} blind={blind} durationMs={detail.durationMs ?? 0}
        player={controller} native={native} showTranslation={showTranslation} pending={translations.pending}
        onSelect={(idx) => controller?.seekTo(idx, true)} onSegmentSaved={onSegmentSaved} />
      <GradualBlur />
      {rateOpen ? (
        <div ref={speedRef} role="group" aria-label={t("web.library.player.rateSlider")} data-testid="library-speed" className="lib-speed">
          <div className="lib-speed-top">
            <span>{t("web.library.player.rateSlider")}</span>
            <b className="num">{rate.toFixed(2)}×</b>
          </div>
          <ElasticSlider steps={RATES} value={rate} onChange={changeRate} label={t("web.library.player.rateSlider")} />
        </div>
      ) : null}
      <GlassSurface data-testid="library-controls" className="lib-ctrl">
        {showTranslation && translations.notice ? (
          <p role="status" data-testid="library-translate-notice" className="lib-notice">
            {t(translations.notice === "limited" ? "web.library.player.translateLimited" : "web.library.player.translateFailed")}
            {translations.notice === "failed" ? (
              <button type="button" className="lib-notice-btn" onClick={translations.retry}>{t("web.library.player.translateRetry")}</button>
            ) : null}
          </p>
        ) : null}
        <div className="lib-ctrl-main">
          <button type="button" className="lib-ctrl-btn" disabled={!controller} aria-label={t("web.library.player.prev")} onClick={() => controller?.prev()}>
            <SkipBackIcon aria-hidden />
          </button>
          <button type="button" className="lib-ctrl-btn lib-ctrl-play lib-spec" disabled={!controller}
            aria-label={t(playing ? "web.library.player.pause" : "web.library.player.play")} onClick={() => controller?.toggle()}>
            {playing ? <PauseIcon aria-hidden /> : <PlayIcon aria-hidden />}
          </button>
          <button type="button" className="lib-ctrl-btn" disabled={!controller} aria-label={t("web.library.player.next")} onClick={() => controller?.next()}>
            <SkipForwardIcon aria-hidden />
          </button>
        </div>
        <div className="lib-chips">
          {canTranslate ? (
            <button type="button" data-testid="library-translate" className="lib-chip" aria-pressed={translateOn}
              aria-label={t(translateOn ? "web.library.player.translateOn" : "web.library.player.translateOff")}
              onClick={() => setTranslateOn(!translateOn)}>
              <LanguagesIcon aria-hidden /><span aria-hidden>{t("web.library.player.translateShort")}</span>
            </button>
          ) : null}
          <button type="button" data-testid="library-loop" className="lib-chip" disabled={!controller} aria-pressed={loop !== "off"}
            aria-label={t(`web.library.player.loop.${loop}`)} onClick={() => controller?.setLoop(nextLoop(loop))}>
            {loop === 3 || loop === 5 ? <Repeat1Icon aria-hidden /> : <RepeatIcon aria-hidden />}
            <span aria-hidden className="num">{loop === "infinite" ? "∞" : loop === "off" ? t("web.library.player.chipLoop") : `×${loop}`}</span>
          </button>
          <button type="button" ref={rateButton} data-testid="library-rate" className="lib-chip" disabled={!controller} aria-expanded={rateOpen}
            aria-label={t("web.library.player.rate", { rate })} onClick={() => setRateOpen((open) => !open)}>
            <span aria-hidden className="num">{rate}×</span>
          </button>
          <button type="button" data-testid="library-blind" className="lib-chip" aria-pressed={blind}
            aria-label={t(blind ? "web.library.player.blindOff" : "web.library.player.blind")} onClick={() => setBlind((b) => !b)}>
            {blind ? <EyeIcon aria-hidden /> : <EyeOffIcon aria-hidden />}
            <span aria-hidden>{t("web.library.player.chipBlind")}</span>
          </button>
        </div>
      </GlassSurface>
    </LibraryRoot>
  );
}
