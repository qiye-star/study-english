import { cn } from "@renderer/lib/utils";

/**
 * 新词进度环(青色;spec §11.3,视觉稿 .wring:60px、6px 环宽)。`done/target` 文本在环内。
 * tone="green" 给小结页的正确率环(视觉稿 .ring2)。
 */
export function PlanRing({
  done,
  target,
  size = 60,
  label,
  tone = "teal",
  className,
}: {
  done: number;
  target: number;
  size?: number;
  /** 环内文字;默认 `done/target` */
  label?: string;
  tone?: "teal" | "green";
  className?: string;
}) {
  const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
  const text = label ?? `${done}/${target}`;
  const inset = size >= 90 ? 8 : 6;
  return (
    <span
      role="img"
      aria-label={text}
      className={cn("relative inline-flex flex-none items-center justify-center rounded-full", className)}
      style={{
        width: size,
        height: size,
        background: `conic-gradient(rgb(var(--${tone})) 0 ${pct}%, var(--${tone}-tint) ${pct}% 100%)`,
      }}
    >
      <span aria-hidden className="absolute rounded-full bg-surface" style={{ inset }} />
      <span aria-hidden className={cn("num relative font-semibold", tone === "teal" ? "text-teal" : "text-green", size >= 90 ? "text-stat" : "text-body")}>
        {text}
      </span>
    </span>
  );
}
