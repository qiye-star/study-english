import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import { AnalysisCard, parseAnalysis, resetAnalysisCache } from "./analysis-card";
import "./locales";

const SEG = { idx: 2, startMs: 1000, endMs: 3000, text: "So, Rachel, what are you going to do now?" };
const TEXT = "### Sentence Structure\nA wh-question.\n\n### Grammar\nbe going to + verb\n\n### Vocabulary/Phrases\nwhat now";
const ROUTE = "POST /api/library/items/i1/segments/2/analysis";

function setup(handler: Handler, segment: Parameters<typeof AnalysisCard>[0]["segment"] = SEG) {
  const mock = createFetchMock({ [ROUTE]: handler });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const view = render(<TestProviders api={api}><AnalysisCard itemId="i1" segment={segment} /></TestProviders>);
  const again = () => view.rerender(<TestProviders api={api}><AnalysisCard itemId="i1" segment={segment} /></TestProviders>);
  return { mock, view, again };
}

describe("parseAnalysis (plan W2 R-SH28)", () => {
  it("splits on markdown headings, whatever language they are in", () => {
    expect(parseAnalysis(TEXT)).toEqual([
      { title: "Sentence Structure", body: "A wh-question." },
      { title: "Grammar", body: "be going to + verb" },
      { title: "Vocabulary/Phrases", body: "what now" },
    ]);
    expect(parseAnalysis("### 句子结构\r\n疑问句\r\n### 语法\r\nbe going to")).toEqual([
      { title: "句子结构", body: "疑问句" },
      { title: "语法", body: "be going to" },
    ]);
  });

  it("keeps text before the first heading and falls back to one section without headings", () => {
    expect(parseAnalysis("Intro line\n## Grammar\nx")).toEqual([{ title: null, body: "Intro line" }, { title: "Grammar", body: "x" }]);
    expect(parseAnalysis("Just a paragraph.\nSecond line.")).toEqual([{ title: null, body: "Just a paragraph.\nSecond line." }]);
    expect(parseAnalysis("### Grammar\n")).toEqual([{ title: null, body: "### Grammar" }]);
  });
});

describe("AnalysisCard (spec §11.4, plan W2 R-SH28)", () => {
  beforeEach(() => resetAnalysisCache());

  it("shows a skeleton, then the sections, and asks for the native language in the body", async () => {
    const { mock } = setup(() => json({ analysis: TEXT, cached: false }));
    expect(screen.getByTestId("analysis-loading")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("analysis-card")).toHaveAttribute("data-status", "done"));
    const card = screen.getByTestId("analysis-card");
    expect(card).toHaveTextContent("Sentence Structure");
    expect(card).toHaveTextContent("be going to + verb");
    expect(card).toHaveTextContent("Vocabulary/Phrases");
    expect(JSON.parse(mock.calls[0].body as string).native_language).toMatch(/^(en-US|zh-CN|es-ES)$/);
    expect(mock.calls[0].url.search).toBe("");
  });

  it("does not ask again for an analysis it already has, even after the card was closed", async () => {
    const first = setup(() => json({ analysis: TEXT, cached: false }));
    await waitFor(() => expect(screen.getByTestId("analysis-card")).toHaveAttribute("data-status", "done"));
    first.view.unmount();
    const second = setup(() => json({ analysis: "other", cached: false }));
    expect(screen.getByTestId("analysis-card")).toHaveAttribute("data-status", "done");
    expect(screen.getByTestId("analysis-card")).toHaveTextContent("be going to + verb");
    expect(second.mock.calls).toHaveLength(0);
  });

  it("fetches the text of an analysis the server already has (has_analysis) and does not animate it", async () => {
    const { mock } = setup(() => json({ analysis: TEXT, cached: true }), { ...SEG, hasAnalysis: true, analysisLang: "zh-CN" });
    expect(screen.getByTestId("analysis-loading")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("analysis-card")).toHaveAttribute("data-status", "done"));
    expect(mock.calls).toHaveLength(1);
    expect(screen.getByTestId("analysis-card")).toHaveTextContent("be going to + verb");
    expect(screen.getByTestId("analysis-card").querySelector(".lib-bw")).toBeNull();
  });

  it("treats an empty analysis as a failure", async () => {
    setup(() => json({ analysis: "  ", cached: false }));
    expect(await screen.findByTestId("analysis-error")).toBeInTheDocument();
  });

  it("collapses and expands without a second request", async () => {
    const { mock } = setup(() => json({ analysis: TEXT, cached: false }));
    await waitFor(() => expect(screen.getByTestId("analysis-card")).toHaveAttribute("data-status", "done"));
    await userEvent.click(screen.getByTestId("analysis-toggle"));
    expect(screen.getByTestId("analysis-toggle")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("analysis-card")).not.toHaveTextContent("be going to + verb");
    await userEvent.click(screen.getByTestId("analysis-toggle"));
    expect(screen.getByTestId("analysis-card")).toHaveTextContent("be going to + verb");
    expect(mock.calls).toHaveLength(1);
  });

  it("offers a retry after a failure and recovers", async () => {
    let fail = true;
    const { mock } = setup(() => (fail ? json({ error: "boom" }, 500) : json({ analysis: TEXT, cached: false })));
    expect(await screen.findByTestId("analysis-error")).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByTestId("analysis-retry"));
    await waitFor(() => expect(screen.getByTestId("analysis-card")).toHaveAttribute("data-status", "done"));
    expect(mock.calls).toHaveLength(2);
  });

  it("says so when the daily limit is used up (429) or the feature is off (404)", async () => {
    const limited = setup(() => json({ error: "Daily analysis limit reached" }, 429));
    expect(await screen.findByTestId("analysis-error")).toHaveTextContent(i18n.t("web.library.shadow.analysis.limited"));
    limited.view.unmount();
    setup(() => json({ error: "Not Found" }, 404));
    expect(await screen.findByTestId("analysis-error")).toHaveTextContent(i18n.t("web.library.shadow.analysis.unavailable"));
  });
});
