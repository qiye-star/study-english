import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import {
  MAX_SEGMENT_TEXT, SegmentEditor, cleanSegmentText, formatMs, nudge, segmentBounds, segmentPatch,
} from "./segment-editor";

const SEG = { idx: 2, startMs: 1000, endMs: 3000, text: "Hello world." };

describe("segment editor rules (plan W2 R-SH16)", () => {
  it("bounds a sentence by its neighbours, else by 0 and the media duration", () => {
    expect(segmentBounds(900, 3300, 10_000)).toEqual({ min: 900, max: 3300 });
    expect(segmentBounds(900, null, 10_000)).toEqual({ min: 900, max: 10_000 });
    expect(segmentBounds(null, null, null)).toEqual({ min: 0, max: Number.POSITIVE_INFINITY });
  });

  it("nudges by 0.2 s, clamps to the bounds and keeps at least 0.2 s of sentence", () => {
    const b = { min: 900, max: 3300 };
    expect(nudge({ startMs: 1000, endMs: 3000 }, "start", -200, b).startMs).toBe(900);
    expect(nudge({ startMs: 2700, endMs: 3000 }, "start", 200, b).startMs).toBe(2800);
    expect(nudge({ startMs: 1000, endMs: 3200 }, "end", 200, b).endMs).toBe(3300);
    expect(nudge({ startMs: 1000, endMs: 1300 }, "end", -200, b).endMs).toBe(1200);
    expect(nudge({ startMs: 1000, endMs: 1100 }, "start", -200, { min: 1000, max: 3300 })).toEqual({ startMs: 1000, endMs: 1100 });
  });

  it("cleans text: folds whitespace, requires a letter, at most 600 characters", () => {
    expect(cleanSegmentText("  Hello   world. ")).toBe("Hello world.");
    expect(cleanSegmentText("123")).toBeNull();
    expect(cleanSegmentText("   ")).toBeNull();
    expect(cleanSegmentText("a".repeat(MAX_SEGMENT_TEXT))).toHaveLength(MAX_SEGMENT_TEXT);
    expect(cleanSegmentText("a".repeat(MAX_SEGMENT_TEXT + 1))).toBeNull();
  });

  it("patches only what changed; null when the text is invalid", () => {
    expect(segmentPatch(SEG, { startMs: 1000, endMs: 3000, text: "Hello  world. " })).toEqual({});
    expect(segmentPatch(SEG, { startMs: 1200, endMs: 3000, text: "Hello world." })).toEqual({ startMs: 1200 });
    expect(segmentPatch(SEG, { startMs: 1000, endMs: 3000, text: "Hello there." })).toEqual({ text: "Hello there." });
    expect(segmentPatch(SEG, { startMs: 1000, endMs: 3000, text: "42" })).toBeNull();
  });

  it("formats times as m:ss.t", () => {
    expect(formatMs(0)).toBe("0:00.0");
    expect(formatMs(1400)).toBe("0:01.4");
    expect(formatMs(75_400)).toBe("1:15.4");
  });
});

function setup(handler?: Handler) {
  const mock = createFetchMock(handler ? { "PATCH /api/library/items/i1/segments/2": handler } : {});
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <TestProviders api={api}>
      <SegmentEditor itemId="i1" segment={SEG} prevEndMs={900} nextStartMs={3300} durationMs={10_000} onSaved={onSaved} onClose={onClose} />
    </TestProviders>,
  );
  return { mock, onSaved, onClose };
}

describe("SegmentEditor", () => {
  it("moves the start later twice and saves only start_ms", async () => {
    const { mock, onSaved, onClose } = setup(() => json({ segment: { idx: 2, start_ms: 1400, end_ms: 3000, text: "Hello world.", zh: null, zh_lang: null, has_analysis: false, analysis_lang: null } }));
    await userEvent.click(screen.getByTestId("segment-start-later"));
    await userEvent.click(screen.getByTestId("segment-start-later"));
    expect(screen.getByTestId("segment-start")).toHaveTextContent("0:01.4");
    await userEvent.click(screen.getByTestId("segment-save"));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({
      idx: 2, startMs: 1400, endMs: 3000, text: "Hello world.", zh: null, zhLang: null, hasAnalysis: false, analysisLang: null,
    }));
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ start_ms: 1400 });
    expect(mock.calls[0].url.search).toBe("");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes without a request when nothing changed", async () => {
    const { mock, onClose } = setup();
    await userEvent.click(screen.getByTestId("segment-save"));
    expect(onClose).toHaveBeenCalled();
    expect(mock.calls).toHaveLength(0);
  });

  it("disables saving for text without letters", async () => {
    setup();
    await userEvent.clear(screen.getByTestId("segment-text"));
    await userEvent.type(screen.getByTestId("segment-text"), "123");
    expect(screen.getByTestId("segment-text-invalid")).toHaveTextContent(i18n.t("web.library.shadow.editor.invalidText"));
    expect(screen.getByTestId("segment-save")).toBeDisabled();
  });

  it("shows the translated server refusal and keeps the editor open", async () => {
    const { onSaved, onClose } = setup(() => json({ error: "Invalid sentence times" }, 400));
    await userEvent.click(screen.getByTestId("segment-end-earlier"));
    await userEvent.click(screen.getByTestId("segment-save"));
    expect(await screen.findByRole("alert")).toHaveTextContent(i18n.t("web.library.shadow.errors.badTimes"));
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
