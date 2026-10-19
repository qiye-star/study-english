import { useState } from "react";
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
 * 圆形头像。有 src 时显示图片(装饰性,名字由外层 aria-label 提供);没有或加载失败时显示首字。
 * tone="neutral" 用于对话伙伴(对话与通话一致),"blue" 只用于用户本人。
 * 液态皮肤:所有人都是中性井 + 墨色字母(.av)。
 * <Avatar name="Emma" size="sm" /> · <Avatar name={user.name} size="md" tone="blue" src={avatarUrl} />
 */
export function Avatar({
  name,
  size = "sm",
  tone = "neutral",
  className,
  src,
}: {
  name: string;
  size?: keyof typeof SIZE;
  tone?: "neutral" | "blue";
  className?: string;
  /** 相对路径的头像图片;null / 缺省 = 只显示首字。 */
  src?: string | null;
}) {
  // 记住加载失败的那一张:换了 src 就重新尝试。
  const [failed, setFailed] = useState<string | null>(null);
  const image = src && src !== failed ? src : null;
  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        "inline-flex flex-none items-center justify-center overflow-hidden rounded-full border-[0.5px] border-hair-2 font-semibold tracking-tightest",
        tone === "blue" ? "bg-blue-tint text-blue" : "bg-surface-2 text-ink",
        "liquid:border-0 liquid:bg-wash liquid:text-ink liquid:shadow-well",
        SIZE[size],
        className,
      )}
    >
      {image ? (
        <img
          src={image}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          onError={() => setFailed(image)}
        />
      ) : (
        <span aria-hidden>{avatarInitial(name)}</span>
      )}
    </span>
  );
}
