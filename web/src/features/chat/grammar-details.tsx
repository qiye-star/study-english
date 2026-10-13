import { LoaderIcon, MicIcon, StarIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import { useAuth } from "~/auth/auth-context";
import type { GrammarResult } from "~/features/grammar";
import { savePracticeItem, useShadowSheet } from "~/features/practice";

export function GrammarDetails({ result, onClose }: { result: GrammarResult; onClose(): void }) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const { open: openShadow } = useShadowSheet();
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
    <section data-testid="grammar-details" className="space-y-2.5">
      <h3 className="text-sub font-semibold tracking-[0.01em] text-ink-2">{t("web.grammar.title")}</h3>
      {!result.hasErrors ? (
        <p className="rounded-card bg-surface-2 px-3.5 py-3 text-sub text-ink-2">{t("web.grammar.noIssues")}</p>
      ) : (
        <>
          <ul className="divide-y-[0.5px] divide-hair-2 rounded-card border-[0.5px] border-hair bg-surface">
            {result.errors.map((e, i) => (
              <li key={`${i}-${e.original}`} data-testid="grammar-issue" className="px-3.5 py-3 text-body">
                <p>
                  <span className="text-ink-2 line-through">{e.original}</span>
                  {" → "}
                  <span className="font-semibold text-ink">{e.corrected || "∅"}</span>
                  <span className="ml-2 inline-flex h-[22px] items-center whitespace-nowrap rounded-[7px] bg-surface-2 px-2 align-middle text-meta font-semibold text-ink-2">{t(`web.grammar.categories.${e.category}`, { defaultValue: t("web.grammar.categories.other") })}</span>
                </p>
                {e.explanation && <p className="mt-1 text-sub text-ink-2">{e.explanation}</p>}
              </li>
            ))}
          </ul>
          <div className="space-y-2 rounded-card bg-surface-2 p-3.5">
            <p className="text-meta font-medium text-ink-2">{t("web.grammar.corrected")}</p>
            <p data-testid="grammar-corrected" data-lookup-context className="select-text text-title font-medium leading-dialogue text-ink">{result.corrected}</p>
            <div className="flex gap-2">
              <Button variant="outline" data-testid="grammar-practice" className="h-11 flex-1 rounded-button border-[0.5px] border-hair bg-surface text-ink"
                onClick={() => { onClose(); openShadow({ text: result.corrected, source: "grammar" }); }}>
                <MicIcon className="mr-2 h-4 w-4" />{t("web.grammar.practice")}
              </Button>
              <Button variant="outline" data-testid="grammar-save" className="h-11 flex-1 rounded-button border-[0.5px] border-hair bg-surface text-ink" disabled={saving}
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
