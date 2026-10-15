import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { isItemGone, resetGoneItems } from "./gone-items";
import { LibraryPlayerPage } from "./player-page";
import { CONFIG_OFF_RAW, CONFIG_RAW, SEGMENTS_RAW, detailRaw } from "./test-fixtures";
import { resetUiLanguage, setUiLanguage } from "./test-i18n";
import type { UseTranslationsArgs } from "./use-translations";

const TICKET = "/api/library/items/i1/media?ticket=secret-ticket";
const ON_KEY = "enjoy-web.library.translate.i1";

// 译文由 W2 的 use-translations 取;这里换成可控的假实现,只测 W1 的接线与渲染(R-L32)
const tr = vi.hoisted(() => ({
  state: { pending: new Set<number>(), notice: null as null | "limited" | "failed", retry: vi.fn() },
  args: null as null | UseTranslationsArgs,
}));
vi.mock("./use-translations", () => ({
  useTranslations: (args: UseTranslationsArgs) => {
    tr.args = args;
    return tr.state;
  },
}));

beforeEach(async () => {
  localStorage.clear();
  await setUiLanguage("zh-CN");
  tr.state.pending = new Set();
  tr.state.notice = null;
  tr.state.retry.mockClear();
  tr.args = null;
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await resetUiLanguage();
});

