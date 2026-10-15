import type { ComponentType, ReactNode, SVGProps } from "react";
import { cn } from "@renderer/lib/utils";

const TILE = {
  blue: "bg-blue-tint [&_[data-label]]:text-blue",
  amber: "bg-amber-tint [&_[data-label]]:text-amber",
  green: "bg-green-tint [&_[data-label]]:text-green",
} as const;

/**
 * 统计卡(我的页三联):彩色标签 + 28px 等宽数字 + 可选单位。放在 grid grid-cols-3 gap-2 里。
 * tone:amber 连续天数、blue 时长/目标、green 分数。
 * 液态皮肤:面板里的井(.wl.well),标签次要色,不着色。
 *   <StatTile tone="amber" icon={FlameIcon} label="连续" value={12} unit="天" />
 */
export function StatTile({
  tone,
  icon: Icon,
  label,
  value,
  unit,
  className,
}: {
  tone: keyof typeof TILE;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[88px] flex-col justify-between rounded-card border-[0.5px] border-hair-2 px-3 pb-[11px] pt-3 well liquid:rounded-inset liquid:border-0 liquid:[&_[data-label]]:text-ink-2",
        TILE[tone],
        className,
      )}
    >
      <div data-label className="flex items-center gap-1 whitespace-nowrap text-meta font-medium">
        {Icon ? <Icon aria-hidden className="h-[15px] w-[15px]" /> : null}
        <span>{label}</span>
      </div>
      <div className="mt-2.5 text-stat font-semibold text-ink">
        <span className="num tracking-tightest">{value}</span>
        {unit ? <small className="ml-0.5 text-meta font-medium tracking-normal text-ink-2">{unit}</small> : null}
      </div>
    </div>
  );
}
