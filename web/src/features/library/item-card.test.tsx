import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "~/api/client";
import { setUiLanguage } from "./test-i18n";
import { renderWithProviders } from "~/test/render";
import { ItemCard, type ItemCardHandlers } from "./item-card";
import type { LibraryItem } from "./library-api";
import type { UploadJob } from "./upload-store";

const base: LibraryItem = {
  id: "i1", kind: "video", source: "upload", title: "Lecture 1", status: "ready", stage: null, progress: 100, errorKind: null,
  durationMs: 125_000, segCount: 3, libraryBytes: 5 * 1024 * 1024, subSource: "uploaded", resumeMs: 0, resumeIdx: 0, ratePct: 100, hasPoster: true, lowConfidence: false,
  createdAt: "2026-10-13T08:00:00Z", lastOpenedAt: null,
};
const handlers = (): ItemCardHandlers => ({
  onDelete: vi.fn(), onRetry: vi.fn(), onAddSubtitles: vi.fn(), onResumeUpload: vi.fn(), onCancelUpload: vi.fn(),
  onRetryUpload: vi.fn(), onDismissUpload: vi.fn(), onReprocess: vi.fn(),
});
const job = (over: Partial<UploadJob> = {}): UploadJob => ({
  key: "upload-1", itemId: "u1", filename: "Talk.mp4", title: "Talk", size: 10 * 1024 * 1024, sent: 4 * 1024 * 1024,
  state: "uploading", error: null, input: { file: new Blob(), filename: "Talk.mp4" }, ...over,
});
const card = (ui: Parameters<typeof ItemCard>[0]) => renderWithProviders(<ul><ItemCard {...ui} /></ul>);

beforeEach(async () => {
  await setUiLanguage("zh-CN");
});

describe("ItemCard · featured copy (curated library, R-W5)", () => {
  const copy: LibraryItem = { ...base, source: "catalog", catalogId: "c1", libraryBytes: 0, kind: "audio", subSource: "asr", rebuildable: true, hasPoster: true };

  it("shows the 精选 badge and 不占空间 instead of the size, status and subtitle badges", () => {
    card({ item: copy, ...handlers(), onRebuild: vi.fn() });
    expect(screen.getByText("精选")).toBeInTheDocument();
    expect(screen.getByText("2:05 · 3 句 · 不占空间")).toBeInTheDocument();
    expect(screen.queryByText("已就绪")).toBeNull();
    expect(screen.queryByText("自动识别")).toBeNull();
  });

  it("has no ⋯ menu at all, even when the server allows re-recognition and the item looks re-splittable", () => {
    card({ item: copy, ...handlers(), onRebuild: vi.fn() });
    expect(screen.queryByTestId("library-item-more-i1")).toBeNull();
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
  });

  it("a copy of a video keeps the badge, 不占空间 and has no ⋯ menu", () => {
    card({ item: { ...copy, kind: "video" }, ...handlers(), onRebuild: vi.fn() });
    expect(screen.getByText("精选")).toBeInTheDocument();
    expect(screen.getByText("2:05 · 3 句 · 不占空间")).toBeInTheDocument();
    expect(screen.queryByTestId("library-item-more-i1")).toBeNull();
  });

  it("a recognized own item still has the menu (control)", () => {
    card({ item: { ...base, subSource: "asr" }, ...handlers() });
    expect(screen.getByTestId("library-item-more-i1")).toBeInTheDocument();
    expect(screen.queryByText("精选")).toBeNull();
  });
});

