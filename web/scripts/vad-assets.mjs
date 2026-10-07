// VAD 自托管资源(计划 R18,不走 CDN):目录名同时含 @ricky0123/vad-web 与 onnxruntime-web 的*已安装*版本,
// 例如 /vad/0.0.31-ort1.30.0/。service worker 对 /vad/ 按 URL 缓存优先,任一包升级都必须换 URL(review W2 I3)。
// 只复制运行时真正会请求的 4 个文件(@ricky0123/vad-web 0.0.31 + onnxruntime-web/wasm,核对见 spike 结论第 5 节):
//   silero_vad_v5.onnx、vad.worklet.bundle.min.js(baseAssetPath),
//   ort-wasm-simd-threaded.{wasm,mjs}(onnxWASMBasePath;jsep/jspi/asyncify 变体用不到,各 10+ MB)。
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
const SOURCES = [
  ["@ricky0123/vad-web", /^(silero_vad_v5\.onnx|vad\.worklet\.bundle\.min\.js)$/],
  ["onnxruntime-web", /^ort-wasm-simd-threaded\.(wasm|mjs)$/],
];
const EXPECTED_FILES = 4;

/** @param {{ vad: string, ort: string }} versions */
export function vadAssetDirName({ vad, ort }) {
  for (const v of [vad, ort]) if (!EXACT_VERSION.test(v)) throw new Error(`not an exact version: ${JSON.stringify(v)}`);
  return `${vad}-ort${ort}`;
}

/** @param {{ vad: string, ort: string }} versions */
export function vadAssetBase(versions) {
  return `/vad/${vadAssetDirName(versions)}/`;
}

/** 从 fromDir 按 Node 解析规则找到 name 包的根目录(向上找 name 匹配的 package.json)。 */
function packageDir(fromDir, name) {
  const require = createRequire(path.join(fromDir, "package.json"));
  let dir = path.dirname(require.resolve(name));
  while (!existsSync(path.join(dir, "package.json")) || JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).name !== name) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`cannot locate ${name}`);
    dir = parent;
  }
  return dir;
}

// ORT 从 vad-web 自己的位置解析(review F3 a1):Vite 打包的是 vad-web import 到的那份,目录名和 wasm 必须跟它一致
function vadPackageDirs(webRoot) {
  const vad = packageDir(webRoot, "@ricky0123/vad-web");
  return { "@ricky0123/vad-web": vad, "onnxruntime-web": packageDir(vad, "onnxruntime-web") };
}

const versionAt = (dir) => JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).version;

export function installedVadVersions(webRoot) {
  const dirs = vadPackageDirs(webRoot);
  return { vad: versionAt(dirs["@ricky0123/vad-web"]), ort: versionAt(dirs["onnxruntime-web"]) };
}

/**
 * 清空 outRoot 下的其他版本目录与杂项(否则 Vite 会把旧目录一起复制进 dist),
 * 再把 4 个文件复制到 outRoot/<目录名>/;数量不对就抛错。返回目标目录。
 */
export function copyVadAssets(webRoot, outRoot = path.join(webRoot, "public", "vad")) {
  const name = vadAssetDirName(installedVadVersions(webRoot));
  const dirs = vadPackageDirs(webRoot);
  mkdirSync(outRoot, { recursive: true });
  for (const entry of readdirSync(outRoot)) if (entry !== name) rmSync(path.join(outRoot, entry), { recursive: true, force: true });
  const out = path.join(outRoot, name);
  mkdirSync(out, { recursive: true });
  const wanted = new Set();
  for (const [pkg, pattern] of SOURCES) {
    const dir = path.join(dirs[pkg], "dist");
    for (const file of readdirSync(dir)) {
      if (!pattern.test(file)) continue;
      copyFileSync(path.join(dir, file), path.join(out, file));
      wanted.add(file);
    }
  }
  for (const entry of readdirSync(out)) if (!wanted.has(entry)) rmSync(path.join(out, entry), { recursive: true, force: true });
  const count = readdirSync(out).length;
  if (wanted.size !== EXPECTED_FILES || count !== EXPECTED_FILES) {
    throw new Error(`expected ${EXPECTED_FILES} VAD assets, copied ${wanted.size} (directory has ${count})`);
  }
  return out;
}
