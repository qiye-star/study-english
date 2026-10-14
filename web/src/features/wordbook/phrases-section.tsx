import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { readPhrasesPref, writePhrasesPref } from "./phrases-pref";

export const MAX_PHRASES = 5;
export type PhrasesOpen = "auto" | boolean;
type Phrase = { en: string; zh: string };

/**
 * 短语区(spec 2026-10-12-wordbook-definitions D6,R-DW10)。受控 <details>:`<summary>` 的 click 里 preventDefault,自己切换状态,
 * 不依赖浏览器对 `open` 属性与 `toggle` 事件的实现差异。
 * `mode`:false / true = 固定初始状态(复习页 / 已学词页传 false:折叠);"auto" = 学新词页:这个区块只在词卡翻开后才挂载,
 * 所以挂载时刻 = 遮罩 → 翻开的那一刻;本机偏好不是 false 就展开。展开时标题行不再重复第一条短语。
 * 只有 "auto" 模式把手动开合写入本机(否则在复习页展开再收起会让学新词页从此不再自动展开)。
 * 收起状态的 DOM 与改动前逐字节相同(word-card-legacy 金标准)。
 * `showZh`(默认 true):false = 不显示短语译文(复习页答后区「中文」未按下时,计划 2026-10-14 R-Z3);true 时 DOM 与改动前逐字节相同。
 */
export function PhrasesSection({ phrases, mode, showZh = true }: { phrases: readonly Phrase[]; mode: PhrasesOpen; showZh?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<boolean>(() => (mode === "auto" ? readPhrasesPref() !== false : mode));
  if (phrases.length === 0) return null;
  const first = phrases[0];
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (mode === "auto") writePhrasesPref(next);
  };
  return (
    <details open={open} className="group mt-3 border-t-[0.5px] border-hair-2">
      <summary onClick={(e) => { e.preventDefault(); toggle(); }}
        className="flex min-h-tap cursor-pointer list-none items-center justify-between text-sub text-ink-2 [&::-webkit-details-marker]:hidden">
        <span className="truncate">
          {t("web.wordbook.word.phrases")}
          {open ? null : showZh ? <> · <span lang="en">{first.en}</span> {first.zh}</> : <> · <span lang="en">{first.en}</span></>}
        </span>
        <ChevronDownIcon aria-hidden className="h-[18px] w-[18px] flex-none text-ink-3 transition-transform duration-fast group-open:rotate-180" />
      </summary>
      <ul className="space-y-1 pb-1 text-sub">
        {phrases.slice(0, MAX_PHRASES).map((p, i) => (
          <li key={i}>{showZh ? <><span lang="en" className="font-medium text-ink">{p.en}</span> <span className="text-ink-2">{p.zh}</span></> : <span lang="en" className="font-medium text-ink">{p.en}</span>}</li>
        ))}
      </ul>
    </details>
  );
}
