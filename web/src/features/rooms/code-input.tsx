import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/cn";

const toDigits = (raw: string) => raw.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).replace(/\D/g, "").slice(0, 6);

/**
 * 6 位房间号:一个真实输入框(数字键盘、粘贴 "482 913" / 全角数字自动规整)透明地叠在 6 个可见格子上。
 * 格子 56 高、圆角 12、22px 半粗 tabular;聚焦时下一个待填格子有 1.5px 蓝色内描边(视觉稿 M1)。
 */
export function CodeInput({ value, onChange, onSubmit }: { value: string; onChange(v: string): void; onSubmit(): void }) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const digits = value.padEnd(6, " ").slice(0, 6).split("");
  return (
    <label className="relative block">
      <span className="sr-only">{t("web.rooms.lobby.codeLabel")}</span>
      <input data-testid="room-code-input" inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" enterKeyHint="go" value={value}
        onChange={(e) => onChange(toDigits(e.target.value))}
        onKeyDown={(e) => { if (e.key === "Enter") onSubmit(); }}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        className="absolute inset-0 z-10 h-full w-full cursor-text text-base opacity-0 [caret-color:transparent]" />
      <span aria-hidden className="grid grid-cols-6 gap-2">
        {digits.map((d, i) => (
          <span key={i} data-testid="code-cell"
            className={cn("flex h-14 items-center justify-center rounded-button border-[0.5px] border-hair bg-surface text-headline font-semibold tabular-nums text-ink",
              focused && i === value.length && "shadow-[inset_0_0_0_1.5px_rgb(var(--blue))]")}>{d.trim()}</span>
        ))}
      </span>
    </label>
  );
}
