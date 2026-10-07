// 把 Silero VAD 模型、worklet 与 onnxruntime wasm 复制到 public/vad/<版本>/(计划 R18,不走 CDN)。
// 只复制运行时真正会请求的文件(@ricky0123/vad-web 0.0.31 + onnxruntime-web/wasm,核对见 spike 结论第 5 节):
//   silero_vad_v5.onnx、vad.worklet.bundle.min.js(baseAssetPath),
//   ort-wasm-simd-threaded.{wasm,mjs}(onnxWASMBasePath;jsep/jspi/asyncify 变体用不到,各 10+ MB)。
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(webRoot, "package.json"), "utf8"));
const version = pkg.dependencies["@ricky0123/vad-web"];
const require = createRequire(path.join(webRoot, "package.json"));

function packageDir(name) {
  let dir = path.dirname(require.resolve(name));
  while (!existsSync(path.join(dir, "package.json")) || JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).name !== name) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`cannot locate ${name}`);
    dir = parent;
  }
  return dir;
}

const out = path.join(webRoot, "public", "vad", version);
mkdirSync(out, { recursive: true });
const sources = [
  [path.join(packageDir("@ricky0123/vad-web"), "dist"), /^(silero_vad_v5\.onnx|vad\.worklet\.bundle\.min\.js)$/],
  [path.join(packageDir("onnxruntime-web"), "dist"), /^ort-wasm-simd-threaded\.(wasm|mjs)$/],
];
const expected = 4;
let copied = 0;
for (const [dir, pattern] of sources) {
  for (const file of readdirSync(dir)) {
    if (pattern.test(file)) {
      copyFileSync(path.join(dir, file), path.join(out, file));
      copied++;
    }
  }
}
if (copied !== expected) throw new Error(`expected ${expected} VAD assets, copied ${copied}`);
console.log(`copied ${copied} VAD assets to public/vad/${version}/`);
