import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * 与 @renderer/lib/utils 的 cn 相同,但让 tailwind-merge 认识 redesign 的字号令牌(text-label … text-hero)。
 * 默认的 twMerge 把 text-meta 当成文字颜色,和 text-ink-2 / text-blue 写在同一个 cn() 里时会把字号删掉。
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["label", "meta", "sub", "body", "title", "headline", "stat", "hero"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
