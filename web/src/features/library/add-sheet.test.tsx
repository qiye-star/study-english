import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setUiLanguage } from "./test-i18n";
import { renderWithProviders } from "~/test/render";
import { AddSheet } from "./add-sheet";
import type { LibraryConfig } from "./library-api";

const CONFIG: LibraryConfig = {
  enabled: true, linkImport: false, asr: true, ai: false, catalog: false,
  limits: { maxUploadMb: 500, maxDurationMinutes: 90, quotaMb: 2000, usedBytes: 0, maxItems: 100, chunkBytes: 8388608, formats: ["mp4", "mp3"] },
};

beforeEach(async () => {
  await setUiLanguage("zh-CN");
});

describe("AddSheet (spec §11.3)", () => {
  it("opens on the upload tab and switches to the link tab", () => {
    renderWithProviders(<AddSheet open onOpenChange={vi.fn()} config={CONFIG} onUpload={vi.fn()} onImported={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "添加素材" })).toBeInTheDocument();
    expect(screen.getByTestId("library-upload-form")).toBeInTheDocument();
    expect(screen.getByTestId("library-upload-file")).toHaveAttribute("accept", "audio/*,video/*,.mp4,.mp3");
    expect(screen.getByText("单个最大 500 MB,最长 90 分钟")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("library-tab-link"));
    expect(screen.getByTestId("library-link-disabled")).toBeInTheDocument();
  });

  it("is a floating glass sheet scoped to the library tokens, so the portal still gets the variables (D11)", () => {
    renderWithProviders(<AddSheet open onOpenChange={vi.fn()} config={CONFIG} onUpload={vi.fn()} onImported={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toMatch(/\blibrary-root\b/);
    expect(dialog.className).toMatch(/\blib-sheet\b/);
  });
  it("restyles the tabs as a full-width glass segmented control (R-A8)", () => {
    renderWithProviders(<AddSheet open onOpenChange={vi.fn()} config={CONFIG} onUpload={vi.fn()} onImported={vi.fn()} />);
    const group = screen.getByRole("radiogroup", { name: "来源" });
    expect(group.className).toMatch(/\blib-seg\b/);
    expect(group.className).toMatch(/\bw-full\b/);
    expect(screen.getByTestId("library-tab-upload").className).toMatch(/\bflex-1\b/);
    expect(screen.getByTestId("library-tab-link").className).toMatch(/\bflex-1\b/);
  });

  it("shows the pick tile instead of a bare file input on the upload tab, formats and limits included (R-A3)", () => {
    renderWithProviders(<AddSheet open onOpenChange={vi.fn()} config={CONFIG} onUpload={vi.fn()} onImported={vi.fn()} />);
    expect(screen.getByTestId("library-upload-file-tile")).toBeInTheDocument();
    expect(screen.getByText("选择视频或音频")).toBeInTheDocument();
    expect(screen.getByText("格式:mp4 · mp3")).toBeInTheDocument();
    expect(screen.getByTestId("library-upload-file").className).toMatch(/\blib-pick-input\b/);
  });

  it("keeps the link tab on the same glass style, notices included", () => {
    renderWithProviders(<AddSheet open onOpenChange={vi.fn()} config={{ ...CONFIG, linkImport: true }} onUpload={vi.fn()} onImported={vi.fn()} />);
    fireEvent.click(screen.getByTestId("library-tab-link"));
    expect(screen.getByTestId("library-drm-note").className).toMatch(/\blib-note\b/);
    expect(screen.getByLabelText("视频页面链接").className).toMatch(/\blib-ffield-input\b/);
  });
});
