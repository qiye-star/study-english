import type { CSSProperties } from "react";

/** 用名字哈希出一个色相;饱和度放低,只做辨识用,不抢 accent。明暗配色在 index.css 的 .avatar 里。 */
const HUES = [205, 170, 30, 285, 340, 120, 55, 250];

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = HUES[h % HUES.length];
  return (
    <div
      aria-hidden="true"
      className="avatar flex shrink-0 items-center justify-center rounded-full font-semibold uppercase"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), "--av-h": hue } as CSSProperties}
    >
      {(name.trim()[0] ?? "?").toUpperCase()}
    </div>
  );
}