describe("ItemCard (spec §11.2, R-L12)", () => {
  it("links a ready item to its player and shows duration, sentences, size and subtitle source", () => {
    card({ item: base, ...handlers() });
    expect(screen.getByRole("link", { name: /Lecture 1/ })).toHaveAttribute("href", "/library/i1");
    expect(screen.getByText("2:05 · 3 句 · 5.0 MB")).toBeInTheDocument();
    expect(screen.getByText("上传字幕")).toBeInTheDocument();
  });

  it("shows stage and progress while processing, with no link", () => {
    card({ item: { ...base, status: "processing", stage: "transcode", progress: 40 }, ...handlers() });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("progressbar", { name: "转码中" })).toHaveAttribute("aria-valuenow", "40");
    expect(screen.getByText("转码中 · 40%")).toBeInTheDocument();
  });

  it("explains a missing-subtitles failure and offers subtitles but not retry", () => {
    const h = handlers();
    card({ item: { ...base, status: "failed", errorKind: "no_subtitles" }, ...h });
    expect(screen.getByTestId("library-item-reason")).toHaveTextContent("这条没有字幕");
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "补传字幕" }));
    expect(h.onAddSubtitles).toHaveBeenCalled();
  });

  it("puts 'download and upload' first for blocked links and offers retry", () => {
    const h = handlers();
    card({ item: { ...base, source: "link", status: "failed", errorKind: "blocked" }, ...h });
    expect(screen.getByTestId("library-item-reason").textContent).toMatch(/^网站拒绝了服务器的访问.*最稳的办法:在你自己的设备上下载后上传文件/);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(h.onRetry).toHaveBeenCalled();
  });

  it("offers to continue an unfinished upload from another session", () => {
    const h = handlers();
    card({ item: { ...base, status: "uploading", durationMs: null, libraryBytes: 0 }, ...h });
    fireEvent.click(screen.getByRole("button", { name: "继续上传" }));
    expect(h.onResumeUpload).toHaveBeenCalled();
  });

  it("shows local upload progress with cancel instead of delete", () => {
    const h = handlers();
    card({ item: null, job: job(), ...h });
    expect(screen.getByText("上传中 40%")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(h.onCancelUpload).toHaveBeenCalled();
  });

  it("shows a failed local upload with a translated reason, retry and dismiss", () => {
    const h = handlers();
    card({ item: null, job: job({ state: "failed", error: new ApiError(0, "Network error") }), ...h });
    expect(screen.getByRole("alert")).toHaveTextContent("上传中断:");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(h.onRetryUpload).toHaveBeenCalled();
    expect(h.onDismissUpload).toHaveBeenCalled();
  });

  it("deletes through the handler", () => {
    const h = handlers();
    card({ item: { ...base, status: "canceled" }, ...h });
    expect(screen.getByText("已取消")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(h.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "i1" }));
  });

  it("shows the processing stages as a stepper with the current stage marked and a shiny status line (D11)", () => {
    card({ item: { ...base, status: "processing", stage: "transcribe", progress: 62 }, ...handlers() });
    const steps = [...document.querySelectorAll(".lib-step")].map((el) => el.getAttribute("data-state"));
    expect(steps).toEqual(["done", "done", "done", "now", "todo"]);
    expect(document.querySelector(".lib-shiny")).toHaveTextContent("转写中 · 62%");
    expect(screen.getByRole("progressbar", { name: "转写中" })).toHaveAttribute("aria-valuenow", "62");
  });

  it("uses the six-stage stepper for links, with the download step second", () => {
    card({ item: { ...base, source: "link", status: "processing", stage: "fetch", progress: 20 }, ...handlers() });
    expect([...document.querySelectorAll(".lib-step")].map((el) => el.getAttribute("data-state"))).toEqual(["done", "now", "todo", "todo", "todo", "todo"]);
  });

  it("shows a queued item with no stage as not started", () => {
    card({ item: { ...base, status: "queued", stage: null, progress: 0 }, ...handlers() });
    expect([...document.querySelectorAll(".lib-step")].every((el) => el.getAttribute("data-state") === "todo")).toBe(true);
    expect(screen.getByRole("progressbar", { name: "排队中" })).toBeInTheDocument();
  });

  it("is a spotlight card that rises in with a staggered delay, capped so a long list does not wait seconds", () => {
    const first = card({ item: base, index: 3, ...handlers() });
    const surface = screen.getByTestId("library-item-i1").firstElementChild as HTMLElement;
    expect(surface.className).toMatch(/\blib-rise\b/);
    expect(surface.className).toMatch(/\blib-spot\b/);
    expect(surface.style.getPropertyValue("--lib-delay")).toBe("0.21s");
    first.unmount();
    card({ item: base, index: 40, ...handlers() });
    expect((screen.getByTestId("library-item-i1").firstElementChild as HTMLElement).style.getPropertyValue("--lib-delay")).toBe("0.56s");
  });

  it("labels a ready item with a status badge next to the subtitle source", () => {
    card({ item: base, ...handlers() });
    expect(screen.getByText("可以跟读")).toBeInTheDocument();
    expect(screen.getByText("上传字幕")).toBeInTheDocument();
  });

  it("draws local upload progress with the quota-bar styles", () => {
    card({ item: null, job: job(), ...handlers() });
    const bar = screen.getByRole("progressbar", { name: "上传中 40%" });
    expect(bar.className).toMatch(/\blib-quota-bar\b/);
    expect((bar.firstElementChild as HTMLElement).style.getPropertyValue("--p")).toBe("0.4");
  });

  it("offers re-recognition in the more menu only for ready, automatically recognized items", async () => {
    const h = handlers();
    card({ item: { ...base, subSource: "asr" }, ...h });
    fireEvent.click(screen.getByTestId("library-item-more-i1"));
    fireEvent.click(await screen.findByTestId("menu-reprocess"));
    expect(h.onReprocess).toHaveBeenCalledWith(expect.objectContaining({ id: "i1" }));
  });

  it("has no more menu for uploaded subtitles, non-ready items, or when the server offers no transcription", () => {
    card({ item: base, ...handlers() });
    expect(screen.queryByTestId("library-item-more-i1")).toBeNull();
    card({ item: { ...base, id: "i2", subSource: "asr", status: "processing", stage: "transcribe" }, ...handlers() });
    expect(screen.queryByTestId("library-item-more-i2")).toBeNull();
    const { onReprocess: _omitted, ...without } = handlers();
    card({ item: { ...base, id: "i3", subSource: "asr" }, ...without });
    expect(screen.queryByTestId("library-item-more-i3")).toBeNull();
  });

  it("tells the learner when the sentence boundaries may be off (D5)", () => {
    card({ item: { ...base, subSource: "asr", lowConfidence: true }, ...handlers() });
    expect(screen.getByTestId("library-item-lowconf")).toHaveTextContent("句边界可能不准,可重新识别或微调");
    expect(screen.getByText("边界可能不准")).toBeInTheDocument();
  });

  it("says a failed re-recognition kept the earlier sentences, with the translated reason", () => {
    card({ item: { ...base, subSource: "asr", errorKind: "quota" }, ...handlers() });
    expect(screen.getByTestId("library-item-reprocess-failed")).toHaveTextContent("重新识别没有成功,原来的句子还在:今天的自动转写额度已用完");
    expect(screen.getByRole("link", { name: /Lecture 1/ })).toBeInTheDocument(); // still playable
  });

  it("shows no notes on a clean ready item", () => {
    card({ item: base, ...handlers() });
    expect(screen.queryByTestId("library-item-lowconf")).toBeNull();
    expect(screen.queryByTestId("library-item-reprocess-failed")).toBeNull();
  });
});

describe("ItemCard re-splitting (plan v2 R-V16)", () => {
  it("shows the more menu for a rebuildable item even when the server has transcription off", async () => {
    const { onReprocess: _omitted, ...without } = handlers();
    const onRebuild = vi.fn();
    card({ item: { ...base, subSource: "asr", rebuildable: true }, ...without, onRebuild });
    fireEvent.click(screen.getByTestId("library-item-more-i1"));
    fireEvent.click(await screen.findByTestId("menu-rebuild"));
    expect(onRebuild).toHaveBeenCalledWith(expect.objectContaining({ id: "i1" }));
  });

  it("never offers re-splitting for subtitles or items without a kept recognition", () => {
    card({ item: { ...base, rebuildable: true }, ...handlers(), onRebuild: vi.fn() });
    expect(screen.queryByTestId("library-item-more-i1")).toBeNull();
  });
});