function render(detail: Record<string, unknown> | null, extra: Record<string, Handler> = {}, config: unknown = CONFIG_RAW) {
  const mock = createFetchMock({
    "GET /api/library/config": () => json(config),
    "GET /api/library/items/i1": () => (detail ? json(detail) : json({ error: "Not Found" }, 404)),
    "POST /api/library/items/i1/media-ticket": () => json({ url: TICKET, expires_in: 1800 }),
    "PATCH /api/library/items/i1": () => json({}),
    ...extra,
  });
  renderWithProviders(<LibraryPlayerPage />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/library/i1", path: "/library/:id" });
  return mock;
}

describe("LibraryPlayerPage (spec §11.4)", () => {
  it("goes back to the practice page when the library is off", async () => {
    render(detailRaw(), {}, CONFIG_OFF_RAW);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/practice"));
  });

  it("only explains an item that is not ready, without asking for a ticket", async () => {
    const mock = render(detailRaw({ status: "processing", segments: [] }));
    expect(await screen.findByText("这条素材还在处理中。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "回到跟读库" })).toHaveAttribute("href", "/library");
    expect(mock.calls.some((c) => c.url.pathname.endsWith("/media-ticket"))).toBe(false);
  });

  it("shows a clear gone state for a deleted item, does not retry, and tells the list to drop it", async () => {
    resetGoneItems();
    const mock = render(null);
    expect(await screen.findByTestId("library-gone")).toHaveTextContent("这条素材已不存在");
    expect(screen.getByRole("link", { name: "回到跟读库" })).toHaveAttribute("href", "/library");
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
    await new Promise((r) => setTimeout(r, 100));
    expect(mock.calls.filter((c) => c.url.pathname === "/api/library/items/i1")).toHaveLength(1);
    expect(isItemGone("i1")).toBe(true);
    resetGoneItems();
  });

  it("keeps the retry error for other failures", async () => {
    render(null, { "GET /api/library/items/i1": () => json({ error: "boom" }, 500) });
    expect(await screen.findByTestId("library-error")).toBeInTheDocument();
    expect(screen.queryByTestId("library-gone")).toBeNull();
  });

  it("plays a ready video inline from the ticket URL with its sentences and restores the position", async () => {
    const consoleSpy = vi.spyOn(console, "log");
    render(detailRaw({ resume_ms: 4000, resume_idx: 1 }));
    const video = await screen.findByTestId("library-media");
    await waitFor(() => expect(video).toHaveAttribute("src", TICKET));
    expect(video.tagName).toBe("VIDEO");
    expect(video).toHaveAttribute("playsinline");
    expect(video).not.toHaveAttribute("controls");
    expect(screen.getByText("How are you today?")).toBeInTheDocument();
    fireEvent(video, new Event("loadedmetadata"));
    await waitFor(() => expect((video as HTMLVideoElement).currentTime).toBe(4));
    expect(screen.getByTestId("segment-1")).toHaveAttribute("aria-current", "true");
    expect(consoleSpy.mock.calls.flat().join(" ")).not.toContain("secret-ticket");
  });

  it("is a library surface with a tint top bar and exactly two library blur layers (R-L26, R-L33)", async () => {
    render(detailRaw());
    await screen.findByTestId("library-media");
    expect(document.querySelector(".library-root.lib-page.lib-player")).not.toBeNull();
    // 控制胶囊 + 渐进模糊 = 2 层;全站底栏是第 3 层;压在视频上的顶栏胶囊不模糊
    expect(document.querySelectorAll(".lib-glass, .lib-gblur")).toHaveLength(2);
    expect(screen.getByTestId("library-controls").className).toMatch(/\blib-glass\b/);
    const bar = document.querySelector(".lib-bar") as HTMLElement;
    expect(bar.className).not.toMatch(/lib-glass/);
    expect(bar.querySelector("a")).toHaveAttribute("href", "/library");
    expect(within(bar).getByRole("heading", { name: "Lecture 1" })).toBeInTheDocument();
    expect(screen.getByTestId("library-segments").className).toMatch(/\blib-segments\b/);
  });

  it("puts the controls inside the player root, over the list, as a floating capsule (R-L33)", async () => {
    render(detailRaw());
    await screen.findByTestId("library-media");
    const controls = screen.getByTestId("library-controls");
    expect(controls.className).toMatch(/\blib-ctrl\b/);
    expect(controls.closest(".lib-player")).not.toBeNull();
  });

  it("opens an elastic speed slider that snaps to four steps and saves rate_pct", async () => {
    const mock = render(detailRaw());
    const chip = await screen.findByTestId("library-rate");
    await waitFor(() => expect(chip).not.toBeDisabled());
    expect(chip).toHaveAccessibleName("速度 1 倍");
    expect(screen.queryByRole("slider")).toBeNull();
    fireEvent.click(chip);
    const slider = screen.getByRole("slider", { name: "播放速度" });
    expect(slider).toHaveAttribute("aria-valuenow", "1");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider).toHaveAttribute("aria-valuenow", "1.25");
    expect(chip).toHaveAccessibleName("速度 1.25 倍");
    await waitFor(() => expect(mock.calls.some((c) => c.method === "PATCH" && JSON.parse(String(c.body)).rate_pct === 125)).toBe(true));
    fireEvent.keyDown(slider, { key: "ArrowRight" }); // 已在最高档,不再改
    expect(slider).toHaveAttribute("aria-valuenow", "1.25");
    fireEvent.click(chip);
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("closes the speed slider with Escape or a tap elsewhere", async () => {
    render(detailRaw());
    const chip = await screen.findByTestId("library-rate");
    await waitFor(() => expect(chip).not.toBeDisabled());
    fireEvent.click(chip);
    expect(screen.getByRole("slider")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("slider")).toBeNull();
    fireEvent.click(chip);
    fireEvent.pointerDown(screen.getByTestId("library-segments"));
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("cycles the loop modes and toggles blind listening", async () => {
    render(detailRaw());
    const loop = await screen.findByTestId("library-loop");
    await waitFor(() => expect(loop).not.toBeDisabled());
    expect(loop).toHaveAccessibleName("关闭循环");
    fireEvent.click(loop);
    expect(loop).toHaveAccessibleName("单句循环");
    expect(loop).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(loop);
    expect(loop).toHaveAccessibleName("每句循环 3 遍");
    fireEvent.click(screen.getByTestId("library-blind"));
    expect(screen.queryByText("Hello there.")).toBeNull();
    expect(screen.getAllByRole("button", { name: "显示这句" })).toHaveLength(3);
  });

  it("shows audio items with an icon and a hidden audio element", async () => {
    render(detailRaw({ kind: "audio" }));
    const audio = await screen.findByTestId("library-media");
    expect(audio.tagName).toBe("AUDIO");
    expect(screen.getByText("音频")).toBeInTheDocument();
  });

  it("shows the cover of an audio item that has one, 16:9, with the audio element kept (R-W4)", async () => {
    URL.createObjectURL = vi.fn(() => "blob:poster-a");
    URL.revokeObjectURL = vi.fn();
    const mock = render(detailRaw({ kind: "audio", has_poster: true }), {
      "GET /api/library/items/i1/poster": () => new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/jpeg" } }),
    });
    const img = await waitFor(() => {
      const el = document.querySelector("img.lib-stage-poster");
      expect(el).not.toBeNull();
      return el as HTMLImageElement;
    });
    expect(img).toHaveAttribute("src", "blob:poster-a");
    expect(img).toHaveAttribute("alt", "");
    expect(document.querySelector(".lib-stage-audio.has-poster")).not.toBeNull();
    expect(screen.getByTestId("library-media").tagName).toBe("AUDIO");
    expect(mock.calls.some((c) => c.url.pathname === "/api/library/items/i1/poster")).toBe(true);
  });

  it("a featured copy of a video plays in a <video> with its cover (plan 2026-10-15-catalog-keep-video)", async () => {
    URL.createObjectURL = vi.fn(() => "blob:poster-v");
    URL.revokeObjectURL = vi.fn();
    render(detailRaw({ kind: "video", source: "catalog", catalog_id: "c1", has_poster: true, library_bytes: 0 }), {
      "GET /api/library/items/i1/poster": () => new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/jpeg" } }),
    });
    const video = await screen.findByTestId("library-media");
    expect(video.tagName).toBe("VIDEO");
    await waitFor(() => expect(video).toHaveAttribute("src", TICKET));
    await waitFor(() => expect(video).toHaveAttribute("poster", "blob:poster-v"));
    expect(document.querySelector(".lib-stage-audio")).toBeNull();
  });

  it("an audio item without a cover keeps the icon stage and asks for no poster", async () => {
    const mock = render(detailRaw({ kind: "audio", has_poster: false }));
    await screen.findByTestId("library-media");
    expect(screen.getByText("音频")).toBeInTheDocument();
    expect(document.querySelector("img.lib-stage-poster")).toBeNull();
    expect(mock.calls.some((c) => c.url.pathname.endsWith("/poster"))).toBe(false);
  });
});

describe("low-confidence notice (D5)", () => {
  it("tells the learner the sentence boundaries may be off, only when the server flagged the item", async () => {
    render(detailRaw({ low_confidence: true }));
    expect(await screen.findByTestId("library-lowconf-notice")).toHaveTextContent("句边界可能不准,可重新识别或微调");
    cleanup();
    render(detailRaw());
    await screen.findByTestId("library-media");
    expect(screen.queryByTestId("library-lowconf-notice")).toBeNull();
  });
});

describe("translation line and switch (D8, E12, R-L32)", () => {
  it("offers the switch, on by default (D8), when the server has AI on and the UI language has a native target", async () => {
    render(detailRaw());
    const chip = await screen.findByTestId("library-translate");
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip).toHaveAccessibleName("隐藏译文");
  });

  it("hides the switch when the administrator turned AI off and nothing is stored", async () => {
    render(detailRaw({ segments: SEGMENTS_RAW.map((s): Record<string, unknown> => ({ ...s, zh: null, zh_lang: null })) }), {}, { ...CONFIG_RAW, ai: false });
    await screen.findByTestId("library-media");
    expect(screen.queryByTestId("library-translate")).toBeNull();
    expect(tr.args?.enabled).toBe(false); // default-on never fetches when library_ai is off
  });

  it("with AI off, stored translations (featured copies) still show through the switch and nothing is requested (R-W6)", async () => {
    render(detailRaw({ source: "catalog" }), {}, { ...CONFIG_RAW, ai: false });
    const chip = await screen.findByTestId("library-translate");
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("你今天好吗?")).toBeInTheDocument();
    expect(tr.args?.enabled).toBe(false);
  });

  it("with AI off, a stored translation in another language does not open the switch", async () => {
    render(detailRaw({ segments: SEGMENTS_RAW.map((s) => ({ ...s, zh_lang: s.zh ? "es-ES" : null })) }), {}, { ...CONFIG_RAW, ai: false });
    await screen.findByTestId("library-media");
    expect(screen.queryByTestId("library-translate")).toBeNull();
  });

  it("hides the switch in the English UI (nothing to translate into, like chat R16)", async () => {
    await setUiLanguage("en");
    render(detailRaw());
    await screen.findByTestId("library-media");
    expect(screen.queryByTestId("library-translate")).toBeNull();
  });

  it("turns the translation off, remembers the choice per item and stops fetching", async () => {
    render(detailRaw({ resume_idx: 1 }));
    const chip = await screen.findByTestId("library-translate");
    expect(tr.args).toMatchObject({ itemId: "i1", enabled: true, native: "zh-CN", anchorIdx: 1 });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(chip).toHaveAccessibleName("显示译文");
    expect(tr.args).toMatchObject({ enabled: false });
    expect(JSON.parse(localStorage.getItem(ON_KEY)!)).toBe(false);
    fireEvent.click(chip);
    expect(JSON.parse(localStorage.getItem(ON_KEY)!)).toBe(true);
  });

  it("stays off for an item the learner turned off earlier", async () => {
    localStorage.setItem(ON_KEY, "false");
    render(detailRaw());
    await screen.findByTestId("library-media");
    expect(tr.args?.enabled).toBe(false);
    expect(screen.queryByTestId("segment-zh-1")).toBeNull();
  });

  it("starts with the remembered switch and shows stored translations under their sentences", async () => {
    localStorage.setItem(ON_KEY, "true");
    render(detailRaw());
    await screen.findByTestId("library-media");
    expect(tr.args?.enabled).toBe(true);
    expect(screen.getByTestId("segment-zh-1")).toHaveTextContent("你今天好吗?");
    expect(screen.getByTestId("segment-zh-1")).toHaveAttribute("lang", "zh-CN");
    expect(screen.queryByTestId("segment-zh-0")).toBeNull();
    fireEvent.click(screen.getByTestId("library-translate"));
    expect(screen.queryByTestId("segment-zh-1")).toBeNull();
  });

  it("merges freshly fetched translations into the sentences", async () => {
    localStorage.setItem(ON_KEY, "true");
    render(detailRaw());
    await screen.findByTestId("library-media");
    expect(screen.queryByTestId("segment-zh-0")).toBeNull();
    act(() => tr.args!.onTranslated([{ idx: 0, zh: "你好。" }, { idx: 2, zh: "我很好,谢谢。" }]));
    expect(screen.getByTestId("segment-zh-0")).toHaveTextContent("你好。");
    expect(screen.getByTestId("segment-zh-2")).toHaveTextContent("我很好,谢谢。");
    expect(screen.getByTestId("segment-zh-1")).toHaveTextContent("你今天好吗?");
  });

  it("shows a skeleton for sentences being fetched and hides translations in blind mode", async () => {
    localStorage.setItem(ON_KEY, "true");
    tr.state.pending = new Set([0]);
    render(detailRaw());
    await screen.findByTestId("library-media");
    expect(screen.getByTestId("segment-zh-skeleton-0")).toBeInTheDocument();
    expect(screen.queryByTestId("segment-zh-skeleton-2")).toBeNull();
    fireEvent.click(screen.getByTestId("library-blind"));
    expect(screen.queryByTestId("segment-zh-1")).toBeNull();
    expect(screen.queryByTestId("segment-zh-skeleton-0")).toBeNull();
  });

  it("shows one fixed note when the allowance is spent or a fetch failed, and retry reaches the fetcher", async () => {
    localStorage.setItem(ON_KEY, "true");
    tr.state.notice = "limited";
    render(detailRaw());
    expect(await screen.findByTestId("library-translate-notice")).toHaveTextContent("今天的译文额度已用完,播放和跟读不受影响。");
    cleanup();
    tr.state.notice = "failed";
    render(detailRaw());
    const notice = await screen.findByTestId("library-translate-notice");
    expect(notice).toHaveTextContent("暂时无法生成译文。");
    fireEvent.click(within(notice).getByRole("button", { name: "重试" }));
    expect(tr.state.retry).toHaveBeenCalledTimes(1);
  });

  it("does not show the note while the translation switch is off", async () => {
    tr.state.notice = "limited";
    localStorage.setItem(ON_KEY, "false");
    render(detailRaw());
    await screen.findByTestId("library-media");
    expect(screen.queryByTestId("library-translate-notice")).toBeNull();
  });
});
