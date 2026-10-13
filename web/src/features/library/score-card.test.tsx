import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import "./locales";
import { ScoreCard } from "./score-card";
import { useSaveSentence } from "./save-sentence";

const SCORES = { pronunciationScore: 86, accuracyScore: 84, fluencyScore: 82, completenessScore: 100 };

function Harness({ scores = SCORES, attemptSaved = true }: { scores?: typeof SCORES; attemptSaved?: boolean }) {
  const save = useSaveSentence("Hello world.");
  return <ScoreCard scores={scores} attemptSaved={attemptSaved} save={save} />;
}

function setup(props: Parameters<typeof Harness>[0] = {}) {
  const api = new ApiClient({ getToken: () => "t", fetchImpl: createFetchMock({}).fetch });
  return render(<TestProviders api={api}><Harness {...props} /></TestProviders>);
}

describe("ScoreCard (spec §11.4a, plan W2 R-SH24)", () => {
  it("rolls the numbers up to the scores and fills the ring", async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId("score-main")).toHaveTextContent("86"), { timeout: 3000 });
    const card = screen.getByTestId("assessment-scores");
    await waitFor(() => expect(card).toHaveTextContent("84"), { timeout: 3000 });
    expect(card).toHaveTextContent("82");
    expect(card).toHaveTextContent("100");
    const arc = screen.getByTestId("score-ring-arc");
    await waitFor(() => expect(Number(arc.getAttribute("stroke-dashoffset"))).toBeCloseTo(2 * Math.PI * 30 * 0.14, 3));
  });

  it("uses the score scale for the headline, with gradient text only for a high score", () => {
    const { unmount } = setup();
    expect(screen.getByTestId("assessment-scores")).toHaveAttribute("data-tone", "good");
    expect(screen.getByTestId("score-headline")).toHaveTextContent(i18n.t("web.library.shadow.score.good"));
    unmount();
    setup({ scores: { ...SCORES, pronunciationScore: 74 } });
    expect(screen.getByTestId("assessment-scores")).toHaveAttribute("data-tone", "fair");
    expect(screen.getByTestId("score-headline")).toHaveTextContent(i18n.t("web.library.shadow.score.fair"));
  });

  it("calls a low score low and survives out-of-range numbers", () => {
    setup({ scores: { pronunciationScore: 41, accuracyScore: 50, fluencyScore: Number.NaN, completenessScore: 140 } });
    expect(screen.getByTestId("assessment-scores")).toHaveAttribute("data-tone", "low");
    expect(screen.getByTestId("score-headline")).toHaveTextContent(i18n.t("web.library.shadow.score.low"));
  });

  it("says when the attempt was not added to the best scores, and offers the add-to-practice chip", () => {
    setup({ attemptSaved: false });
    expect(screen.getByTestId("shadow-attempt-unsaved")).toHaveTextContent(i18n.t("web.library.shadow.attemptNotSaved"));
    expect(screen.getByTestId("shadow-save")).toHaveAttribute("data-state", "idle");
  });

  it("hides the note when the attempt was recorded", () => {
    setup({ attemptSaved: true });
    expect(screen.queryByTestId("shadow-attempt-unsaved")).toBeNull();
  });
});
