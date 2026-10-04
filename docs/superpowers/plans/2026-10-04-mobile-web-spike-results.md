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
