import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setUiLanguage } from "./test-i18n";
import { renderWithProviders } from "~/test/render";
import { limitsOrDefault, type LibraryLimits } from "./library-api";
import { UploadForm, checkUpload } from "./upload-form";

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
});
