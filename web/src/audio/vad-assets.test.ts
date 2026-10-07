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

describe("onnxruntime-web is resolved from @ricky0123/vad-web (review F3 a1)", () => {
  let root = "";
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  function fakePackage(dir: string, name: string, version: string, distFiles: Record<string, string>) {
    mkdirSync(path.join(dir, "dist"), { recursive: true });
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version, main: "index.js" }));
    writeFileSync(path.join(dir, "index.js"), "");
    for (const [file, content] of Object.entries(distFiles)) writeFileSync(path.join(dir, "dist", file), content);
  }

  it("names and copies the ORT that vad-web itself imports, not a different one next to web/", () => {
    root = mkdtempSync(path.join(tmpdir(), "vad-layout-"));
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "web", private: true }));
    const vad = path.join(root, "node_modules", "@ricky0123", "vad-web");
    fakePackage(vad, "@ricky0123/vad-web", "0.0.31", { "silero_vad_v5.onnx": "m", "vad.worklet.bundle.min.js": "w" });
    const ortFiles = (tag: string) => ({ "ort-wasm-simd-threaded.wasm": tag, "ort-wasm-simd-threaded.mjs": tag });
    fakePackage(path.join(root, "node_modules", "onnxruntime-web"), "onnxruntime-web", "1.30.0", ortFiles("outer"));
    fakePackage(path.join(vad, "node_modules", "onnxruntime-web"), "onnxruntime-web", "1.31.0", ortFiles("nested"));

    expect(installedVadVersions(root)).toEqual({ vad: "0.0.31", ort: "1.31.0" });
    const dir = copyVadAssets(root, path.join(root, "out"));
    expect(path.basename(dir)).toBe("0.0.31-ort1.31.0");
    expect(readFileSync(path.join(dir, "ort-wasm-simd-threaded.wasm"), "utf8")).toBe("nested");
  });
});
