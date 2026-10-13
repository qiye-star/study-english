import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setUiLanguage } from "./test-i18n";
import { ItemMenu } from "./item-menu";
import type { LibraryItem } from "./library-api";

const item: LibraryItem = {
  id: "i1", kind: "audio", source: "upload", title: "Pod", status: "ready", stage: null, progress: 100, errorKind: null, durationMs: 60_000,
  segCount: 4, libraryBytes: 1000, subSource: "asr", resumeMs: 0, resumeIdx: 0, ratePct: 100, hasPoster: false, lowConfidence: false,
  createdAt: "2026-10-13T08:00:00Z", lastOpenedAt: null,
};

beforeEach(async () => {
  await setUiLanguage("zh-CN");
});

describe("ItemMenu (D7)", () => {
  it("opens an action sheet from the more button and hands the item to onReprocess, closing first", async () => {
    const onReprocess = vi.fn();
    render(<ItemMenu item={item} onReprocess={onReprocess} />);
    const more = screen.getByTestId("library-item-more-i1");
    expect(more).toHaveAccessibleName("更多");
    expect(more).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(more);
    expect(await screen.findByTestId("library-item-menu")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("menu-reprocess"));
    expect(onReprocess).toHaveBeenCalledWith(expect.objectContaining({ id: "i1" }));
    expect(screen.queryByTestId("library-item-menu")).toBeNull();
  });
});
