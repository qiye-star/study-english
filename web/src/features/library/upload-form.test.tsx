import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setUiLanguage } from "./test-i18n";
import { renderWithProviders } from "~/test/render";
import { limitsOrDefault, type LibraryLimits } from "./library-api";
import { UploadForm, checkSubtitles, checkUpload } from "./upload-form";

const MIB = 1024 * 1024;
const LIMITS: LibraryLimits = { ...limitsOrDefault(null), maxUploadMb: 10, quotaMb: 20, usedBytes: 15 * MIB };
const f = (name: string, size: number) => ({ name, size });
const file = (name: string, size: number) => new File([new Uint8Array(size)], name);

beforeEach(async () => {
  await setUiLanguage("zh-CN");
});

describe("checkUpload (R-L19)", () => {
  it("checks type, emptiness, size, quota and subtitles in that order", () => {
    expect(checkUpload(f("a.exe", 1), LIMITS, null)).toBe("badType");
    expect(checkUpload(f("a.mp4", 0), LIMITS, null)).toBe("empty");
    expect(checkUpload(f("a.mp4", 11 * MIB), LIMITS, null)).toBe("tooLarge");
    expect(checkUpload(f("a.MP4", 6 * MIB), LIMITS, null)).toBe("overQuota");
    expect(checkUpload(f("a.mp3", MIB), LIMITS, f("a.ass", 1))).toBe("subtitleBadType");
    expect(checkUpload(f("a.mp3", MIB), LIMITS, f("a.srt", 3 * MIB))).toBe("subtitleTooLarge");
    expect(checkUpload(f("a.mp3", MIB), LIMITS, f("a.vtt", 100))).toBeNull();
  });
});

describe("checkSubtitles (R-A2)", () => {
  it("checks the extension, then the 2 MiB cap", () => {
    expect(checkSubtitles(f("a.ass", 1))).toBe("subtitleBadType");
    expect(checkSubtitles(f("a", 1))).toBe("subtitleBadType");
    expect(checkSubtitles(f("a.srt", 3 * MIB))).toBe("subtitleTooLarge");
    expect(checkSubtitles(f("a.VTT", 100))).toBeNull();
  });
});

