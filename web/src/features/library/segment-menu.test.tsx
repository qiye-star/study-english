import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "~/i18n";
import "./locales";
import type { SaveSentenceState } from "./save-sentence";
import { SegmentMenu, copySentence, type SegmentMenuProps } from "./segment-menu";

const toastApi = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastApi, Toaster: (): null => null }));

function Harness(over: Partial<SegmentMenuProps> & { save?: SaveSentenceState }) {
  const [open, setOpen] = useState(false);
  const props: SegmentMenuProps = {
    idx: 2, text: "Hello world.", aiEnabled: true, analysisOpen: false, busy: false,
    save: { state: "idle", save: vi.fn(async () => true) }, onAnalysis: vi.fn(), onEdit: vi.fn(),
    ...over, open, onOpenChange: setOpen,
  };
  return (
    <>
      <p data-segment-text="2">Hello world.</p>
      <SegmentMenu {...props} />
    </>
  );
}

const open = async () => {
  await userEvent.click(screen.getByTestId("shadow-more"));
  return screen.findByTestId("segment-menu");
};
const setClipboard = (value: unknown) => Object.defineProperty(navigator, "clipboard", { value, configurable: true });

describe("SegmentMenu (spec §11.4, plan W2 R-SH26)", () => {
  beforeEach(() => {
    Object.values(toastApi).forEach((fn) => fn.mockClear());
    setClipboard(undefined);
  });
  afterEach(() => {
    document.getSelection()?.removeAllRanges();
  });

  it("opens an action sheet with copy, analysis, add to practice and adjust", async () => {
    render(<Harness />);
    expect(screen.getByTestId("shadow-more")).toHaveAccessibleName(i18n.t("web.library.shadow.more"));
    await open();
    for (const id of ["menu-copy", "menu-analysis", "menu-save", "menu-edit"]) expect(screen.getByTestId(id)).toBeInTheDocument();
  });

  it("hides the analysis item when the AI features are off", async () => {
    render(<Harness aiEnabled={false} />);
    await open();
    expect(screen.queryByTestId("menu-analysis")).toBeNull();
    expect(screen.getByTestId("menu-copy")).toBeInTheDocument();
  });

  it("copies the sentence to the clipboard and closes", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    render(<Harness />);
    await open();
    await userEvent.click(screen.getByTestId("menu-copy"));
    expect(writeText).toHaveBeenCalledWith("Hello world.");
    await waitFor(() => expect(toastApi.success).toHaveBeenCalledWith(i18n.t("web.library.shadow.menu.copied")));
    await waitFor(() => expect(screen.queryByTestId("segment-menu")).toBeNull());
  });

  it("falls back to selecting the sentence when the clipboard refuses", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    render(<Harness />);
    await open();
    await userEvent.click(screen.getByTestId("menu-copy"));
    await waitFor(() => expect(toastApi.info).toHaveBeenCalledWith(i18n.t("web.library.shadow.menu.copySelected")));
    expect(document.getSelection()!.toString()).toBe("Hello world.");
  });

  it("says so when it can neither copy nor select", async () => {
    expect(await copySentence("Nothing here.", 99)).toBe("failed");
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    expect(await copySentence("Hello world.", 99)).toBe("copied");
    setClipboard(undefined);
    expect(await copySentence("Hello world.", 2)).toBe("failed"); // 没有 data-segment-text="2" 的元素
  });

  it("toggles the analysis card and closes the sheet", async () => {
    const onAnalysis = vi.fn();
    const { rerender } = render(<Harness onAnalysis={onAnalysis} />);
    await open();
    expect(screen.getByTestId("menu-analysis")).toHaveTextContent(i18n.t("web.library.shadow.menu.analysis"));
    await userEvent.click(screen.getByTestId("menu-analysis"));
    expect(onAnalysis).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId("segment-menu")).toBeNull());
    rerender(<Harness onAnalysis={onAnalysis} analysisOpen />);
    await open();
    expect(screen.getByTestId("menu-analysis")).toHaveTextContent(i18n.t("web.library.shadow.menu.analysisClose"));
  });

  it("disables analysis and adjusting while recording or scoring, but still copies and saves", async () => {
    const onEdit = vi.fn();
    render(<Harness busy onEdit={onEdit} />);
    await open();
    expect(screen.getByTestId("menu-analysis")).toBeDisabled();
    expect(screen.getByTestId("menu-edit")).toBeDisabled();
    expect(screen.getByTestId("menu-copy")).not.toBeDisabled();
    expect(screen.getByTestId("menu-save")).not.toBeDisabled();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("opens the editor from the menu", async () => {
    const onEdit = vi.fn();
    render(<Harness onEdit={onEdit} />);
    await open();
    await userEvent.click(screen.getByTestId("menu-edit"));
    expect(onEdit).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId("segment-menu")).toBeNull());
  });

  it("saves to the practice list, keeps the sheet for the spark, then closes it", async () => {
    const save: SaveSentenceState = { state: "idle", save: vi.fn(async () => true) };
    render(<Harness save={save} />);
    await open();
    await userEvent.click(screen.getByTestId("menu-save"));
    expect(save.save).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("segment-menu")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("segment-menu")).toBeNull(), { timeout: 3000 });
  });

  it("closes at once when saving fails, and shows the saved state afterwards", async () => {
    const failing: SaveSentenceState = { state: "idle", save: vi.fn(async () => false) };
    const { rerender } = render(<Harness save={failing} />);
    await open();
    await userEvent.click(screen.getByTestId("menu-save"));
    await waitFor(() => expect(screen.queryByTestId("segment-menu")).toBeNull(), { timeout: 400 });
    rerender(<Harness save={{ state: "saved", save: vi.fn(async () => true) }} />);
    await open();
    expect(screen.getByTestId("menu-save")).toHaveTextContent(i18n.t("web.library.shadow.saved"));
  });
});
