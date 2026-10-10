import { useTranslation } from "react-i18next";
import type { DiffOp } from "../wordbook-api";

/**
 * STAND-IN for WC2's `../letter-diff.tsx` (not in this branch yet). Same props and markup contract as the plan's
 * WC2 `LetterDiff({ diff, expected })`: `eq` plain; `sub` typed letter struck + expected letter amber-underlined;
 * `ins` extra typed letter struck; `del` missing expected letter amber-underlined; every piece has `data-op`;
 * root `aria-label` = 「正确拼写 {expected}」.
 *
 * Ruling WS3-1: after WC2 merges, change the import in `spell-results.tsx` to `../letter-diff`, delete this file and
 * the `web.wordbookSpell.diffLabel` key (WC2 owns `web.wordbook.diff.label`).
 */
export function LetterDiff({ diff, expected }: { diff: DiffOp[]; expected: string }) {
  const { t } = useTranslation();
  return (
    <span className="font-mono text-[17px] tracking-[0.02em] text-ink" aria-label={t("web.wordbookSpell.diffLabel", { word: expected })}>
      {diff.map((d, i) => {
        if (d.op === "eq") return <span key={i} data-op="eq">{d.a}</span>;
        if (d.op === "del") return <span key={i} data-op="del"><u className="font-semibold text-amber decoration-2 underline-offset-[3px]">{d.a}</u></span>;
        if (d.op === "ins") return <span key={i} data-op="ins"><s className="text-ink-2">{d.b}</s></span>;
        return <span key={i} data-op="sub"><s className="text-ink-2">{d.b}</s><u className="font-semibold text-amber decoration-2 underline-offset-[3px]">{d.a}</u></span>;
      })}
    </span>
  );
}
