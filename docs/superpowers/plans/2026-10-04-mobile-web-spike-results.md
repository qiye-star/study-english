# 手机网页版可行性验证结果(阶段 0)

基线:commit 2f2c3de8;服务端 296 passed;enjoy tsc 基线 37 行。

## A. 别名构建
| 检查 | 结果 | 备注 |
|---|---|---|
| tsc --noEmit | ✅(exit 0) | 额外 include:无(仅 `pronunciation-assessment.d.ts` 已在计划中)。**需两处差异,见下** |
| vitest 渲染 ScoreResult | ✅(1 passed) | 总分文本含 `98` |
| vite build | ✅(exit 0) | dist/assets 1.5M(js 636 kB / gzip 212 kB,css 44 kB,字体 822 kB) |
| __ENJOY_APP__ 不在产物中 | ✅ | 输出 CLEAN |
| guard 报出的缺失依赖 | 无 | 计划的依赖清单已足够;负向对照(引入 `ui/command` → 报 `"cmdk" ... must be a dependency`)确认 guard 有效 |

### 需并入 Task 2.1 的差异
1. **`tsconfig.json` 的 `"*"` 路径映射顺序必须反过来**:`"*": ["./node_modules/@types/*", "./node_modules/*"]`。按计划原顺序(先 `./node_modules/*`)时,`react`、`react/jsx-runtime` 等先命中无类型的 JS 包,enjoy 文件报大量 TS7016/TS7026("Could not find a declaration file for module 'react'")。
2. **`noImplicitAny` 下计划里的三处代码需加类型标注**(否则 tsc 报错):
   - `src/shims/empty-module.ts`:`const noop = (): undefined => undefined;`(TS7011)
   - `src/test/setup.ts`:`takeRecords(): unknown[] { return []; }`(TS7010);`onchange: null as null`(TS7018)
3. `WavesurferPlayer` 是**具名导出**:`import { WavesurferPlayer } from "@renderer/components/misc/wavesurfer-player"`。
4. 路径相对层级:spike 在 `.superpowers/spike-web`,多一层 `../`;正式 `web/` 无此差异。
5. 另:esbuild 的 postinstall 在 npm 提示被跳过(`allow-scripts`),不影响 vite build/vitest。

## B. 录音与评测
测试条件:本机服务端(uvicorn,临时 SQLite,真实 iFlytek 上游);Playwright 1.51.0;页面经 Vite dev 服务(`localhost`,安全上下文);spike 原样使用 Task 3.1/3.2 的 `wav.ts`/`convert.ts`/`recorder.ts`。录音 11.5 s,素材 `enjoy/samples/jfk.wav`(假麦克风)。

| 浏览器 | secure | MediaRecorder | mimeType | 录音字节 | WAV 头 | HTTP | 总分 | 词数 | 错误 |
|---|---|---|---|---|---|---|---|---|---|
| Chromium 134(Windows,Pixel 7 预设,假麦克风参数) | 是 | function | `audio/webm;codecs=opus` | 186507 | 16000 Hz / 1 声道 / 16 位(PCM,11520 ms) | 200 | 79.57 | 22 | 无 |
| WebKit 18.4(Windows 原生,iPhone 14 预设) | 是 | **undefined** | — | — | — | — | — | — | `RecorderError: unsupported`;`navigator.mediaDevices`、`OfflineAudioContext` 也全部 undefined |
| WebKit 18.4(Linux 容器 `mcr.microsoft.com/playwright:v1.51.0-noble`,`http://localhost` 安全上下文) | 是 | **undefined** | — | — | 见下:转换链可用 | — | — | — | 无法录音 |
| iPhone Safari 真机 | **未验证(需要用户提供设备与 HTTPS 地址)** | | | | | | | | |

WebKit(Linux 容器)能力:`mediaDevices.getUserMedia`=function、`AudioContext`/`OfflineAudioContext`=function,`MediaRecorder`=undefined(`http://localhost` 与非安全上下文结果一致)。在该环境用 `toAssessmentWav`(浏览器内 `OfflineAudioContext` 解码+重采样)转换两份素材:`jfk.wav` 与 Chromium 录得的 `webm/opus` 6 s 片段,均成功得到 16000/1/16 的 WAV(时长 11000 ms 与 6000 ms)。该转换产物未再送评测(Chromium 同款链路已送评测通过)。未能制得 `mp4/aac` 素材(Playwright 自带 ffmpeg 与 Chromium 134 均无 AAC 编码),因此 Safari 实际产出的 `audio/mp4` 的解码**未验证**。

结论要点:
- Chromium 全链路(假麦克风 → MediaRecorder → OfflineAudioContext → 16 kHz/mono/16-bit WAV → 真实评测)通过,核心假设成立,可进入阶段 1。
- Playwright 的 WebKit 构建(Windows 与 Linux)均不含 `MediaRecorder`,因此 WebKit 上**无法**用 `MediaRecorder` 做录音类 E2E;这是测试构建的限制,不代表真实 Safari(真实 Safari 有 `MediaRecorder`,产出 `audio/mp4`/AAC,但本次未验证)。
- 附带发现(Task 2.8 / `web/playwright.config.ts`):Node 24 下 `package.json` 含 `"type": "module"` 时,Playwright 1.51 加载 TS 配置/用例会报 "Named export 'defineConfig'/'expect' not found"(CJS 具名导出)。spike 的绕法:配置里 `import pkg from "@playwright/test"` 取解构,`e2e/` 下放 `{"type":"commonjs"}` 的 `package.json`,配置内联常量而不 import 用例目录文件。正式 `web/` 应避免该踩坑(例如 `web/package.json` 不设 `"type": "module"`,或同样处理)。

## 决定
1. **WebKit E2E 运行方式:Linux 容器**。Windows 原生 WebKit 无 `mediaDevices`/`OfflineAudioContext`/`MediaRecorder`,几乎什么都跑不了;Linux 容器里 `localhost` 为安全上下文,有 `getUserMedia`(可用 init script 注入假麦克风)与 `OfflineAudioContext`(转换链实测可用)。但两处 WebKit 构建都**没有 `MediaRecorder`**,因此依赖 `MediaRecorder` 的录音类用例在 WebKit 上应 `test.skip` 并注明原因;WebKit 只跑非录音用例(登录、布局、导航、转换/上传链路可注入文件)。录音在 Safari 上的真实行为仍需真机验证。
2. **Task 3.6(AudioWorklet 备选)是否执行:否(暂不触发)**。触发条件是「Safari/WebKit 下 MediaRecorder 产物无法稳定解码」,而本次没有任何证据显示该问题(WebKit 构建无 MediaRecorder,无法产生此证据;Linux WebKit 能解码 webm/opus 与 wav)。真实 iOS Safari 未验证:若之后真机上 `audio/mp4` 解码失败或录音异常,再回头执行 Task 3.6。门槛 3 中按「未触发(iOS 真机待验证)」注明。
