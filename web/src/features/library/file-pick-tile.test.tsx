import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FilePickTile, type FilePickTileProps } from "./file-pick-tile";

const file = (name: string, size = 100, type = "") => new File([new Uint8Array(size)], name, { type });

function setup(over: Partial<FilePickTileProps> = {}) {
  const onFile = vi.fn();
  const utils = render(
    <FilePickTile file={null} onFile={onFile} accept="audio/*,video/*,.mp4" inputTestId="pick" label="Media file" title="Choose media"
      dropLabel="Drop here" dragHint="or drag" replaceLabel="Replace" removeLabel="Remove" {...over}>
      <span>hint line</span>
    </FilePickTile>,
  );
  return { onFile, input: screen.getByTestId("pick") as HTMLInputElement, ...utils };
}

describe("FilePickTile: empty state (R-A3)", () => {
  it("keeps the real file input in the DOM, visually hidden but focusable, and shows the tile", () => {
    const { input } = setup();
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "audio/*,video/*,.mp4");
    expect(input).toHaveAttribute("aria-label", "Media file");
    expect(input.className).toMatch(/\blib-pick-input\b/);
    expect(input).not.toHaveAttribute("hidden");
    expect(input).not.toBeDisabled();
    expect(input.tabIndex).toBe(0);
    expect(screen.getByTestId("pick-tile").className).toMatch(/\blib-spot\b/);
    expect(screen.getByText("Choose media")).toBeInTheDocument();
    expect(screen.getByText("hint line")).toBeInTheDocument();
    expect(screen.getByText("or drag")).toBeInTheDocument();
    expect(screen.queryByTestId("pick-card")).toBeNull();
  });

  it("opens the picker through the label (a native activation, so iOS opens it inside the tap)", () => {
    const { input } = setup();
    const onClick = vi.fn();
    input.addEventListener("click", onClick);
    const face = screen.getByText("Choose media").closest("label") as HTMLLabelElement;
    expect(face).toHaveAttribute("for", input.id);
    fireEvent.click(screen.getByText("Choose media"));
    expect(onClick).toHaveBeenCalledTimes(1); // jsdom 转发 label 点击;若这一句在 jsdom 里不成立,只保留上面的 for 断言
  });

  it("is reachable by keyboard: Tab lands on the real input", async () => {
    const { input } = setup();
    const user = userEvent.setup();
    await user.tab();
    expect(input).toHaveFocus();
    const onClick = vi.fn();
    input.addEventListener("click", onClick);
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalled(); // user-event 把空格当作点击;若它不处理文件框,删掉这一句(原生行为靠真机清单验证)
  });

  it("hands the chosen file up, clears the input value and ignores an empty change (R-A4)", () => {
    const { input, onFile } = setup();
    const f = file("a.mp4");
    fireEvent.change(input, { target: { files: [f] } });
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile).toHaveBeenCalledWith(f);
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { files: [] } });
    expect(onFile).toHaveBeenCalledTimes(1);
  });
});

describe("FilePickTile: drag and drop (R-A5)", () => {
  it("highlights while a file is dragged over, and resets on leave", () => {
    setup();
    const drop = screen.getByTestId("pick-drop");
    fireEvent.dragOver(drop, { dataTransfer: { types: ["Files"] } });
    expect(drop).toHaveAttribute("data-drag");
    expect(screen.getByText("Drop here")).toBeInTheDocument();
    expect(screen.queryByText("Choose media")).toBeNull();
    fireEvent.dragLeave(drop);
    expect(drop).not.toHaveAttribute("data-drag");
    expect(screen.getByText("Choose media")).toBeInTheDocument();
  });

  it("takes only the first dropped file", () => {
    const { onFile } = setup();
    const a = file("a.mp4");
    const b = file("b.mp4");
    fireEvent.drop(screen.getByTestId("pick-drop"), { dataTransfer: { types: ["Files"], files: [a, b] } });
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile).toHaveBeenCalledWith(a);
    expect(screen.getByTestId("pick-drop")).not.toHaveAttribute("data-drag");
  });

  it("passes a dropped file of the wrong type up too, so validation can say so", () => {
    const { onFile } = setup();
    const exe = file("a.exe");
    fireEvent.drop(screen.getByTestId("pick-drop"), { dataTransfer: { types: ["Files"], files: [exe] } });
    expect(onFile).toHaveBeenCalledWith(exe);
  });

  it("ignores drags that are not files (text, links)", () => {
    const { onFile } = setup();
    const drop = screen.getByTestId("pick-drop");
    fireEvent.dragOver(drop, { dataTransfer: { types: ["text/plain"] } });
    expect(drop).not.toHaveAttribute("data-drag");
    fireEvent.drop(drop, { dataTransfer: { types: ["text/plain"], files: [] } });
    expect(onFile).not.toHaveBeenCalled();
  });

  it("does nothing while disabled", () => {
    const { onFile, input } = setup({ disabled: true });
    const drop = screen.getByTestId("pick-drop");
    expect(input).toBeDisabled();
    fireEvent.dragOver(drop, { dataTransfer: { types: ["Files"] } });
    expect(drop).not.toHaveAttribute("data-drag");
    fireEvent.drop(drop, { dataTransfer: { types: ["Files"], files: [file("a.mp4")] } });
    expect(onFile).not.toHaveBeenCalled();
  });
});

describe("FilePickTile: chosen state", () => {
  it("shows a file card with the name (ellipsized by CSS, full name in title), size and kind", () => {
    const { input } = setup({ file: file("A very long episode name.mp4", 1536) });
    const name = screen.getByText("A very long episode name.mp4");
    expect(name).toHaveAttribute("title", "A very long episode name.mp4");
    expect(name.className).toMatch(/\blib-pick-name\b/);
    expect(screen.getByText("1.5 KB")).toBeInTheDocument();
    expect(screen.getByTestId("pick-card")).toHaveAttribute("data-kind", "video");
    expect(screen.queryByTestId("pick-tile")).toBeNull();
    expect(screen.getByTestId("pick")).toBe(input); // 真实输入还在,「更换」复用它
  });

  it("uses the audio kind for audio files", () => {
    setup({ file: file("a.mp3") });
    expect(screen.getByTestId("pick-card")).toHaveAttribute("data-kind", "audio");
  });

  it("replaces through the same input, and still accepts a drop", () => {
    const { input, onFile } = setup({ file: file("a.mp4") });
    const onClick = vi.fn();
    input.addEventListener("click", onClick);
    const replace = screen.getByText("Replace");
    expect(replace.closest("label")).toHaveAttribute("for", input.id);
    fireEvent.click(replace);
    expect(onClick).toHaveBeenCalledTimes(1);
    const next = file("b.mp4");
    fireEvent.drop(screen.getByTestId("pick-drop"), { dataTransfer: { types: ["Files"], files: [next] } });
    expect(onFile).toHaveBeenCalledWith(next);
  });

  it("removes the file and puts the focus back on the real input", () => {
    const { input, onFile } = setup({ file: file("a.mp4") });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onFile).toHaveBeenCalledWith(null);
    expect(input).toHaveFocus();
  });

  it("marks a problem on the card and announces it, tied to the input", () => {
    const { input } = setup({ file: file("a.mp4"), problem: "Too big" });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Too big");
    expect(screen.getByTestId("pick-card")).toHaveAttribute("data-invalid");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", alert.id);
  });

  it("has no alert and no invalid mark without a problem", () => {
    const { input } = setup({ file: file("a.mp4") });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("pick-card")).not.toHaveAttribute("data-invalid");
    expect(input).not.toHaveAttribute("aria-invalid");
  });
});
