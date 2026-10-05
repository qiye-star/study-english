import { LoaderIcon, MicIcon, StarIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@renderer/components/ui/button";
import { useAuth } from "~/auth/auth-context";
import type { GrammarResult } from "~/features/grammar/grammar-types";
import { goPractice, savePracticeItem } from "~/features/practice/save-practice-item";

export function GrammarDetails({ result, onClose }: { result: GrammarResult; onClose(): void }) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false); // 同步防连点:state 在同一帧内仍是旧值
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await savePracticeItem(api, t, result.corrected, "grammar");
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };
  return (
    <section data-testid="grammar-details" className="space-y-3">
      <h3 className="text-sm font-medium">{t("web.grammar.title")}</h3>
      {!result.hasErrors ? (
        <p className="text-sm text-muted-foreground">{t("web.grammar.noIssues")}</p>
      ) : (
        <>
          <ul className="space-y-2">
            {result.errors.map((e, i) => (
              <li key={`${i}-${e.original}`} data-testid="grammar-issue" className="rounded-md border p-2 text-sm">
                <p>
                  <span className="text-destructive line-through">{e.original}</span>
                  {" → "}
                  <span className="font-medium text-emerald-700 dark:text-emerald-400">{e.corrected || "∅"}</span>
                  <span className="ml-2 rounded bg-muted px-1 text-xs">{t(`web.grammar.categories.${e.category}`, { defaultValue: t("web.grammar.categories.other") })}</span>
                </p>
                {e.explanation && <p className="mt-1 text-muted-foreground">{e.explanation}</p>}
              </li>
            ))}
          </ul>
          <div className="space-y-2 rounded-md bg-muted p-3">
            <p className="text-xs text-muted-foreground">{t("web.grammar.corrected")}</p>
            <p data-testid="grammar-corrected" data-lookup-context className="select-text text-base">{result.corrected}</p>
            <div className="flex gap-2">
              <Button variant="outline" data-testid="grammar-practice" className="h-11 flex-1"
                onClick={() => { onClose(); goPractice(navigate, result.corrected); }}>
                <MicIcon className="mr-2 h-4 w-4" />{t("web.grammar.practice")}
              </Button>
              <Button variant="outline" data-testid="grammar-save" className="h-11 flex-1" disabled={saving}
                onClick={() => void save()}>
                {saving ? <LoaderIcon className="mr-2 h-4 w-4 animate-spin" /> : <StarIcon className="mr-2 h-4 w-4" />}{t("web.grammar.save")}
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
