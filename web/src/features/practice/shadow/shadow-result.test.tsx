import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssessmentScores, AssessmentWordBrief } from "../assessment-api";
import { ShadowResult, type ShadowResultProps } from "./shadow-result";

const REFERENCE = "Could I get a medium latte, please?";
const SCORES: AssessmentScores = { pronunciationScore: 82, accuracyScore: 80, fluencyScore: 85, completenessScore: 100 };
const WORDS: AssessmentWordBrief[] = [
  { word: "Could", accuracyScore: 95, errorType: "None" },
  { word: "I", accuracyScore: 95, errorType: "None" },
  { word: "get", accuracyScore: 75, errorType: "None" },
  { word: "a", accuracyScore: 95, errorType: "None" },
  { word: "medium", accuracyScore: 40, errorType: "Mispronunciation" },
  { word: "latte", accuracyScore: 50, errorType: "Mispronunciation" },
  { word: "please", accuracyScore: 90, errorType: "None" },
];

function setup(over: Partial<ShadowResultProps> = {}) {
  const fns = {
    onToggleMine: vi.fn(), onListen: vi.fn(), onFav: vi.fn(), onAgain: vi.fn(), onContinue: vi.fn(), onDetails: vi.fn(),
  };
  const view = render(
    <ShadowResult reference={REFERENCE} scores={SCORES} words={WORDS} mineUrl="blob:mine" playingMine={false}
      listenState="idle" canListen faved={false} favBusy={false} nextKind="next" {...fns} {...over} />,
  );
  return { ...fns, view };
}

describe("ShadowResult", () => {
  afterEach(() => {
    document.getSelection()?.removeAllRanges();
    document.documentElement.classList.remove("lite");
  });

  it("shows the ring with the score tone and three sub-score bars with their own tones", () => {
    setup();
    const ring = screen.getByTestId("shadow-ring");
    expect(ring).toHaveAttribute("data-score", "82");
    expect(ring).toHaveAttribute("data-tone", "fair");
    const bars = screen.getAllByTestId("shadow-bar");
    expect(bars.map((b) => b.getAttribute("data-tone"))).toEqual(["fair", "good", "good"]);
    expect(bars[0]).toHaveTextContent("80");
    expect(bars[2]).toHaveTextContent("100");
  });

  it("rolls the ring number only when motion is allowed (final value otherwise)", () => {
    document.documentElement.classList.add("lite");
    setup();
    expect(screen.getByTestId("shadow-ring")).toHaveTextContent("82");
  });

  it("colours the words by score tone; punctuation stays outside the word spans", () => {
    setup();
    const words = screen.getByTestId("shadow-words");
    expect(words).toHaveAttribute("data-lookup-context");
    expect(words.textContent).toBe(REFERENCE);
    expect(within(words).getByText("Could")).toHaveAttribute("data-tone", "good");
    expect(within(words).getByText("get")).toHaveAttribute("data-tone", "fair");
    expect(within(words).getByText("medium")).toHaveAttribute("data-tone", "low");
    expect(within(words).getByText("latte")).toHaveAttribute("data-tone", "low");
    expect(within(words).queryByText("latte,")).toBeNull();
  });

  it("tapping a word selects exactly that word so the lookup bar can open", () => {
    setup();
    fireEvent.click(within(screen.getByTestId("shadow-words")).getByText("medium"));
    expect(window.getSelection()!.toString()).toBe("medium");
  });

  it("explains the weak words, praises a clean run, and nudges the in-between", () => {
    const { view } = setup();
    expect(screen.getByTestId("shadow-tip")).toHaveAttribute("data-kind", "weak");
    expect(screen.getByTestId("shadow-tip")).toHaveTextContent("medium, latte");
    view.unmount();
    setup({ scores: { ...SCORES, pronunciationScore: 92 }, words: WORDS.map((w) => ({ ...w, accuracyScore: 95, errorType: "None" })) });
    expect(screen.getByTestId("shadow-tip")).toHaveAttribute("data-kind", "good");
  });

  it("wires every action", async () => {
    const fns = setup();
    await userEvent.click(screen.getByTestId("shadow-mine"));
    await userEvent.click(screen.getByTestId("shadow-standard"));
    await userEvent.click(screen.getByTestId("shadow-fav"));
    await userEvent.click(screen.getByTestId("shadow-again"));
    await userEvent.click(screen.getByTestId("shadow-continue"));
    await userEvent.click(screen.getByTestId("shadow-details"));
    expect(fns.onToggleMine).toHaveBeenCalledTimes(1);
    expect(fns.onListen).toHaveBeenCalledTimes(1);
    expect(fns.onFav).toHaveBeenCalledTimes(1);
    expect(fns.onAgain).toHaveBeenCalledTimes(1);
    expect(fns.onContinue).toHaveBeenCalledTimes(1);
    expect(fns.onDetails).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("shadow-continue")).toHaveTextContent("Next sentence");
  });

  it("disables my recording without audio, shows it playing, and locks the saved star", () => {
    setup({ mineUrl: null });
    expect(screen.getByTestId("shadow-mine")).toBeDisabled();
    document.body.innerHTML = "";
    setup({ playingMine: true, faved: true, nextKind: "done", listenState: "playing" });
    expect(screen.getByTestId("shadow-mine")).toHaveAttribute("data-state", "playing");
    expect(screen.getByTestId("shadow-fav")).toBeDisabled();
    expect(screen.getByTestId("shadow-fav")).toHaveTextContent("Saved");
    expect(screen.getByTestId("shadow-continue")).toHaveTextContent("Done");
    expect(screen.getByTestId("shadow-standard")).toHaveAttribute("data-state", "playing");
  });

  it("cannot play the standard voice when there is no TTS configured", () => {
    setup({ canListen: false });
    expect(screen.getByTestId("shadow-standard")).toBeDisabled();
  });
});
