import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/ui/button";
import { LQ_PAGE } from "~/components/liquid";
import { SurfaceCard } from "~/components/surface-card";
import { PageHeader } from "~/layout/page-header";
import { GrammarPromptEditor, useGrammarPromptEditor } from "./grammar-prompt-editor";

/** 我的 → 语法检查规则(/me/grammar):说明、提示词编辑器;「恢复默认」在顶栏,仍先弹确认。 */
export function GrammarPromptPage() {
  const { t } = useTranslation();
  const editor = useGrammarPromptEditor();
  return (
    <div>
      <PageHeader title={t("web.grammarPrompt.pageTitle")} back="/me" actions={
        <Button variant="ghost" size="sm" data-testid="grammar-prompt-reset" className="h-11 px-2 text-body text-blue"
          disabled={editor.busy || !editor.custom} onClick={() => editor.setConfirming(true)}>
          {t("web.grammarPrompt.reset")}
        </Button>
      } />
      <div className={`px-gutter pb-6 ${LQ_PAGE}`}>
        <p className="mt-2 px-0.5 text-sub text-ink-2">{t("web.grammarPrompt.intro")}</p>
        <SurfaceCard className="mt-3 p-3.5">
          <GrammarPromptEditor editor={editor} />
        </SurfaceCard>
      </div>
    </div>
  );
}
