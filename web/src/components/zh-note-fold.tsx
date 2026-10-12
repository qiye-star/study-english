import { ChevronDownIcon } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "~/lib/cn";

export interface ZhNoteFoldProps {
  /** 中文说明(note_zh / hint_zh);空 = 不渲染 */
  text: string | null | undefined;
  /** 折叠 / 展开时的按钮文字:由调用方从自己的懒加载文案传入(本组件不含文案,R-AW10) */
  showLabel: string;
  hideLabel: string;
  testId?: string;
  className?: string;
}

/**
 * 「中文」折叠(spec 2026-10-12-agents-addressing §5.1):默认折叠,按钮 44 px 命中、aria-expanded / aria-controls;
 * 说明在 lang="zh-CN" 的段落里,不属于任何朗读入口的取值(朗读只取消息正文)。按钮在有说明时常驻,展开只在它下方追加,不挪动它。
 */
export function ZhNoteFold({ text, showLabel, hideLabel, testId = "zh-note", className }: ZhNoteFoldProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const note = text?.trim();
  if (!note) return null;
  return (
    <div data-testid={testId} className={cn("flex min-w-0 max-w-full flex-col items-start", className)}>
      <button type="button" data-testid={`${testId}-toggle`} aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}
        className="-mx-2 inline-flex h-tap min-w-tap items-center gap-1 rounded-[9px] px-2 text-meta font-medium text-ink-2 transition-colors duration-fast hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {open ? hideLabel : showLabel}
        <ChevronDownIcon aria-hidden className={cn("size-3.5 transition-transform duration-fast motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      <p id={id} lang="zh-CN" hidden={!open} data-testid={`${testId}-text`}
        className="-mt-1 max-w-full whitespace-pre-wrap break-words text-sub leading-dialogue text-ink-2">{note}</p>
    </div>
  );
}
