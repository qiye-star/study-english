import { StarIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { useAuth } from "~/auth/auth-context";
import { savePracticeItem } from "~/features/practice";
import "./locales";
import { ClickSpark } from "./shadow-fx";

export type SaveState = "idle" | "saving" | "saved";

export interface SaveSentenceState {
  state: SaveState;
  /** 存一次(不去重,服务端也不去重);返回是否成功。成功 / 失败的 toast 由 savePracticeItem 发。 */
  save(): Promise<boolean>;
}

/**
 * 把这一句存进练习清单(source="library",spec §11.4)。成功后 state 为 "saved" 直到句子变化(plan W2 R-SH18)。
 * 在 ActivePanel 里只调一次,结果同时交给评分卡的芯片与 ⋯ 菜单的条目。
 */
export function useSaveSentence(text: string): SaveSentenceState {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [savedText, setSavedText] = useState<string | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      const ok = await savePracticeItem(api, t, text, "library");
      if (ok && mounted.current) setSavedText(text);
      return ok;
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [api, t, text]);

  const state: SaveState = busy ? "saving" : savedText === text ? "saved" : "idle";
  return { state, save };
}

/** 评分卡里的「加入练习」芯片(设计稿 D):点按迸出火花(ClickSpark,spec §11.4a),已加入后星变实心、转琥珀色。 */
export function SaveSentenceChip({ save, className }: { save: SaveSentenceState; className?: string }) {
  const { t } = useTranslation();
  const saved = save.state === "saved";
  return (
    <ClickSpark>
      <button
        type="button"
        data-testid="shadow-save"
        data-state={save.state}
        disabled={save.state === "saving"}
        onClick={() => void save.save()}
        className={cn(
          "inline-flex min-h-tap items-center gap-1.5 rounded-full bg-surface-2 px-3.5 text-sub transition-colors duration-fast",
          "hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60",
          saved ? "text-amber" : "text-ink",
          className,
        )}
      >
        <StarIcon aria-hidden className={cn("h-4 w-4 flex-none", saved && "fill-current")} />
        {t(saved ? "web.library.shadow.saved" : "web.library.shadow.save")}
      </button>
    </ClickSpark>
  );
}
