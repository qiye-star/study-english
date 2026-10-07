// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assetsInlineLimit } from "../../vite.config";

describe("build.assetsInlineLimit (plan 2026-10-07 R9)", () => {
  it("never inlines AudioWorklet modules, so they ship as /assets/ files the service worker caches", () => {
    expect(assetsInlineLimit("/repo/web/src/audio/pcm-capture.worklet.js")).toBe(false);
    const windowsPath = String.raw`C:\repo\web\src\audio\pcm-capture.worklet.js`;
    expect(windowsPath).toContain("\\audio\\"); // 真的是反斜杠路径,不是被转义吞掉的字符串(review W1 M-11)
    expect(assetsInlineLimit(windowsPath)).toBe(false);
  });

  it("leaves every other asset to Vite's default rule", () => {
    expect(assetsInlineLimit("/repo/web/src/assets/logo.svg")).toBeUndefined();
    expect(assetsInlineLimit("/repo/web/src/audio/worklet.ts")).toBeUndefined();
  });
});
