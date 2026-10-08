import { useEffect, useRef } from "react";

const BAR = 2;
const GAP = 1;

/** 读取 CSS 变量里的 RGB 三元组 → `rgb(r g b / a)` */
function cssRgb(name: string, alpha = 1): string {
  const triplet = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "128 128 128";
  return `rgb(${triplet} / ${alpha})`;
}

/**
 * 伪波形:对称的竖条,已播放部分用 accent,未播放用 wave 灰;`dim` 时整体变淡(录音尚未加载)。
 * 纯展示,不处理交互;交互由父级(role=slider)负责。
 */
export function Waveform({ peaks, progress, dim = false, height = 56, className = "" }: { peaks: number[]; progress: number; dim?: boolean; height?: number; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const draw = () => {
      const width = wrap.clientWidth;
      if (width === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      let ctx: CanvasRenderingContext2D | null = null;
      try {
        ctx = canvas.getContext("2d");
      } catch {
        ctx = null;
      }
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const slot = BAR + GAP;
      const count = Math.max(1, Math.floor((width + GAP) / slot));
      // 重采样到可容纳的条数
      const samples = resample(peaks, count);
      const mid = height / 2;
      const playedUntil = progress * width;
      const played = dim ? cssRgb("--line-strong") : cssRgb("--accent");
      const rest = dim ? cssRgb("--line-strong", 0.7) : cssRgb("--wave", 0.55);
      for (let i = 0; i < count; i++) {
        const x = i * slot;
        const h = Math.max(2, samples[i] * (height - 4));
        ctx.fillStyle = x + BAR / 2 <= playedUntil ? played : rest;
        roundRect(ctx, x, mid - h / 2, BAR, h, 1);
      }
      if (!dim && progress > 0 && progress < 1) {
        ctx.fillStyle = cssRgb("--accent");
        ctx.fillRect(Math.min(width - 1.5, Math.max(0, playedUntil - 0.75)), 0, 1.5, height);
      }
    };

    draw();
    const RO = typeof ResizeObserver !== "undefined" ? new ResizeObserver(draw) : null;
    RO?.observe(wrap);
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    mq?.addEventListener?.("change", draw);
    return () => {
      RO?.disconnect();
      mq?.removeEventListener?.("change", draw);
    };
  }, [peaks, progress, dim, height]);

  return (
    <div ref={wrapRef} className={`relative w-full ${className}`} style={{ height }} aria-hidden="true">
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}

function resample(src: number[], n: number): number[] {
  if (src.length === 0) return new Array<number>(n).fill(0);
  if (src.length === n) return src;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i / n) * src.length);
    const b = Math.max(a + 1, Math.floor(((i + 1) / n) * src.length));
    let m = 0;
    for (let j = a; j < b && j < src.length; j++) if (src[j] > m) m = src[j];
    out[i] = m;
  }
  return out;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
  ctx.fill();
}
