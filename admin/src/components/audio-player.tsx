import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { fetchAudio } from "../api/endpoints";
import { errorText } from "../hooks/use-async";
import { formatSeconds } from "../lib/format";
import { decodePeaks, formatRate, nextRate, placeholderPeaks, type PlaybackRate } from "../lib/waveform";
import { S } from "../strings";
import { PauseIcon, PlayIcon, SpinnerIcon } from "./icons";
import { Waveform } from "./waveform";

type Phase = "idle" | "loading" | "ready" | "error";
const PEAK_BUCKETS = 240;

/**
 * 懒加载波形播放器:点击播放才请求音频(带 Bearer 取 blob -> object URL),同时用 Web Audio 解码画伪波形;
 * 解不出来就用占位波形,功能不受影响。支持拖动波形定位、键盘方向键定位、播放速度切换。
 * 移动端 Safari 在异步加载后不允许自动播放,此时停在"可播放"状态,再点一次即可。
 */
export function AudioPlayer({ assessmentId, compact = false, seed = 1 }: { assessmentId: string; compact?: boolean; seed?: number }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState<PlaybackRate>(1);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const urlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const rafRef = useRef(0);
  const placeholder = useMemo(() => placeholderPeaks(PEAK_BUCKETS, seed), [seed]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
      cancelAnimationFrame(rafRef.current);
    };
  }, [assessmentId]);

  // 换条目时复位
  useEffect(() => {
    setPhase("idle");
    setUrl(null);
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
    setPeaks(null);
  }, [assessmentId]);

  const load = async () => {
    setPhase("loading");
    setError("");
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const blob = await fetchAudio(assessmentId, ac.signal);
      if (ac.signal.aborted) return;
      const next = URL.createObjectURL(blob);
      urlRef.current = next;
      setUrl(next);
      setPhase("ready");
      // 波形解码与播放并行;失败则保留占位波形
      void decodePeaks(blob, PEAK_BUCKETS).then((p) => {
        if (!ac.signal.aborted && p) setPeaks(p);
      });
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(errorText(e));
      setPhase("error");
    }
  };

  // 音频元素挂载后立即尝试播放(在 iOS 上可能被拒绝,保持暂停即可)
  useEffect(() => {
    if (!url) return;
    const el = audioRef.current;
    if (!el) return;
    el.playbackRate = rate;
    el.play()?.catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // 播放时用 rAF 平滑刷新进度;timeupdate 只有 ~4Hz
  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      const el = audioRef.current;
      if (el) setCurrent(el.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing]);

  const toggle = () => {
    if (phase === "idle" || phase === "error") return void load();
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play()?.catch(() => {});
    else el.pause();
  };

  const cycleRate = () => {
    const r = nextRate(rate);
    setRate(r);
    if (audioRef.current) audioRef.current.playbackRate = r;
  };

  const seekTo = (sec: number) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    const t = Math.min(Math.max(sec, 0), duration);
    el.currentTime = t;
    setCurrent(t);
  };

  const seekFromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    seekTo(((e.clientX - rect.left) / rect.width) * duration);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    seekFromPointer(e);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!duration || e.buttons === 0) return;
    seekFromPointer(e);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!duration) return;
    const step = Math.max(1, Math.min(5, duration / 10));
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown":
        e.preventDefault();
        seekTo(current - step);
        break;
      case "ArrowRight":
      case "ArrowUp":
        e.preventDefault();
        seekTo(current + step);
        break;
      case "Home":
        e.preventDefault();
        seekTo(0);
        break;
      case "End":
        e.preventDefault();
        seekTo(duration);
        break;
      case " ":
      case "Enter":
        e.preventDefault();
        toggle();
        break;
    }
  };

  const ready = phase === "ready";
  const progress = duration ? Math.min(current / duration, 1) : 0;
  const btn = compact ? 40 : 48;
  const waveH = compact ? 32 : 60;

  return (
    <div className={`flex items-center gap-3 ${compact ? "rounded-lg bg-accent-soft/70 p-1.5 pr-3" : "rounded-xl border border-line bg-surface p-3"}`} data-phase={phase}>
      <button
        type="button"
        onClick={toggle}
        disabled={phase === "loading"}
        aria-label={phase === "loading" ? S.audio.loading : playing ? S.audio.pause : S.audio.play}
        className="flex shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition-transform active:scale-95 disabled:opacity-70"
        style={{ width: btn, height: btn }}
      >
        {phase === "loading" ? <SpinnerIcon width={20} height={20} /> : playing ? <PauseIcon width={22} height={22} /> : <PlayIcon width={22} height={22} className="translate-x-[1px]" />}
      </button>

      <div className="min-w-0 flex-1">
        {phase === "error" ? (
          <p role="alert" className="text-sm leading-snug text-bad">
            {error || S.audio.failed}
          </p>
        ) : (
          <div
            role="slider"
            tabIndex={ready ? 0 : -1}
            aria-label={S.audio.scrub}
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(current)}
            aria-valuetext={`${formatSeconds(current)} / ${formatSeconds(duration)}`}
            aria-disabled={!ready}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onKeyDown={onKeyDown}
            className={`rounded-md ${ready ? "cursor-pointer touch-none" : "cursor-default"}`}
          >
            <Waveform peaks={peaks ?? placeholder} progress={ready ? progress : 0} dim={!ready} height={waveH} />
          </div>
        )}
        {!compact && (
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="num text-xs text-muted">
              {phase === "loading" ? S.audio.loading : phase === "error" ? "" : ready && duration ? `${formatSeconds(current)} / ${formatSeconds(duration)}` : phase === "idle" ? S.audio.notLoaded : "0:00"}
            </span>
            <RateButton rate={rate} onClick={cycleRate} />
          </div>
        )}
      </div>

      {compact && (
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="num text-2xs text-muted">{phase === "loading" ? "…" : ready && duration ? formatSeconds(duration) : ""}</span>
          <RateButton rate={rate} onClick={cycleRate} small />
        </div>
      )}

      {url && (
        <audio
          ref={audioRef}
          src={url}
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
        />
      )}
    </div>
  );
}

function RateButton({ rate, onClick, small = false }: { rate: number; onClick: () => void; small?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${S.audio.speed} ${formatRate(rate)}`}
      className={`num rounded-md font-medium text-fg-2 transition-colors hover:bg-sunken active:bg-sunken ${small ? "min-h-[28px] min-w-[36px] px-1 text-2xs" : "min-h-[32px] min-w-[44px] px-2 text-xs"} ${
        rate !== 1 ? "bg-accent-soft text-accent" : ""
      }`}
    >
      {formatRate(rate)}
    </button>
  );
}
