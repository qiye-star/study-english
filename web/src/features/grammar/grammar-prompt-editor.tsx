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
import { bumpGrammarRev } from "./grammar-api";
import { GRAMMAR_PROMPT_SERVER_ERRORS, getGrammarPrompt, resetGrammarPrompt, saveGrammarPrompt, type GrammarPromptState } from "./grammar-prompt-api";

/** 设计文档 §2.4 用户层:预填当前生效的默认规则,可编辑保存,一键恢复默认(有确认)。R25。 */
export function GrammarPromptEditor() {
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

  const apply = (next: GrammarPromptState) => {
    setState(next);
    setDraft(next.prompt ?? next.defaultPrompt);
    bumpGrammarRev(); // R15:本机语法缓存随提示词版本失效
    toast.success(tRef.current("web.grammarPrompt.saved"));
  };

  const run = async (action: () => Promise<GrammarPromptState>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      if (mounted.current) apply(next);
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
    void run(() => (text === "" || text === state.defaultPrompt.trim() ? resetGrammarPrompt(api) : saveGrammarPrompt(api, draft)));
  };

  const custom = state?.prompt != null;
  const current = state ? state.prompt ?? state.defaultPrompt : "";
  const maxLength = state?.maxLength ?? 2000;
  const tooLong = draft.length > maxLength;

  return (
    <section data-testid="grammar-prompt" className="space-y-2">
      <h2 className="text-sm text-muted-foreground">{t("web.grammarPrompt.title")}</h2>
      <p className="text-xs text-muted-foreground">{t("web.grammarPrompt.hint")}</p>
      {!state && error && (
        <div role="alert" data-testid="grammar-prompt-error" className="flex items-center gap-2 text-sm text-destructive">
          <span className="flex-1">{error}</span>
          <Button variant="outline" data-testid="grammar-prompt-retry" className="h-11" onClick={() => setAttempt((n) => n + 1)}>{t("web.common.retry")}</Button>
        </div>
      )}
      {state && (
        <>
          <p data-testid="grammar-prompt-status" data-custom={custom ? "true" : "false"} className="text-xs">
            {t(custom ? "web.grammarPrompt.custom" : "web.grammarPrompt.usingDefault")}
          </p>
          <Textarea data-testid="grammar-prompt-input" rows={8} className="text-base" value={draft} disabled={busy}
            aria-label={t("web.grammarPrompt.title")} onChange={(e) => setDraft(e.target.value)} />
          <p data-testid="grammar-prompt-count" className={cn("text-right text-xs", tooLong ? "text-destructive" : "text-muted-foreground")}>
            {draft.length} / {maxLength}
          </p>
          {tooLong && <p role="alert" className="text-xs text-destructive">{t("web.grammarPrompt.errors.tooLong")}</p>}
          {error && <p role="alert" data-testid="grammar-prompt-error" className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button data-testid="grammar-prompt-save" className="h-11 flex-1" disabled={busy || tooLong || draft === current} onClick={save}>
              {t("web.grammarPrompt.save")}
            </Button>
            <Button variant="outline" data-testid="grammar-prompt-reset" className="h-11 flex-1" disabled={busy || !custom}
              onClick={() => setConfirming(true)}>
              {t("web.grammarPrompt.reset")}
            </Button>
          </div>
        </>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("web.grammarPrompt.resetConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>{t("web.grammarPrompt.resetDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t("web.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction data-testid="grammar-prompt-reset-confirm" className="h-11"
              onClick={() => { setConfirming(false); void run(() => resetGrammarPrompt(api)); }}>
              {t("web.grammarPrompt.reset")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
