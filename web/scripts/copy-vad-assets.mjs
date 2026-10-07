// 把 Silero VAD 模型、worklet 与 onnxruntime wasm 复制到 public/vad/<vad-web 版本>-ort<onnxruntime-web 版本>/(计划 R18)。
// 逻辑在 vad-assets.mjs(vite.config.ts 用同一函数生成 __VAD_ASSET_BASE__)。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyVadAssets } from "./vad-assets.mjs";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = copyVadAssets(webRoot);
console.log(`copied 4 VAD assets to ${path.relative(webRoot, out).split(path.sep).join("/")}/`);
