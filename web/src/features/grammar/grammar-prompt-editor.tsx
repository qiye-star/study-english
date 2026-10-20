import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@renderer/components/ui/alert-dialog";
import { Button } from "@renderer/components/ui/button";
import { Textarea } from "@renderer/components/ui/textarea";
import { cn } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { LQ_DANGER_TEXT, LQ_DIALOG, LQ_SECONDARY } from "~/components/liquid";
import { bumpGrammarRev } from "./grammar-api";
import { GRAMMAR_PROMPT_SERVER_ERRORS, getGrammarPrompt, resetGrammarPrompt, saveGrammarPrompt, type GrammarPromptState } from "./grammar-prompt-api";

export type GrammarPromptEditorModel = ReturnType<typeof useGrammarPromptEditor>;

/**
 * 设计文档 §2.4 用户层:预填当前生效的默认规则,可编辑保存,一键恢复默认(有确认)。R25。
 * 状态与请求都在这里;页面负责把「恢复默认」放进顶栏,并把同一个 model 交给 GrammarPromptEditor。
 */
export function useGrammarPromptEditor() {
  const { api } = useAuth();
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const [state, setState] = useState<GrammarPromptState | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    getGrammarPrompt(api, controller.signal).then(
      (s) => { if (!controller.signal.aborted) { setState(s); setDraft(s.prompt ?? s.defaultPrompt); } },
      (err) => { if (!controller.signal.aborted) setError(translateServerError(tRef.current, err, GRAMMAR_PROMPT_SERVER_ERRORS)); },
    );
    return () => controller.abort();
  }, [api, attempt]);

  const run = async (action: () => Promise<GrammarPromptState>, toastKey: string) => {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      bumpGrammarRev(); // R15:服务器已变更即失效本机语法缓存,与组件是否仍挂载无关
      if (mounted.current) {
        setState(next);
        setDraft(next.prompt ?? next.defaultPrompt);
        toast.success(tRef.current(toastKey));
      }
    } catch (err) {
      if (mounted.current) setError(translateServerError(tRef.current, err, GRAMMAR_PROMPT_SERVER_ERRORS));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const save = () => {
    if (!state) return;
    const text = draft.trim();
    // R8:空白或与默认规则相同 → 恢复默认,不保存"等于默认"的副本
    if (text === "" || text === state.defaultPrompt.trim()) void run(() => resetGrammarPrompt(api), "web.grammarPrompt.restored");
    else void run(() => saveGrammarPrompt(api, draft), "web.grammarPrompt.saved");
  };

  const restore = () => void run(() => resetGrammarPrompt(api), "web.grammarPrompt.restored");

  const custom = state?.prompt != null;
  const current = state ? state.prompt ?? state.defaultPrompt : "";
  const maxLength = state?.maxLength ?? 2000;
  const length = [...draft].length;
  const tooLong = length > maxLength;

  return {
    state, draft, setDraft, error, busy, confirming, setConfirming, attempt, retry: () => setAttempt((n) => n + 1),
    save, restore, custom, current, maxLength, length, tooLong,
  };
}

/** 编辑器主体(提示词框、计数、保存、恢复确认)。「恢复默认」按钮在页面顶栏,这里只保留确认框。 */
export function GrammarPromptEditor({ editor }: { editor: GrammarPromptEditorModel }) {
  const { t } = useTranslation();
  const { state, draft, error, busy, confirming, custom, current, maxLength, length, tooLong } = editor;

  return (
    <section data-testid="grammar-prompt" className="space-y-2">
      {!state && error && (
        <div role="alert" data-testid="grammar-prompt-error" className="flex items-center gap-2 text-sm text-destructive">
          <span className="flex-1">{error}</span>
          <Button variant="outline" data-testid="grammar-prompt-retry" className="h-11" onClick={editor.retry}>{t("web.common.retry")}</Button>
        </div>
      )}
      {state && (
        <>
          <p data-testid="grammar-prompt-status" data-custom={custom ? "true" : "false"} className="text-xs">
            {t(custom ? "web.grammarPrompt.custom" : "web.grammarPrompt.usingDefault")}
          </p>
          <Textarea data-testid="grammar-prompt-input" rows={8} className="text-base" value={draft} disabled={busy}
            aria-label={t("web.grammarPrompt.title")} onChange={(e) => editor.setDraft([...e.target.value].slice(0, maxLength * 5).join(""))} />
          <p data-testid="grammar-prompt-count" className={cn("text-right text-xs", tooLong ? "text-destructive" : "text-muted-foreground")}>
            {length} / {maxLength}
          </p>
          {tooLong && <p role="alert" className="text-xs text-destructive">{t("web.grammarPrompt.errors.tooLong")}</p>}
          {error && <p role="alert" data-testid="grammar-prompt-error" className="text-sm text-destructive">{error}</p>}
          <Button data-testid="grammar-prompt-save" className="h-11 w-full" disabled={busy || tooLong || draft.trim() === current.trim()} onClick={editor.save}>
            {t("web.grammarPrompt.save")}
          </Button>
        </>
      )}
      <AlertDialog open={confirming} onOpenChange={editor.setConfirming}>
        <AlertDialogContent className={LQ_DIALOG}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("web.grammarPrompt.resetConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>{t("web.grammarPrompt.resetDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={`h-11 ${LQ_SECONDARY}`}>{t("web.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction data-testid="grammar-prompt-reset-confirm" className={`h-11 ${LQ_DANGER_TEXT}`}
              onClick={() => { editor.setConfirming(false); editor.restore(); }}>
              {t("web.grammarPrompt.reset")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
