import { describe, expect, it } from "vitest";
import { deriveTitle, fileKind, formatFileSize, formatsHint } from "./add-sheet-helpers";
import { LIBRARY_FORMATS } from "./library-api";

const MIB = 1024 * 1024;

describe("formatFileSize (R-A2)", () => {
  it("shows bytes and KB for small files and defers to formatBytes from 1 MiB", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(150 * 1024)).toBe("150 KB");
    expect(formatFileSize(MIB)).toBe("1.0 MB");
    expect(formatFileSize(5 * MIB)).toBe("5.0 MB");
    expect(formatFileSize(150 * MIB)).toBe("150 MB");
    expect(formatFileSize(2000 * MIB)).toBe("2.0 GB");
  });

  it("never goes negative", () => {
    expect(formatFileSize(-5)).toBe("0 B");
  });
});

describe("formatsHint", () => {
  it("joins lower-cased formats with a middle dot", () => {
    expect(formatsHint(["MP4", "mp3"])).toBe("mp4 · mp3");
    expect(formatsHint([])).toBe("");
  });

  it("shows at most six formats and counts the rest", () => {
    expect(formatsHint([...LIBRARY_FORMATS])).toBe("mp4 · m4v · mov · webm · mkv · mp3 +6");
    expect(formatsHint([...LIBRARY_FORMATS], 3)).toBe("mp4 · m4v · mov +9");
    expect(formatsHint(["a", "b", "c"], 3)).toBe("a · b · c");
  });
});

describe("fileKind", () => {
  it("goes by extension first, then by MIME type", () => {
    expect(fileKind({ name: "a.MP4" })).toBe("video");
    expect(fileKind({ name: "a.mkv" })).toBe("video");
    expect(fileKind({ name: "a.flac" })).toBe("audio");
    expect(fileKind({ name: "a.opus" })).toBe("audio");
    expect(fileKind({ name: "a.txt", type: "" })).toBe("other");
    expect(fileKind({ name: "noext", type: "video/mp4" })).toBe("video");
    expect(fileKind({ name: "a.bin", type: "audio/x-foo" })).toBe("audio");
    expect(fileKind({ name: "a.mp3", type: "video/mp4" })).toBe("audio");
  });
});

describe("deriveTitle (R-A9)", () => {
  it("uses the file name stem", () => {
    expect(deriveTitle("Talk.mp4")).toBe("Talk");
    expect(deriveTitle("C:\\videos\\Lecture 1.mov")).toBe("Lecture 1");
    expect(deriveTitle("/home/me/Lecture 2.m4a")).toBe("Lecture 2");
    expect(deriveTitle("noext")).toBe("noext");
  });

  it("turns underscores and scene-style dots into spaces", () => {
    expect(deriveTitle("my_cool_talk.mp3")).toBe("my cool talk");
    expect(deriveTitle("Friends.S01E02.720p.mp4")).toBe("Friends S01E02 720p");
    expect(deriveTitle("a..b.mp4")).toBe("a b");
  });

  it("keeps dots when the name already has spaces", () => {
    expect(deriveTitle("Mr. Bean live.mp4")).toBe("Mr. Bean live");
  });

  it("falls back to the raw stem when nothing is left and caps at 200 characters", () => {
    expect(deriveTitle("___.mp4")).toBe("___");
    expect(deriveTitle(`${"x".repeat(300)}.mp4`)).toHaveLength(200);
  });
});
