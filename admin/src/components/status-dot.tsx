export type Tone = "good" | "warn" | "bad" | "neutral";

const TONES: Record<Tone, string> = { good: "bg-good", warn: "bg-warn", bad: "bg-bad", neutral: "bg-wave" };

/** 7px 状态点:绿 = 健康、琥珀 = 提醒、红 = 错误、灰 = 未知/关闭;旁边总有文字,不只靠颜色。 */
export function StatusDot({ tone, label }: { tone: Tone; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={`inline-block h-[7px] w-[7px] rounded-full ${TONES[tone]}`} />
      {label && <span>{label}</span>}
    </span>
  );
}
