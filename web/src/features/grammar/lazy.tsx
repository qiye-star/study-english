import { lazy, Suspense } from "react";

/** 语法检查规则页(/me/grammar)按路由懒加载,编辑器代码不进主包。 */
const GrammarPromptPageBody = lazy(() => import("./grammar-prompt-page").then((m) => ({ default: m.GrammarPromptPage })));

export function GrammarPromptPage() {
  return (
    <Suspense fallback={<div aria-busy="true" className="min-h-[100dvh]" />}>
      <GrammarPromptPageBody />
    </Suspense>
  );
}
