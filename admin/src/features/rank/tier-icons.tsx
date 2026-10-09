import type { SVGProps } from "react";
import { TIER_KEYS } from "./strings";

/** 段位图形(线性图标,不加新色相):盾 / 半盾 / 星盾 / 六边形 / 菱形 / 星 / 王冠 */
const PATHS: Record<string, string[]> = {
  bronze: ["M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"],
  silver: ["M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z", "M12 3v18"],
  gold: ["M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z", "M12 8.5l1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.3-2.4 1.3.5-2.6-1.9-1.8 2.6-.4z"],
  platinum: ["M12 3l8 4.5v9L12 21l-8-4.5v-9z"],
  diamond: ["M6 4h12l3 5-9 11L3 9z", "M3 9h18M9 4l3 16 3-16"],
  star: ["M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"],
  master: ["M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z", "M5 19h14"],
};

export function TierIcon({ tier, ...props }: { tier: string | number } & SVGProps<SVGSVGElement>) {
  const key = typeof tier === "number" ? TIER_KEYS[tier] ?? "bronze" : tier;
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-tier={key}
      {...props}
    >
      {(PATHS[key] ?? PATHS.bronze).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
