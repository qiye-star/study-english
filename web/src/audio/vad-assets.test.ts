// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyVadAssets, installedVadVersions, vadAssetBase, vadAssetDirName } from "../../scripts/vad-assets.mjs";

const webRoot = path.resolve(__dirname, "../..");
const installed = (name: string) =>
  (JSON.parse(readFileSync(path.join(webRoot, "node_modules", name, "package.json"), "utf8")) as { version: string }).version;

describe("VAD asset path (review W2 I3)", () => {
  it("names the directory after both the vad-web and the onnxruntime-web versions", () => {
    expect(vadAssetDirName({ vad: "0.0.31", ort: "1.30.0" })).toBe("0.0.31-ort1.30.0");
    expect(vadAssetBase({ vad: "0.0.31", ort: "1.30.0" })).toBe("/vad/0.0.31-ort1.30.0/");
  });

  it("a changed version of either package changes the URL (so the cache-first SW cannot serve stale files)", () => {
    const base = vadAssetBase({ vad: "0.0.31", ort: "1.30.0" });
    expect(vadAssetBase({ vad: "0.0.31", ort: "1.31.0" })).not.toBe(base);
    expect(vadAssetBase({ vad: "0.0.32", ort: "1.30.0" })).not.toBe(base);
  });

  it("refuses version strings that are not exact versions (no ranges leaking into the path)", () => {
    expect(() => vadAssetDirName({ vad: "^0.0.31", ort: "1.30.0" })).toThrow();
    expect(() => vadAssetDirName({ vad: "0.0.31", ort: "../x" })).toThrow();
  });

  it("reads the installed packages' versions, and the build-time define uses them", () => {
    const versions = installedVadVersions(webRoot);
    expect(versions).toEqual({ vad: installed("@ricky0123/vad-web"), ort: installed("onnxruntime-web") });
    expect(__VAD_ASSET_BASE__).toBe(vadAssetBase(versions));
  });
});

describe("copyVadAssets", () => {
  let out = "";
  afterEach(() => {
    if (out) rmSync(out, { recursive: true, force: true });
    out = "";
  });

  it("removes other version directories and copies exactly the 4 runtime files", () => {
    out = mkdtempSync(path.join(tmpdir(), "vad-assets-"));
    mkdirSync(path.join(out, "0.0.30"));
    writeFileSync(path.join(out, "0.0.30", "silero_vad_v5.onnx"), "old");
    mkdirSync(path.join(out, "0.0.31-ort1.29.0"));
    writeFileSync(path.join(out, "stray.txt"), "x");
    const dir = copyVadAssets(webRoot, out);
    const name = vadAssetDirName(installedVadVersions(webRoot));
    expect(dir).toBe(path.join(out, name));
    expect(readdirSync(out)).toEqual([name]);
    expect(readdirSync(dir).sort()).toEqual([
      "ort-wasm-simd-threaded.mjs",
      "ort-wasm-simd-threaded.wasm",
      "silero_vad_v5.onnx",
      "vad.worklet.bundle.min.js",
    ]);
  }, 30_000);

  it("removes stale files inside the current version directory too", () => {
    out = mkdtempSync(path.join(tmpdir(), "vad-assets-"));
    const name = vadAssetDirName(installedVadVersions(webRoot));
    mkdirSync(path.join(out, name));
    writeFileSync(path.join(out, name, "leftover.js"), "x");
    copyVadAssets(webRoot, out);
    expect(existsSync(path.join(out, name, "leftover.js"))).toBe(false);
    expect(readdirSync(path.join(out, name))).toHaveLength(4);
  }, 30_000);
});
