import { cn } from "@renderer/lib/utils";

/** 名字的首字(大写);空名返回 "?"。按码点取,不会切开 emoji。 */
export function avatarInitial(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : "?";
}

const SIZE = {
  sm: "h-[30px] w-[30px] text-meta", // 对话气泡旁
  md: "h-[60px] w-[60px] text-headline", // 我的 · 个人资料
  lg: "h-24 w-24 text-hero", // 通话主视觉(短屏由调用方改成 h-16 w-16)
} as const;

/**
 * 圆形首字头像。tone="neutral" 用于对话伙伴(对话与通话一致),"blue" 只用于用户本人。
 * <Avatar name="Emma" size="sm" /> · <Avatar name={user.name} size="md" tone="blue" />
 */
export function Avatar({
  name,
  size = "sm",
  tone = "neutral",
  className,
}: {
  name: string;
  size?: keyof typeof SIZE;
  tone?: "neutral" | "blue";
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        "inline-flex flex-none items-center justify-center rounded-full border-[0.5px] border-hair-2 font-semibold tracking-tightest",
        tone === "blue" ? "bg-blue-tint text-blue" : "bg-surface-2 text-ink",
        SIZE[size],
        className,
      )}
    >
      <span aria-hidden>{avatarInitial(name)}</span>
    </span>
  );
}
