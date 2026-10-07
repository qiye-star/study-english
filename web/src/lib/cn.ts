import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** tailwind.config.cjs 的 theme.extend.fontSize 令牌(text-label … text-hero)。 */
export const FONT_SIZE_TOKENS = ["label", "meta", "sub", "body", "title", "headline", "stat", "hero"];

const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: FONT_SIZE_TOKENS }] } },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
