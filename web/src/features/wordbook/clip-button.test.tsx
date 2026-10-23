import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { ChoiceQuestion } from "./choice-question";
import { ClipButton } from "./clip-button";
import type { Question } from "./wordbook-api";

const CLIP = { itemId: "c1", startMs: 1200, endMs: 3400 };
const TICKET_URL = "/api/library/items/c1/media?ticket=abc";

function setup(ticket: () => Response | Promise<Response> = () => json({ url: TICKET_URL, expires_in: 1800 })) {
  const mock = createFetchMock({ "POST /api/library/items/c1/media-ticket": ticket });
  const view = renderWithProviders(<ClipButton clip={CLIP} />, {
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }),
  });
  return { mock, ...view };
}

let play: ReturnType<typeof vi.spyOn>;
let pause: ReturnType<typeof vi.spyOn>;
/** the <audio> elements the button created (they are never attached to the document) */
let created: HTMLAudioElement[] = [];
const RealAudio = window.Audio;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  created = [];
  window.Audio = function TrackedAudio(this: unknown) {
    const audio = new RealAudio();
    created.push(audio);
    return audio;
  } as unknown as typeof Audio;
  play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
});
afterEach(async () => {
  window.Audio = RealAudio;
  vi.restoreAllMocks();
  await i18n.changeLanguage("en");
});

const lastAudio = (): HTMLAudioElement => created[created.length - 1];

describe("ClipButton (plan L4 Task 18)", () => {
  it("asks for a media ticket for its own item and plays from the start of the clip", async () => {
    const { mock } = setup();
    await userEvent.click(screen.getByTestId("clip-play"));
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(mock.calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual(["POST /api/library/items/c1/media-ticket"]);
    const audio = lastAudio();
    expect(audio.getAttribute("src") ?? audio.src).toContain("ticket=abc");
    expect(audio.currentTime).toBeCloseTo(1.2, 3);
  });

  it("pauses at the end of the clip", async () => {
    setup();
    await userEvent.click(screen.getByTestId("clip-play"));
    await waitFor(() => expect(play).toHaveBeenCalled());
    const audio = lastAudio();
    audio.currentTime = 3.5;
    fireEvent.timeUpdate(audio);
    expect(pause).toHaveBeenCalled();
  });

  it("a second tap replays from the start without asking for another ticket", async () => {
    const { mock } = setup();
    await userEvent.click(screen.getByTestId("clip-play"));
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByTestId("clip-play"));
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(mock.calls).toHaveLength(1);
  });

  it("a failed ticket greys the button out and shows no message", async () => {
    setup(() => json({ error: "not_ready" }, 409));
    await userEvent.click(screen.getByTestId("clip-play"));
    await waitFor(() => expect(screen.getByTestId("clip-play")).toBeDisabled());
    expect(play).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("never writes the ticket URL to the console", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    setup();
    await userEvent.click(screen.getByTestId("clip-play"));
    await waitFor(() => expect(play).toHaveBeenCalled());
    for (const spy of spies) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain("ticket");
    }
  });

  it("stops and releases the audio when it unmounts", async () => {
    const { unmount } = setup();
    await userEvent.click(screen.getByTestId("clip-play"));
    await waitFor(() => expect(play).toHaveBeenCalled());
    unmount();
    expect(pause).toHaveBeenCalled();
  });

  it("the review cloze question shows the clip button only when the server sent a clip", () => {
    const base: Question = { key: "talk", qtype: "cloze", prompt: { sentence: "I _____ to my neighbor.", zh: "我跟邻居聊天。" }, options: ["talk", "go"], length: null };
    const onAnswer = vi.fn();
    const { unmount } = renderWithProviders(<ChoiceQuestion question={base} onAnswer={onAnswer} result={null} />);
    expect(screen.queryByTestId("clip-play")).toBeNull();
    unmount();
    renderWithProviders(<ChoiceQuestion question={{ ...base, clip: CLIP }} onAnswer={onAnswer} result={null} />);
    expect(screen.getByTestId("clip-play")).toBeInTheDocument();
  });
});
