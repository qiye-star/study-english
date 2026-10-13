import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SubtitlePicker, type SubtitlePickerProps } from "./subtitle-picker";

const file = (name: string, size = 100) => new File([new Uint8Array(size)], name);

function setup(over: Partial<SubtitlePickerProps> = {}) {
  const onFile = vi.fn();
  render(<SubtitlePicker file={null} onFile={onFile} inputTestId="subs" label="Subtitles (optional)" addLabel="Add" removeLabel="Remove subtitles" {...over} />);
  return { onFile, input: screen.getByTestId("subs") as HTMLInputElement };
}

describe("SubtitlePicker", () => {
  it("is a compact row with an Add chip that opens the real, visually hidden input", () => {
    const { input } = setup();
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", ".srt,.vtt");
    expect(input).toHaveAttribute("aria-label", "Subtitles (optional)");
    expect(input.className).toMatch(/\blib-pick-input\b/);
    expect(screen.getByText("Subtitles (optional)")).toBeInTheDocument();
    const add = screen.getByText("Add");
    expect(add.closest("label")).toHaveAttribute("for", input.id);
    expect(add.className).toMatch(/\blib-chip\b/);
    const onClick = vi.fn();
    input.addEventListener("click", onClick);
    fireEvent.click(add);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("hands the chosen file up and clears the input value; an empty change is ignored", () => {
    const { input, onFile } = setup();
    const f = file("a.srt");
    fireEvent.change(input, { target: { files: [f] } });
    expect(onFile).toHaveBeenCalledWith(f);
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { files: [] } });
    expect(onFile).toHaveBeenCalledTimes(1);
  });

  it("shows the chosen file name and size with a remove button that returns focus to the input", () => {
    const { input, onFile } = setup({ file: file("episode.srt", 2048) });
    expect(screen.getByText("episode.srt")).toHaveAttribute("title", "episode.srt");
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.queryByText("Add")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove subtitles" }));
    expect(onFile).toHaveBeenCalledWith(null);
    expect(input).toHaveFocus();
  });

  it("announces a problem in red text and marks the row", () => {
    const { input } = setup({ file: file("a.ass"), problem: "Must be .srt or .vtt" });
    expect(screen.getByRole("alert")).toHaveTextContent("Must be .srt or .vtt");
    expect(screen.getByTestId("subs-row")).toHaveAttribute("data-invalid");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });
});
