# 语音提速 spike 结论(计划 2026-10-07-voice-speed-hold-to-talk-realtime,阶段 0)

## 5. VAD 库 API 核对(Task 2.3)

核对对象:实际安装的 `@ricky0123/vad-web` **0.0.31** 与 `onnxruntime-web` **1.30.0**(两者在 `web/package.json` 中锁定精确版本;vad-web 声明的依赖是 `onnxruntime-web ^1.17.0`,1.30.0 在该范围内)。依据是 `node_modules/@ricky0123/vad-web/dist/*.d.ts` 与 `real-time-vad.js` 源码,不是文档。核对日期 2026-10-07。

| 项 | 有/没有 | 实际签名 / 取值 |
|---|---|---|
| `MicVAD` | 有 | `class MicVAD { static new(options?: Partial<RealTimeVADOptions>): Promise<MicVAD>; start(): Promise<void>; pause(): Promise<void>; destroy(): Promise<void>; setOptions(update: Partial<FrameProcessorOptions>): void; listening: boolean; errored: string \| null }` |
| `getStream` | 有(没有 `stream` 选项) | `getStream: () => Promise<MediaStream>` |
| `pauseStream` / `resumeStream` | 有 | `pauseStream: (stream) => Promise<void>`(**默认实现对每条轨道 `track.stop()`**);`resumeStream: (stream) => Promise<MediaStream>`(默认重新 `getUserMedia`)。R32:我们传 no-op `pauseStream` 与原样返回的 `resumeStream`,共享麦克风流的轨道不会被库停掉(有单测) |
| `audioContext`(外部上下文) | **有** | `audioContext?: AudioContext`。传入时库不新建、`destroy()` 时也**不关闭**它(`ownsAudioContext = false`);不传时库自建并在 `destroy()` 里关闭。所以 R32 的"库不接受外部 AudioContext → iOS 以按住说话开始"分支**不触发**;`vad.ts` 导出 `VAD_ACCEPTS_EXTERNAL_CONTEXT = true` 供通话使用 |
| `onFrameProcessed` | 有 | `(probabilities: { isSpeech: number; notSpeech: number }, frame: Float32Array) => Promise<void> \| void`,每帧调用,与库自身阈值无关 → `SpeechGate` 能拿到原始概率,bot-speaking 预设的概率条件**生效**(不需要"合成概率"的退路) |
| `onSpeechStart` / `onSpeechEnd` / `onVADMisfire` / `onSpeechRealStart` | 有 | `() => void`;`onSpeechEnd(audio: Float32Array)`。我们全部置空,判定只用 `SpeechGate` |
| `baseAssetPath` | 有 | `string`,默认 `"./"`;模型 URL = `baseAssetPath + "silero_vad_v5.onnx"`,worklet URL = `baseAssetPath + "vad.worklet.bundle.min.js"`(字符串拼接,必须以 `/` 结尾) |
| `onnxWASMBasePath` | 有 | `string`,默认 `"./"`;库执行 `ort.env.wasm.wasmPaths = onnxWASMBasePath` |
| `model` | 有 | `"v5" \| "v6" \| "legacy"`,**默认 `"legacy"`**(帧 1536 采样);我们显式用 `"v5"`(帧 512 采样 = 32 ms,对应 `VAD_FRAME_MS = 32`) |
| `startOnLoad` | 有 | `boolean`,默认 `true`。我们传 `false`,在 `loadSileroSource` 里 `await start()` 再 `await pause()`:worklet/模型加载失败在加载阶段 reject,调用方据此退到"按住说话" |
| `processorType` | 有 | `"AudioWorklet" \| "ScriptProcessor" \| "auto"`(默认 auto:有 `audioWorklet` 用 worklet,否则 ScriptProcessor) |
| 阈值选项 | 有 | `positiveSpeechThreshold`、`negativeSpeechThreshold`、`redemptionMs`、`preSpeechPadMs`、`minSpeechMs`、`submitUserSpeechOnPause`(注意是 **ms**,不是旧版的 `*Frames`) |

**资源文件(`web/scripts/copy-vad-assets.mjs` 复制到 `web/public/vad/0.0.31/`,构建后在 `web/dist/vad/0.0.31/`):**

| 文件 | 来源 | 大小 | 谁请求 |
|---|---|---|---|
| `silero_vad_v5.onnx` | `@ricky0123/vad-web/dist/`(同目录还有 `silero_vad_legacy.onnx`、`silero_vad_v6.onnx`,不复制) | 2.3 MB | 库,`fetch(baseAssetPath + 文件名)` |
| `vad.worklet.bundle.min.js` | `@ricky0123/vad-web/dist/`(还有 `.dev.js`,不复制) | 2.5 KB | 库,`audioWorklet.addModule(baseAssetPath + 文件名)`;处理器名 `vad-helper-worklet`,按上下文 `sampleRate` 重采样到 16 kHz |
| `ort-wasm-simd-threaded.mjs` | `onnxruntime-web/dist/` | 24 KB | onnxruntime(非 bundle 版)从 `wasmPaths` 动态 `import()` |
| `ort-wasm-simd-threaded.wasm` | `onnxruntime-web/dist/` | 14.2 MB | onnxruntime 从 `wasmPaths` 加载 |

- 1.30.0 的 `dist/` 里还有 `ort-wasm-simd-threaded.{jsep,jspi,asyncify}.{mjs,wasm}`(WebGPU/JSPI 变体,各 10+ MB),`onnxruntime-web/wasm` 用不到,脚本只复制上表 4 个文件,数量不等于 4 就失败。计划原文的正则(`silero_vad.*\.onnx`、`ort-wasm.*\.(wasm|mjs)`)会多复制约 60 MB,已收紧。
- **打包实测**(用临时入口 import `vad.ts` 做一次探测构建,未提交):`import("@ricky0123/vad-web")` 成为单独的懒加载分块(约 440 KB,未压缩);vad-web 是 CommonJS,Vite 按 `require` 条件解析 `onnxruntime-web/wasm` → `dist/ort.wasm.min.js`(非 bundle 版,运行时从 `wasmPaths` 取 `.mjs` 与 `.wasm`,上表两文件都已复制);`index.js` 同时 re-export 了 `NonRealTimeVAD`(它 `require("onnxruntime-web")` 完整版),所以分块里多带了一份完整版 ORT 的 JS(不加载其 wasm),只增加分块体积。分块里资源路径为 `/vad/0.0.31/`,没有任何 CDN 地址。
- 当前没有任何产品代码 import `vad.ts`(通话在 Task 4.x 接入),所以正式 `yarn build` 的 `dist/assets` 里暂时没有 VAD 分块;`dist/vad/0.0.31/` 已产出。
- 服务端 `web` 路由:`.wasm` → `application/wasm`、`.mjs` → `text/javascript`(本机 Python 3.12 `mimetypes`),`.onnx` 无映射(按 `fetch().arrayBuffer()` 读取,不影响)。缺失的 `/vad/*` 会被 SPA 回退成 200 的 `index.html`(SW 不缓存 HTML,但库会把 HTML 当模型解析而报错 → 走"VAD 资源加载失败"降级)。

**未验证(R19)**:真实浏览器里 ORT 1.30.0 + Silero v5 的推理、worklet 在共享 AudioContext 中的运行、iOS Safari 上的表现,均未在本任务运行(只有单测与构建);留给通话的 E2E 与真机清单。
