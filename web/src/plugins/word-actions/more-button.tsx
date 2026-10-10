import { EllipsisIcon } from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "~/components/icon-button";
import type { WordActionProps } from "~/lib/extension-points";

// 面板(及其中各模块的行)只在第一次点开时加载,主包只多这个按钮(验收 8)
const WordActionsSheet = lazy(() => import("./word-actions-sheet").then((m) => ({ default: m.WordActionsSheet })));

/** wordActions 插槽里的「更多」:44×44 图标按钮,紧跟在核心「加入词汇本」按钮之后(spec §6.1)。 */
export function MoreWordActions(props: WordActionProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <IconButton ref={ref} data-testid={`${props.testId}-more`} label={t("web.links.wordActions.more", { word: props.target.word })}
        aria-haspopup="dialog" aria-expanded={open} className="text-ink-2"
        onClick={() => { setLoaded(true); setOpen(true); }}>
        <EllipsisIcon aria-hidden="true" />
      </IconButton>
      {loaded ? (
        <Suspense fallback={null}>
          <WordActionsSheet {...props} open={open} onOpenChange={setOpen} returnFocus={() => ref.current?.focus()} />
        </Suspense>
      ) : null}
    </>
  );
}
