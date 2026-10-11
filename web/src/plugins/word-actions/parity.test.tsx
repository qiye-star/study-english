import { describe, expect, it } from "vitest";
import { AddVocabularyButton } from "~/features/vocabulary";
import { LINK_KEYS, setLinkFlags, type LinkFlags, type WordActionProps } from "~/lib/extension-points";
import { WordActions } from "~/lib/extension-points-react";
import { renderWithProviders } from "~/test/render";
import "./index";

// 四个消费方原来的四种用法(L1-2):testId / label / 变体 / 目标逐一对应
const CASES: WordActionProps[] = [
  { testId: "lookup-vocab", variant: "labeled", target: { word: "country", meaning: "noun · 国家", example: "ask not", source: "lookup" } },
  { testId: "progress-word-vocab", variant: "icon", label: "Add to vocabulary: talk", target: { word: "talk", source: "progress" } },
  { testId: "summary-word-add-0", variant: "icon", target: { word: "brew", meaning: "冲泡", example: "Brew tea.", source: "recap" } },
  { testId: "recap-poor-word-vocab", variant: "icon", label: "Add to vocabulary: three", target: { word: "three", source: "recap" } },
];

const oldHtml = (c: WordActionProps): string => {
  const old = renderWithProviders(<AddVocabularyButton testId={c.testId} label={c.label} withLabel={c.variant === "labeled"} input={c.target} />);
  const html = old.container.innerHTML;
  old.unmount();
  return html;
};

const allOnExcept = (off: string): LinkFlags => ({
  enabled: true, links: Object.fromEntries(LINK_KEYS.map((k) => [k, k !== off])) as LinkFlags["links"],
});

describe("<WordActions> renders exactly the old AddVocabularyButton", () => {
  it.each(CASES)("with every link off ($testId)", (c) => {
    const html = oldHtml(c);
    const now = renderWithProviders(<WordActions {...c} />);
    expect(now.container.innerHTML).toBe(html);
  });

  it.each(CASES)("with every other link on but word_actions off ($testId)", (c) => {
    const html = oldHtml(c);
    setLinkFlags(allOnExcept("word_actions"));
    const now = renderWithProviders(<WordActions {...c} />);
    expect(now.container.innerHTML).toBe(html);
  });
});