describe("UploadForm", () => {
  it("submits the file, trimmed title and subtitles", () => {
    const onSubmit = vi.fn();
    renderWithProviders(<UploadForm limits={LIMITS} asr onSubmit={onSubmit} />);
    const media = file("Talk.mp4", 100);
    const subs = file("Talk.srt", 10);
    fireEvent.change(screen.getByTestId("library-upload-file"), { target: { files: [media] } });
    fireEvent.change(screen.getByTestId("library-upload-subtitles"), { target: { files: [subs] } });
    fireEvent.change(screen.getByLabelText("标题(可选)"), { target: { value: "  My talk " } });
    fireEvent.click(screen.getByRole("button", { name: "上传" }));
    expect(onSubmit).toHaveBeenCalledWith({ file: media, filename: "Talk.mp4", title: "My talk", subtitles: { file: subs, filename: "Talk.srt" } });
  });

  it("shows the problem and blocks submit", () => {
    const onSubmit = vi.fn();
    renderWithProviders(<UploadForm limits={LIMITS} asr onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId("library-upload-file"), { target: { files: [file("a.mp4", 11 * MIB)] } });
    expect(screen.getByRole("alert")).toHaveTextContent("文件超过了 10 MB。");
    expect(screen.getByRole("button", { name: "上传" })).toBeDisabled();
  });

  it("warns that subtitles are needed when the server cannot transcribe", () => {
    renderWithProviders(<UploadForm limits={LIMITS} asr={false} onSubmit={vi.fn()} />);
    expect(screen.getByTestId("library-upload-noasr")).toHaveTextContent("没有字幕时本服务器无法自动转写");
    fireEvent.change(screen.getByTestId("library-upload-subtitles"), { target: { files: [file("a.vtt", 10)] } });
    expect(screen.queryByTestId("library-upload-noasr")).toBeNull();
  });
  it("replaces the raw file inputs with a pick tile and a subtitle row, keeping the real inputs and test ids (R-A3)", () => {
    renderWithProviders(<UploadForm limits={LIMITS} asr onSubmit={vi.fn()} />);
    expect(screen.getByTestId("library-upload-file-tile")).toBeInTheDocument();
    expect(screen.getByText("选择视频或音频")).toBeInTheDocument();
    expect(screen.getByText("格式:mp4 · m4v · mov · webm · mkv · mp3 +6")).toBeInTheDocument();
    expect(screen.getByText("单个最大 10 MB,最长 90 分钟")).toBeInTheDocument();
    expect(screen.getByLabelText("音频或视频文件")).toBe(screen.getByTestId("library-upload-file"));
    expect(screen.getByLabelText("字幕(可选,.srt / .vtt)")).toBe(screen.getByTestId("library-upload-subtitles"));
    expect(screen.getByTestId("library-upload-file")).toHaveAttribute("accept", expect.stringContaining("audio/*,video/*,.mp4"));
    expect(screen.getByTestId("library-upload-subtitles")).toHaveAttribute("accept", ".srt,.vtt");
    expect(screen.getByRole("button", { name: "上传" }).className).toMatch(/\blib-spec\b/);
    expect(screen.getByRole("button", { name: "上传" })).toBeDisabled();
  });

  it("turns the tile into a file card with name and size, and removing it empties the form again", () => {
    renderWithProviders(<UploadForm limits={LIMITS} asr onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByTestId("library-upload-file"), { target: { files: [file("Talk.mp4", 2048)] } });
    expect(screen.getByTestId("library-upload-file-card")).toBeInTheDocument();
    expect(screen.getByText("Talk.mp4")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "移除文件" }));
    expect(screen.getByTestId("library-upload-file-tile")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传" })).toBeDisabled();
  });

  it("fills the title from the file name until the user types one (R-A9)", () => {
    const onSubmit = vi.fn();
    renderWithProviders(<UploadForm limits={LIMITS} asr onSubmit={onSubmit} />);
    const title = screen.getByLabelText("标题(可选)") as HTMLInputElement;
    expect(title.value).toBe("");
    fireEvent.change(screen.getByTestId("library-upload-file"), { target: { files: [file("my_cool_talk.mp4", 100)] } });
    expect(title.value).toBe("my cool talk");
    expect(screen.getByText("已根据文件名填写,可以修改。")).toBeInTheDocument();
    fireEvent.change(title, { target: { value: "Mine" } });
    expect(screen.queryByText("已根据文件名填写,可以修改。")).toBeNull();
    fireEvent.change(screen.getByTestId("library-upload-file"), { target: { files: [file("other.mp4", 100)] } });
    expect(title.value).toBe("Mine");
    fireEvent.click(screen.getByRole("button", { name: "上传" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ filename: "other.mp4", title: "Mine" }));
  });

  it("submits the derived title when the user never touched the field", () => {
    const onSubmit = vi.fn();
    renderWithProviders(<UploadForm limits={LIMITS} asr onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId("library-upload-file"), { target: { files: [file("Friends.S01E02.mp4", 100)] } });
    fireEvent.click(screen.getByRole("button", { name: "上传" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: "Friends S01E02", subtitles: null }));
  });

  it("shows a wrong file type inline before submit, in the red alert under the card", () => {
    renderWithProviders(<UploadForm limits={LIMITS} asr onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByTestId("library-upload-file"), { target: { files: [file("notes.exe", 10)] } });
    expect(screen.getByRole("alert")).toHaveTextContent("不支持这种文件类型。");
    expect(screen.getByTestId("library-upload-file-card")).toHaveAttribute("data-invalid");
    expect(screen.getByRole("button", { name: "上传" })).toBeDisabled();
  });

  it("shows a subtitle problem on the subtitle row even before a media file is chosen", () => {
    renderWithProviders(<UploadForm limits={LIMITS} asr onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByTestId("library-upload-subtitles"), { target: { files: [file("a.ass", 10)] } });
    expect(screen.getByRole("alert")).toHaveTextContent("字幕必须是 .srt 或 .vtt 文件。");
    expect(screen.getByTestId("library-upload-subtitles-row")).toHaveAttribute("data-invalid");
    expect(screen.getByTestId("library-upload-file-tile")).toBeInTheDocument();
  });

  it("removes the chosen subtitles with the cross", () => {
    renderWithProviders(<UploadForm limits={LIMITS} asr={false} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByTestId("library-upload-subtitles"), { target: { files: [file("a.vtt", 10)] } });
    expect(screen.getByText("a.vtt")).toBeInTheDocument();
    expect(screen.queryByTestId("library-upload-noasr")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "移除字幕" }));
    expect(screen.queryByText("a.vtt")).toBeNull();
    expect(screen.getByTestId("library-upload-noasr")).toBeInTheDocument();
  });

  it("shows the no-transcription warning as a tinted card", () => {
    renderWithProviders(<UploadForm limits={LIMITS} asr={false} onSubmit={vi.fn()} />);
    expect(screen.getByTestId("library-upload-noasr").className).toMatch(/\blib-note--warn\b/);
  });

  it("shows progress after submit and ignores a second submit (R-A10)", () => {
    const onSubmit = vi.fn();
    renderWithProviders(<UploadForm limits={LIMITS} asr onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId("library-upload-file"), { target: { files: [file("a.mp4", 100)] } });
    fireEvent.click(screen.getByRole("button", { name: "上传" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const busy = screen.getByRole("button", { name: "正在加入上传…" });
    expect(busy).toBeDisabled();
    expect(screen.getByTestId("library-upload-form")).toHaveAttribute("aria-busy", "true");
    fireEvent.click(busy);
    fireEvent.submit(screen.getByTestId("library-upload-form"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
