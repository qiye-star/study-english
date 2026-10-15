import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import type { DiffOp } from "./wordbook-api";

/**
 * 逐字母对齐(服务端 grading.align 的结果;a = 正确字母、b = 你写的字母)。视觉稿 .diff:
 * `eq` 正常;`sub` 你写的字母删除线 + 正确字母琥珀下划线;`ins` 多写的字母删除线;`del` 漏写的字母琥珀下划线。
 * 颜色只做辅助,删除线 / 下划线本身表达差异;读屏读整体的「正确拼写 …」。
 */
export function LetterDiff({ diff, expected, className }: { diff: DiffOp[]; expected: string; className?: string }) {
  const { t } = useTranslation();
  const U = "font-semibold text-amber underline decoration-2 underline-offset-[3px] liquid:text-ink";
  const S = "text-ink-2 line-through";
  return (
    <span role="img" aria-label={t("web.wordbook.diff.label", { word: expected })}
      className={cn("font-mono text-[17px] tracking-[0.02em] text-ink", className)}>
      {diff.map((d, i) => {
        if (d.op === "eq") return <span key={i} data-op="eq" aria-hidden>{d.a}</span>;
        if (d.op === "del") return <span key={i} data-op="del" aria-hidden><u className={U}>{d.a}</u></span>;
        if (d.op === "ins") return <span key={i} data-op="ins" aria-hidden><s className={S}>{d.b}</s></span>;
        return <span key={i} data-op="sub" aria-hidden><s className={S}>{d.b}</s><u className={U}>{d.a}</u></span>;
      })}
    </span>
  );
}
