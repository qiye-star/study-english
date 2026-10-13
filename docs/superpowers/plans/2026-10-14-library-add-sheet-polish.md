# 跟读库「添加素材」弹层美化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 列表页「添加」打开的底部弹层里,两个裸的原生 `<input type=file>`(「选择文件 / 未选择任何文件」)、素的标题框和发白的上传按钮,换成跟读库深色优先玻璃风格的自绘控件:(1) 虚线「选文件磁贴」(图标、「选择视频或音频」、格式与大小/时长限制、SpotlightCard 式按住/悬停高光、桌面拖放),选中后变「文件卡」(类型图标、文件名省略、大小、更换、✕ 移除),超限 / 类型不对在提交前以红色调文字内联提示;(2) 可选字幕变成紧凑的次级行(「字幕(可选,.srt / .vtt)」+「添加」小胶囊,选中后文件名 + ✕);(3) 标题是玻璃输入框、浮动小标签,选文件后自动按文件名填写;(4) 主按钮用 SpecularButton,禁用态一眼能看出,提交后有进行中状态;(5) 链接页签同风格(玻璃输入框 + 粘贴按钮,DRM / 开关关的说明做成着色卡片);(6) 分段页签换成同风格。**行为、测试 id、无障碍和 iOS 文件选择器行为不变。**

**Architecture:** 全部在 `web/src/features/library/`,不新增依赖、不改 `enjoy/`、不改共享组件。真实的 `<input type=file>` 始终留在 DOM 里(视觉隐藏但可聚焦,不是 `hidden` / `display:none`),由 `<label htmlFor>` 触发,所以 iOS Safari 在点按手势里原生打开选择器,没有任何异步的 `input.click()`。拾取控件是**纯展示组件**(`FilePickTile`、`SubtitlePicker`:文字由调用方以 props 传入,不 `useTranslation`),状态仍在 `UploadForm`;校验沿用 `checkUpload`。样式写进 `library.css` 新分节,只用半透明填充 + 高光边,**不加 `backdrop-filter`**(弹层本身是这一屏唯一的模糊层,spec §11.4a),不加 `@keyframes`(只有 `transition`)。

**Tech Stack:** React 18 + TypeScript + Tailwind 令牌 + `lucide-react`(已有)+ vitest / Testing Library / user-event(已有)。无新增 npm 依赖。

**Spec:** `docs/superpowers/specs/2026-10-13-video-import-design.md` §8(上传)、§11.3(添加素材)、§11.4a(视觉与动效)、D11(深色优先玻璃,`mockup-glass.html` 是视觉唯一依据:第 2、3 屏的添加弹层 `.sheet` / `.drop` / `.fileline` / `.inp` / `.seg`)。上游对照:`docs/superpowers/design/video-import-v1/mockup.html`(同一屏的非玻璃版,仅用于确认文案与信息结构)。

## Global Constraints

- **只动 `web/src/features/library/` 与 `docs/`。** 不改 `enjoy/`、`server/`、`web/src/components/`(`SegmentedControl` 只通过它已有的 `className` / `optionClassName` 属性换皮)、`web/src/styles/theme.css`、`ui.ts`。不新增 npm 依赖,不新增 `@keyframes`。
- **模糊层:** `library-css.test.ts` 已断言 `-webkit-backdrop-filter: blur` 只出现 3 次(`.lib-glass`、`.lib-gblur`、`.library-root.lib-sheet`)。本计划新增的任何选择器都不得含 `backdrop-filter`;磁贴、文件卡、字幕行、输入框、提示卡一律「半透明填充 + 高光边」。
- **降级(spec §11.4a、R-L28):** 新增的 `transition` 在 `html.lite` 与 `prefers-reduced-motion: reduce` 下一律 `transition: none`(AP2 写进 `library.css` 末尾两节并有测试守着);主按钮光带已有降级;拖放高亮不依赖动画。进行中的转圈图标沿用 `shadow-panel.tsx` 的 `animate-spin motion-reduce:animate-none`(低端机 `.lite` 下仍会转,和现有一致,见 R-A12)。
- **iOS 文件选择器:** 真实 `<input type=file>` 不得 `hidden` / `display:none` / `disabled`(提交中除外);不得用 `await` 之后再 `input.click()`;触发只用 `<label htmlFor>` 的原生激活。选择后立刻 `e.target.value = ""`,这样再选同一个文件也会触发 `change`,并且 Chrome 在「更换」里取消选择时不会清掉已选文件(R-A4)。
- **隐私:** 剪贴板内容只进输入框的组件状态,不记日志、不进 URL、不进测试快照;链接仍只放在 `POST` 体里(沿用 `importLink`)。文件名不进 URL、不进日志(沿用 `UploadInput` 约定)。
- **测试 id 与可访问名不变:** `library-upload-form`、`library-upload-file`、`library-upload-subtitles`、`library-upload-noasr`、`library-import`、`library-drm-note`、`library-link-disabled`、`library-tab-upload`、`library-tab-link`;标题框标签仍是「标题(可选)」;链接框标签仍是「视频页面链接」;主按钮名仍是「上传」/「导入」;结果提示仍是 `role="alert"`。
- **文案:** 新键只加在 `locales/{en,zh-CN}.json`(`locales.test.ts` 要求两边键与占位符一致、不含 emoji;不要往 `i18n/` 加东西,那里只许留导航标签)。
- **工作树是 CRLF(索引是 LF,`core.autocrlf=true`):** 改现有文件用 Edit 工具(锚点尽量用单行);整份重写或新文件用 Write(LF,提交时 git 规范化)。
- **提交:** conventional,一任务一提交,每个提交后该任务列出的测试全绿,信息以 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` 结尾。
- **只在用户要求时:** 跑全量 `yarn web:test`、`yarn web:build`、E2E、重建容器。每个任务只跑它列出的测试;AP6 与 AP7 之间多跑一次 `yarn vitest run src/architecture.test.ts` 和 `yarn web:typecheck`(类型检查不是测试套件)。
- **验证口径(如实):** 写计划时**读了真实代码**(`add-sheet.tsx`、`upload-form.tsx`、`import-form.tsx`、`ui.ts`、`format.ts`、`library-api.ts` 的 `extOf` / `stemOf` / `limitsOrDefault`、`fx/spotlight-card.tsx`、`fx/specular-button.tsx`、`library.css`、`library-css.test.ts`、`locales.test.ts`、`segmented-control.tsx`、`bottom-sheet.tsx`、`library-list-page.tsx` 与各自测试),**没有运行任何测试、类型检查或构建**,也没有在浏览器里看过效果。下面的测试与实现代码是照真实 API 手写的:执行者第一次运行时以真实结果为准修正(最可能出入的地方:jsdom 的 label 点击转发、user-event 对文件输入的空格键、`fireEvent.drop` 的 `dataTransfer` 垫片、CSS 行数上限)。真机(iOS 选择器、拖放、剪贴板粘贴、暗色玻璃观感)一律「未验证」,见 `2026-10-14-library-add-sheet-polish-device-checklist.md`。

## 对「核对」项的裁定(读真实代码得出)

| 核对项 | 结论 |
|---|---|
| 「library CLAUDE.md」在哪 | **不存在。** `web/src/features/library/` 下没有 `CLAUDE.md`(只有 `server/app/library/` 与 `admin/src/features/library/` 有)。AP7 新建一份(R-A1),不去改别人的。 |
| 校验放哪 | 已有:`upload-form.tsx` 的 `checkUpload(file, limits, subtitles)`(顺序 badType → empty → tooLarge → overQuota → subtitleBadType → subtitleTooLarge,`upload-form.test.tsx` 钉着)。**不重写**;只把字幕两条抽成导出的 `checkSubtitles`,让「先选字幕、后选文件」时也能立刻提示(R-A2)。 |
| 格式化大小 | `format.ts` 的 `formatBytes` 按 MiB 计、一位小数(`0.0 MB` 起),字幕文件几 KB 会显示成 `0.0 MB`。**不改它**(额度条、测试在用),新增 `formatFileSize`(B / KB / 回落到 `formatBytes`)(R-A2)。 |
| 标题推导 | `library-api.ts` 已有 `stemOf`(去目录与最后一个扩展名、≤ 200 字,服务端默认标题同规则)。新增 `deriveTitle` 包一层:下划线与「场景式」点号换成空格;提交仍是 `title.trim() \|\| undefined`(R-A9)。 |
| 弹层怎么关 / 「提交后进行中」放哪 | `library-list-page.tsx` 的 `onUpload` **同步** `setSheetOpen(false)` 再 `uploads.start`,Radix 内容随之卸载;上传进度由列表里的 `ItemCard`(本地 job)显示。所以弹层里没有可见的进度条(R-A10):上传页签只做「提交即禁用 + 转圈 + 文案」防双击,链接页签的 `busy` 才真的可见。**这是与需求字面的偏差,见末尾。** |
| 原生文件框怎么藏 | 现有测试用 `getByTestId("library-upload-file")` + `fireEvent.change`,且 `accept` 被断言。真实框保留 testid / `accept`;类 `lib-pick-input`(绝对定位 1×1、`opacity:0`、`clip-path`、`pointer-events:none`),**不是** `hidden`(R-A3)。 |
| SpotlightCard 能不能用 | 能:它是 `div`,把 `...rest`(含 `onDrag*`、`data-*`)展开到 DOM,指针事件只写 `--mx/--my`。但它自带 `overflow:hidden`,高光 `::before` 是绝对定位——内容层必须 `position:relative` 才在高光之上(R-A6)。 |
| 分段页签能不能改 | `SegmentedControl` 是共享组件,不改。它把 `className` 合并到轨道、`optionClassName` 合并到每个选项(`cn` = tailwind-merge),换皮靠 `.library-root .lib-seg …` 这类更高特异性的选择器(弹层本身带 `library-root`,Portal 里也生效)(R-A8)。 |
| 一屏模糊层 | 弹层 `.library-root.lib-sheet` 已是第一层(`library-css.test.ts` 数到 3 个声明);页面后面没有别的模糊(列表卡是 `lib-tint`)。新控件不加。 |
| CSS 体积上限 | `library-css.test.ts` 有 `css.length < 22_000`,现在 `library.css` 是 20,634 字节(含 CRLF)。新分节约 4–5 KB,必然超。AP2 把上限改为 `28_000`(R-A11);spec 的 gzip ≤ 6 kB 目标不变,**未实测**。 |
| `checkUpload` 的 `overQuota` 文案 | 已有(`web.library.upload.overQuota`),磁贴下面照用,不新增。 |
| 粘贴按钮 | `navigator.clipboard.readText` 只在安全上下文有;iOS 会弹「粘贴」确认气泡,必须在点击手势里调用。没有该 API 就不渲染按钮;被拒绝就静默(不弹错),让用户长按输入框自己粘贴(R-A13)。 |

## 本计划的裁定

- **R-A1 库的 `CLAUDE.md`:** 不存在,AP7 新建 `web/src/features/library/CLAUDE.md`(英文,与 `src/features/lookup/CLAUDE.md` 同结构),只写读真实代码得到的事实。
- **R-A2 helpers:** 新文件 `add-sheet-helpers.ts`:`formatFileSize`、`formatsHint`、`fileKind`、`deriveTitle`。校验仍是 `checkUpload`,新增导出 `checkSubtitles`。
- **R-A3 选文件磁贴 = `label` + 视觉隐藏的真实输入。** 结构:`div.lib-pick-wrap`(拖放目标)> `input.lib-pick-input`(第一个子元素)+(空态 `SpotlightCard.lib-pick.lib-pick-surface > label.lib-pick-face[for]` | 选中态 `div.lib-pick-card.lib-tint.lib-pick-surface`)+ 错误行。键盘:Tab 聚焦的是真实输入(浏览器原生 Enter / 空格打开选择器),焦点环画在兄弟元素上:`.lib-pick-input:focus-visible ~ .lib-pick-surface`。
- **R-A4 每次读完 `files[0]` 就清空 `value`;空的 `change`(取消)被忽略。** 与 `library-list-page.tsx` 的 `onSubtitlesChosen` 同一做法。移除后把焦点交回真实输入。
- **R-A5 拖放:** 处理函数在 `lib-pick-wrap` 上(空态与选中态都接受拖入以「更换」);只接 `dataTransfer.types` 含 `Files` 的拖动;只取第一个文件;拖入的文件**绕过 `accept`**,所以类型不对要靠 `checkUpload` 的 `badType` 显示(测试覆盖)。拖放高亮用 `data-drag` 属性,CSS 换边框色与底色。`onDragLeave` 用 `contains(relatedTarget)` 避免子元素间闪烁。字幕行不做拖放(需求只要求主文件)。
- **R-A6 SpotlightCard 作磁贴;** 内容层 `position:relative`;`.lib-pick` 写在 `.lib-tint` 之后,用同特异性的「后者胜」把实线边改成虚线。
- **R-A7 不加模糊、不加 `@keyframes`:** `library-css.test.ts` 新增断言守着。
- **R-A8 页签换皮:** `className="lib-seg flex w-full"`、`optionClassName="flex-1"`。
- **R-A9 标题:** 用户没碰过标题框(`titleTouched=false`)时,选 / 换 / 移除文件会同步 `deriveTitle(file.name)`;一旦用户输入过就不再覆盖。提交的 `title` 仍是 `title.trim() || undefined`。标签是框内上方的小字(「浮动标签」常驻上浮形态,不做动画),框下方在自动填写时有一行小字「已根据文件名填写,可以修改。」。
- **R-A10 上传页签的进行中状态:** 提交后 `submitted=true`:按钮禁用、转圈、「正在加入上传…」,表单 `aria-busy`;不渲染进度条(弹层随即被父组件关掉,真实进度在列表卡)。
- **R-A11 `library-css.test.ts` 体积上限 22_000 → 28_000。**
- **R-A12 `.lite` 下的转圈图标不单独处理(沿用 `shadow-panel.tsx`)。**
- **R-A13 粘贴:** 有 `navigator.clipboard.readText` 才渲染;成功 → `setUrl(text.trim())` 并清掉旧错误;失败或空 → 聚焦输入框,不报错。
- **R-A14 主按钮用 `SpecularButton`(`fx/specular-button.tsx`)而不是 `PRIMARY` 类串;** 禁用态在 `library.css` 加一条 `.library-root .lib-spec:disabled`(灰玻璃底、淡字、无光带),比 `disabled:opacity-40` 更醒目。`ui.ts` 不动。
- **R-A15 `subtitles` 文案改为「字幕(可选,.srt / .vtt)」(英文同步),键名不变。** 之前的「.srt 或 .vtt」只出现在 `locales/` 与 2026-10-13 的旧计划里,没有测试或 E2E 引用。

## 文件结构与共享文件风险

```
web/src/features/library/
  add-sheet-helpers.ts                 新(AP1)  formatFileSize / formatsHint / fileKind / deriveTitle
  add-sheet-helpers.test.ts            新(AP1)
  library.css                          [改](AP2)  新分节「添加素材表单」+ 禁用态 + 两处降级
  library-css.test.ts                  [改](AP2)  体积上限 + 新断言
  locales/{en,zh-CN}.json              [改](AP2)  新键 + subtitles 文案
  locales.test.ts                      [改](AP2)  新键存在
  file-pick-tile.tsx / .test.tsx       新(AP3)
  subtitle-picker.tsx / .test.tsx      新(AP4)
  upload-form.tsx / .test.tsx          [改](AP5)  checkSubtitles 抽出;整份重写表单
  import-form.tsx / .test.tsx          [改](AP6)
  add-sheet.tsx / .test.tsx            [改](AP6)  页签换皮 + 新断言
  CLAUDE.md                            新(AP7)
docs/superpowers/plans/2026-10-14-library-add-sheet-polish-device-checklist.md   新(AP7)
```

共享文件风险:`library.css` 与 `locales/*.json` 是库里别的计划也会改的文件(例如 2026-10-13 的 `library-alignment`、后续跟读面板计划)——本计划只在指定锚点处插入新分节 / 新键,合并时保留双方。`upload-form.tsx` 的导出(`UploadForm`、`checkUpload`、`UploadProblem`)签名不变,`library-list-page.tsx` 与 `add-sheet.tsx` 的调用处不用改。

---

## Task AP1: 纯函数 helpers

**Files:**
- Create: `web/src/features/library/add-sheet-helpers.ts`
- Create: `web/src/features/library/add-sheet-helpers.test.ts`

- [ ] **Step 1: 先写测试** `web/src/features/library/add-sheet-helpers.test.ts`

```ts
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
```

- [ ] **Step 2: 跑,确认失败**

`cd web && yarn vitest run src/features/library/add-sheet-helpers.test.ts`
预期:FAIL(`Failed to resolve import "./add-sheet-helpers"`)。

- [ ] **Step 3: 实现** `web/src/features/library/add-sheet-helpers.ts`

```ts
import { formatBytes } from "./format";
import { MAX_TITLE_CHARS, MIB, extOf, stemOf } from "./library-api";

const KIB = 1024;

/** 选中文件卡上的大小:不足 1 KiB 用 B,不足 1 MiB 用 KB,其余沿用 `formatBytes`(MiB 计,R-L18)。 */
export function formatFileSize(bytes: number): string {
  const n = Math.max(0, bytes);
  if (n < KIB) return `${Math.round(n)} B`;
  if (n < MIB) {
    const kb = n / KIB;
    return kb >= 100 ? `${Math.round(kb)} KB` : `${kb.toFixed(1)} KB`;
  }
  return formatBytes(n);
}

/** 磁贴上的格式提示:「mp4 · mov · mkv +9」,最多列 `max` 个。 */
export function formatsHint(formats: readonly string[], max = 6): string {
  const list = formats.map((f) => f.toLowerCase());
  if (list.length <= max) return list.join(" · ");
  return `${list.slice(0, max).join(" · ")} +${list.length - max}`;
}

export type FileKind = "video" | "audio" | "other";

const VIDEO_EXT = new Set(["mp4", "m4v", "mov", "webm", "mkv"]);
const AUDIO_EXT = new Set(["mp3", "m4a", "aac", "wav", "ogg", "opus", "flac"]);

/** 文件卡的图标类型:先看扩展名(白名单),再看 MIME。 */
export function fileKind(file: { name: string; type?: string }): FileKind {
  const ext = extOf(file.name);
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  if (file.type?.startsWith("video/")) return "video";
  if (file.type?.startsWith("audio/")) return "audio";
  return "other";
}

/**
 * 选文件后自动填进标题框的名字:文件名主干(`stemOf`,与服务端默认标题同规则);
 * 下划线换空格;名字里没有空格时(「Friends.S01E02.720p」这类)点号也换空格。
 */
export function deriveTitle(filename: string): string {
  const stem = stemOf(filename);
  let title = stem.replace(/_+/g, " ");
  if (!/\s/.test(title)) title = title.replace(/\./g, " ");
  title = title.replace(/\s+/g, " ").trim();
  return (title || stem).slice(0, MAX_TITLE_CHARS);
}
```

- [ ] **Step 4: 跑,确认通过**

`cd web && yarn vitest run src/features/library/add-sheet-helpers.test.ts` → 全绿。若 `deriveTitle("Mr. Bean live.mp4")` 或 `a..b` 的期望与实现不符,以实现的规则为准修正**测试期望**之前,先核对规则是否真的写错(规则以上面注释为准)。

- [ ] **Step 5: 提交**

```
git add web/src/features/library/add-sheet-helpers.ts web/src/features/library/add-sheet-helpers.test.ts
git commit -m "feat(web): add-sheet helpers for file size, formats hint, file kind and title"
```
提交信息正文空一行后以 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` 结尾(下同)。

---

## Task AP2: 文案与样式(`library.css`、两份 locale)

先加样式与文案,后面三个组件任务才有东西可挂。

**Files:**
- Modify: `web/src/features/library/library.css`
- Modify: `web/src/features/library/library-css.test.ts`
- Modify: `web/src/features/library/locales/en.json`
- Modify: `web/src/features/library/locales/zh-CN.json`
- Modify: `web/src/features/library/locales.test.ts`

- [ ] **Step 1: 先写测试**

(a) `library-css.test.ts`:把「stays small」那条的上限改掉(R-A11):

```ts
  it("stays small (target: library styles + effects ≤ 6 kB gzip in total, measured in L16)", () => {
    expect(css.length).toBeLessThan(28_000); // 22_000 → 28_000:添加素材表单分节(R-A11);gzip 目标不变,未实测
  });
```

(b) 同文件,在「keeps the sentence text selectable」那条之后追加一条 `it`(放在 `describe` 内):

```ts
  it("styles the add-sheet form without new blur layers or keyframes, and keeps the real file input focusable (R-A3, R-A7)", () => {
    const section = sectionAfter(css, "添加素材表单");
    expect(section).not.toContain("backdrop-filter");
    expect(section).not.toContain("@keyframes");
    // 真实的文件框:视觉隐藏,但不是 display:none(iOS 与键盘都要它)
    const input = blockOf(css, /^\.lib-pick-input\s*\{/m);
    expect(input).toContain("opacity: 0;");
    expect(input).toContain("clip-path: inset(50%);");
    expect(input).not.toContain("display: none");
    expect(css).toMatch(/\.lib-pick-input:focus-visible ~ \.lib-pick-surface\s*\{/);
    // 磁贴是虚线边;输入框 16px 防 iOS 缩放
    expect(blockOf(css, /^\.lib-pick\s*\{/m)).toContain("dashed");
    expect(blockOf(css, /^\.library-root \.lib-ffield-input\s*\{/m)).toContain("font-size: 16px;");
    // 命中区:更换 / 移除按钮 44px
    expect(blockOf(css, /^\.lib-pick-act\s*\{/m)).toContain("min-height: 44px;");
    // 禁用的主按钮不再扫光
    expect(css).toMatch(/\.library-root \.lib-spec:disabled::after\s*\{\s*display: none;/);
  });

  it("drops the add-sheet transitions under reduced motion and on low-end devices (R-L28)", () => {
    const reduced = blockOf(css, /@media \(prefers-reduced-motion: reduce\)\s*\{/);
    const lite = sectionAfter(css, "降级:低端机");
    for (const selector of [".lib-pick", ".lib-pick-card", ".library-root .lib-ffield"]) {
      expect(reduced, `reduced-motion: ${selector}`).toContain(selector);
      expect(lite, `lite: ${selector}`).toContain(`html.lite ${selector}`);
    }
  });
```

(c) `locales.test.ts`:在 `describe("library locales …")` 内追加:

```ts
  it("has the add-sheet polish strings (plan 2026-10-14-library-add-sheet-polish)", () => {
    for (const k of [
      "pickTitle", "pickDrop", "pickDrag", "formats", "replace", "remove", "subtitlesAdd", "subtitlesRemove", "titleAuto", "submitting",
    ]) expect(a).toHaveProperty([`web.library.upload.${k}`]);
    for (const k of ["paste", "submitting"]) expect(a).toHaveProperty([`web.library.link.${k}`]);
    expect(b["web.library.upload.subtitles"]).toBe("字幕(可选,.srt / .vtt)");
    expect(a["web.library.upload.subtitles"]).toBe("Subtitles (optional, .srt / .vtt)");
    expect(placeholders(a["web.library.upload.formats"])).toEqual(["list"]);
  });
```

- [ ] **Step 2: 跑,确认失败**

`cd web && yarn vitest run src/features/library/library-css.test.ts src/features/library/locales.test.ts`
预期:新增三条失败(缺分节 / 缺键),其余仍绿。

- [ ] **Step 3: locale 文案**

`locales/zh-CN.json` —— 用 Edit,两处:

1. old `"subtitles": "字幕(可选,.srt 或 .vtt)",` → new `"subtitles": "字幕(可选,.srt / .vtt)",`
2. old `"noAsr": "没有字幕时本服务器无法自动转写,请同时上传字幕文件。"` → new:

```
"noAsr": "没有字幕时本服务器无法自动转写,请同时上传字幕文件。",
        "pickTitle": "选择视频或音频",
        "pickDrop": "松开即可添加",
        "pickDrag": "也可以把文件拖到这里",
        "formats": "格式:{{list}}",
        "replace": "更换",
        "remove": "移除文件",
        "subtitlesAdd": "添加",
        "subtitlesRemove": "移除字幕",
        "titleAuto": "已根据文件名填写,可以修改。",
        "submitting": "正在加入上传…"
```
3. old `"note": "由服务器下载视频,可能需要几分钟。"` → new:

```
"note": "由服务器下载视频,可能需要几分钟。",
        "paste": "粘贴",
        "submitting": "导入中…"
```

`locales/en.json` —— 同样三处:

1. old `"subtitles": "Subtitles (optional, .srt or .vtt)",` → new `"subtitles": "Subtitles (optional, .srt / .vtt)",`
2. old `"noAsr": "Without subtitles this server cannot transcribe the audio, so add a subtitle file."` → new:

```
"noAsr": "Without subtitles this server cannot transcribe the audio, so add a subtitle file.",
        "pickTitle": "Choose a video or audio file",
        "pickDrop": "Drop to add",
        "pickDrag": "or drag a file here",
        "formats": "Formats: {{list}}",
        "replace": "Replace",
        "remove": "Remove file",
        "subtitlesAdd": "Add",
        "subtitlesRemove": "Remove subtitles",
        "titleAuto": "Filled in from the file name. You can edit it.",
        "submitting": "Adding to uploads…"
```
3. old `"note": "The server downloads the video. This can take a few minutes."` → new:

```
"note": "The server downloads the video. This can take a few minutes.",
        "paste": "Paste",
        "submitting": "Importing…"
```

(`…` 是省略号字符,不是 emoji;`locales.test.ts` 的 emoji 断言不会误伤。缩进以文件里现有键为准。)

- [ ] **Step 4: 样式** —— `library.css` 三处 Edit:

**(i)** 在分节标题行 `/* ===== 播放器:顶栏胶囊、媒体区、句子列表 ===== */`(单行,唯一)**之前**插入下面整段(old_string 取这一行,new_string = 下面整段 + 空行 + 原行):

```css
/* ===== 添加素材表单(计划 2026-10-14-library-add-sheet-polish):页签换皮、选文件磁贴、文件卡、字幕行、玻璃输入框、提示卡。
   只用半透明填充 + 高光边,不加 backdrop-filter(弹层本身是这一屏唯一的模糊层);只有 transition,没有 @keyframes(R-A7) ===== */
.library-root .lib-seg { background: var(--lib-chip); border: 0.5px solid var(--lib-hair); border-radius: 16px; }
.library-root .lib-seg [role="radio"] { border-radius: 13px; }
.library-root .lib-seg [role="radio"][aria-checked="true"] {
  background: var(--lib-solid);
  border-color: var(--lib-glass-bd);
  box-shadow: var(--lib-glass-hi), 0 2px 6px -2px rgba(0, 0, 0, 0.35);
}

/* 真实的 <input type=file>:视觉隐藏但可聚焦(不是 display:none,iOS 与键盘都要它);焦点环画在紧随其后的磁贴 / 文件卡上 */
.lib-pick-wrap { position: relative; }
.lib-pick-input {
  position: absolute;
  left: 0;
  top: 0;
  width: 1px;
  height: 1px;
  margin: 0;
  padding: 0;
  border: 0;
  opacity: 0;
  overflow: hidden;
  clip-path: inset(50%);
  pointer-events: none;
}
.lib-pick-input:focus-visible ~ .lib-pick-surface { outline: 2px solid rgb(var(--ring)); outline-offset: 2px; }

/* 磁贴:SpotlightCard(.lib-spot .lib-tint)改成虚线边;内容层 position:relative,才在高光 ::before 之上 */
.lib-pick {
  border: 1.5px dashed var(--lib-glass-bd);
  border-radius: 20px;
  transition: border-color 0.2s, background-color 0.2s, transform 0.15s;
}
.lib-pick-face {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 20px 14px 16px;
  text-align: center;
  cursor: pointer;
}
.lib-pick[data-press] { transform: scale(0.99); }
@media (hover: hover) {
  .lib-pick:hover { border-color: rgb(var(--blue)); }
}
.lib-pick-wrap[data-drag] .lib-pick { border-color: rgb(var(--blue)); background: var(--lib-blue-tint); }
.lib-pick-wrap[data-drag] .lib-pick::before { opacity: 1; }
@media (hover: none) {
  .lib-pick-drag { display: none; }
}
.lib-pick-ico {
  display: grid;
  flex: none;
  place-items: center;
  width: 44px;
  height: 44px;
  margin-bottom: 4px;
  border-radius: 14px;
  color: rgb(var(--blue));
  background: var(--lib-blue-tint);
}
.lib-pick-ico svg { width: 24px; height: 24px; }

/* 文件卡(选中后) */
.lib-pick-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 6px 10px 12px;
  border-radius: 20px;
  transition: border-color 0.2s, background-color 0.2s;
}
.lib-pick-card .lib-pick-ico { margin-bottom: 0; }
.lib-pick-card[data-invalid],
.lib-subrow[data-invalid] { border-color: rgb(var(--red)); background: var(--red-tint); }
.lib-pick-meta { display: flex; flex: 1; flex-direction: column; min-width: 0; }
.lib-pick-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lib-pick-act {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  padding: 0 10px;
  border-radius: 14px;
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--blue));
  cursor: pointer;
}
.lib-pick-x { color: rgb(var(--ink-2)); }
.lib-pick-x svg { width: 18px; height: 18px; }

/* 字幕行:紧凑的次级行;「添加」复用播放器的 .lib-chip(34px 视觉、44px 命中) */
.lib-subrow {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 4px 6px 4px 10px;
  border-radius: 16px;
  background: var(--lib-chip);
  border: 0.5px solid var(--lib-hair);
}
.lib-subrow .lib-pick-ico { width: 34px; height: 34px; margin-bottom: 0; border-radius: 11px; }
.lib-subrow .lib-pick-ico svg { width: 18px; height: 18px; }
.lib-sub-add { flex: none; margin-right: 4px; font-weight: 600; color: rgb(var(--blue)); cursor: pointer; }

/* 玻璃输入框:框内上方是常驻上浮的小标签;聚焦时蓝边 + 淡蓝光晕(代替浏览器默认焦点环) */
.library-root .lib-ffield {
  position: relative;
  display: block;
  border-radius: 16px;
  background: var(--lib-chip);
  border: 0.5px solid var(--lib-hair);
  transition: border-color 0.2s, box-shadow 0.2s;
}
.library-root .lib-ffield:focus-within { border-color: rgb(var(--blue)); box-shadow: 0 0 0 3px var(--lib-blue-tint); }
.lib-ffield-in { display: block; }
.lib-ffield-label { display: block; padding: 8px 14px 0; font-size: 11.5px; line-height: 1.2; color: rgb(var(--ink-2)); }
.library-root .lib-ffield-input {
  display: block;
  width: 100%;
  height: 32px;
  padding: 0 14px 6px;
  border: 0;
  border-radius: 0 0 16px 16px;
  background: none;
  font-size: 16px;
  color: rgb(var(--ink));
  -webkit-appearance: none;
  appearance: none;
}
.lib-ffield-input:focus { outline: none; }
.lib-ffield-input::placeholder { color: rgb(var(--ink-3)); }
.lib-ffield--paste .lib-ffield-input { padding-right: 84px; }
.lib-ffield-paste { position: absolute; right: 8px; bottom: 6px; }

/* 提示卡:DRM / 开关关 / 没有转写 / 错误;着色靠令牌 amber / red 的 tint */
.lib-note {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 16px;
  font-size: 13px;
  line-height: 1.5;
  color: rgb(var(--ink));
  background: var(--lib-chip);
  border: 0.5px solid var(--lib-hair);
}
.lib-note p { flex: 1; min-width: 0; margin: 0; }
.lib-note svg { flex: none; width: 18px; height: 18px; margin-top: 1px; color: rgb(var(--ink-2)); }
.lib-note--warn { background: var(--amber-tint); border-color: rgb(var(--amber) / 0.35); }
.lib-note--warn svg { color: rgb(var(--amber)); }
.lib-note--err { background: var(--red-tint); border-color: rgb(var(--red) / 0.4); }
.lib-note--err svg,
.lib-note--err p { color: rgb(var(--red)); }

/* 禁用的主按钮:灰玻璃底 + 淡字 + 不扫光(比 opacity-40 醒目) */
.library-root .lib-spec:disabled { opacity: 0.7; color: rgb(var(--ink-3)); background: var(--lib-chip); box-shadow: none; }
.library-root .lib-spec:disabled::after { display: none; }
```

**(ii)** 减少动态效果:old `  .lib-slider-knob { transition: none; }` → new:

```
  .lib-slider-knob,
  .lib-pick,
  .lib-pick-card,
  .library-root .lib-ffield { transition: none; }
```

**(iii)** 低端机:old `html.lite .lib-bw { animation: none; opacity: 1; filter: none; transform: none; }` → new = 原行 + 换行 +

```
html.lite .lib-pick,
html.lite .lib-pick-card,
html.lite .library-root .lib-ffield { transition: none; }
```

(`library-css.test.ts` 的「scoped」测试要求每一行以 `html.lite` 开头的都形如 `html.lite .lib-…` 或 `html.lite .library-root …`,上面三行都满足。)

- [ ] **Step 5: 跑,确认通过**

`cd web && yarn vitest run src/features/library/library-css.test.ts src/features/library/locales.test.ts`
预期全绿。若「体积」仍超限,以实际 `css.length` 为准调整上限并在提交信息里写实数(不要删样式凑数);若 `blockOf(css, /^\.lib-pick\s*\{/m)` 因行首被占用失败,检查新分节是否被缩进了。

- [ ] **Step 6: 提交**

```
git add web/src/features/library/library.css web/src/features/library/library-css.test.ts web/src/features/library/locales web/src/features/library/locales.test.ts
git commit -m "feat(web): glass styles and strings for the library add sheet form"
```

---

## Task AP3: `FilePickTile` 组件

**Files:**
- Create: `web/src/features/library/file-pick-tile.tsx`
- Create: `web/src/features/library/file-pick-tile.test.tsx`

- [ ] **Step 1: 先写测试** `web/src/features/library/file-pick-tile.test.tsx`

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FilePickTile, type FilePickTileProps } from "./file-pick-tile";

const file = (name: string, size = 100, type = "") => new File([new Uint8Array(size)], name, { type });

function setup(over: Partial<FilePickTileProps> = {}) {
  const onFile = vi.fn();
  const utils = render(
    <FilePickTile file={null} onFile={onFile} accept="audio/*,video/*,.mp4" inputTestId="pick" label="Media file" title="Choose media"
      dropLabel="Drop here" dragHint="or drag" replaceLabel="Replace" removeLabel="Remove" {...over}>
      <span>hint line</span>
    </FilePickTile>,
  );
  return { onFile, input: screen.getByTestId("pick") as HTMLInputElement, ...utils };
}

describe("FilePickTile: empty state (R-A3)", () => {
  it("keeps the real file input in the DOM, visually hidden but focusable, and shows the tile", () => {
    const { input } = setup();
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", "audio/*,video/*,.mp4");
    expect(input).toHaveAttribute("aria-label", "Media file");
    expect(input.className).toMatch(/\blib-pick-input\b/);
    expect(input).not.toHaveAttribute("hidden");
    expect(input).not.toBeDisabled();
    expect(input.tabIndex).toBe(0);
    expect(screen.getByTestId("pick-tile").className).toMatch(/\blib-spot\b/);
    expect(screen.getByText("Choose media")).toBeInTheDocument();
    expect(screen.getByText("hint line")).toBeInTheDocument();
    expect(screen.getByText("or drag")).toBeInTheDocument();
    expect(screen.queryByTestId("pick-card")).toBeNull();
  });

  it("opens the picker through the label (a native activation, so iOS opens it inside the tap)", () => {
    const { input } = setup();
    const onClick = vi.fn();
    input.addEventListener("click", onClick);
    const face = screen.getByText("Choose media").closest("label") as HTMLLabelElement;
    expect(face).toHaveAttribute("for", input.id);
    fireEvent.click(screen.getByText("Choose media"));
    expect(onClick).toHaveBeenCalledTimes(1); // jsdom 转发 label 点击;若这一句在 jsdom 里不成立,只保留上面的 for 断言
  });

  it("is reachable by keyboard: Tab lands on the real input", async () => {
    const { input } = setup();
    const user = userEvent.setup();
    await user.tab();
    expect(input).toHaveFocus();
    const onClick = vi.fn();
    input.addEventListener("click", onClick);
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalled(); // user-event 把空格当作点击;若它不处理文件框,删掉这一句(原生行为靠真机清单验证)
  });

  it("hands the chosen file up, clears the input value and ignores an empty change (R-A4)", () => {
    const { input, onFile } = setup();
    const f = file("a.mp4");
    fireEvent.change(input, { target: { files: [f] } });
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile).toHaveBeenCalledWith(f);
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { files: [] } });
    expect(onFile).toHaveBeenCalledTimes(1);
  });
});

describe("FilePickTile: drag and drop (R-A5)", () => {
  it("highlights while a file is dragged over, and resets on leave", () => {
    setup();
    const drop = screen.getByTestId("pick-drop");
    fireEvent.dragOver(drop, { dataTransfer: { types: ["Files"] } });
    expect(drop).toHaveAttribute("data-drag");
    expect(screen.getByText("Drop here")).toBeInTheDocument();
    expect(screen.queryByText("Choose media")).toBeNull();
    fireEvent.dragLeave(drop);
    expect(drop).not.toHaveAttribute("data-drag");
    expect(screen.getByText("Choose media")).toBeInTheDocument();
  });

  it("takes only the first dropped file", () => {
    const { onFile } = setup();
    const a = file("a.mp4");
    const b = file("b.mp4");
    fireEvent.drop(screen.getByTestId("pick-drop"), { dataTransfer: { types: ["Files"], files: [a, b] } });
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile).toHaveBeenCalledWith(a);
    expect(screen.getByTestId("pick-drop")).not.toHaveAttribute("data-drag");
  });

  it("passes a dropped file of the wrong type up too, so validation can say so", () => {
    const { onFile } = setup();
    const exe = file("a.exe");
    fireEvent.drop(screen.getByTestId("pick-drop"), { dataTransfer: { types: ["Files"], files: [exe] } });
    expect(onFile).toHaveBeenCalledWith(exe);
  });

  it("ignores drags that are not files (text, links)", () => {
    const { onFile } = setup();
    const drop = screen.getByTestId("pick-drop");
    fireEvent.dragOver(drop, { dataTransfer: { types: ["text/plain"] } });
    expect(drop).not.toHaveAttribute("data-drag");
    fireEvent.drop(drop, { dataTransfer: { types: ["text/plain"], files: [] } });
    expect(onFile).not.toHaveBeenCalled();
  });

  it("does nothing while disabled", () => {
    const { onFile, input } = setup({ disabled: true });
    const drop = screen.getByTestId("pick-drop");
    expect(input).toBeDisabled();
    fireEvent.dragOver(drop, { dataTransfer: { types: ["Files"] } });
    expect(drop).not.toHaveAttribute("data-drag");
    fireEvent.drop(drop, { dataTransfer: { types: ["Files"], files: [file("a.mp4")] } });
    expect(onFile).not.toHaveBeenCalled();
  });
});

describe("FilePickTile: chosen state", () => {
  it("shows a file card with the name (ellipsized by CSS, full name in title), size and kind", () => {
    const { input } = setup({ file: file("A very long episode name.mp4", 1536) });
    const name = screen.getByText("A very long episode name.mp4");
    expect(name).toHaveAttribute("title", "A very long episode name.mp4");
    expect(name.className).toMatch(/\blib-pick-name\b/);
    expect(screen.getByText("1.5 KB")).toBeInTheDocument();
    expect(screen.getByTestId("pick-card")).toHaveAttribute("data-kind", "video");
    expect(screen.queryByTestId("pick-tile")).toBeNull();
    expect(screen.getByTestId("pick")).toBe(input); // 真实输入还在,「更换」复用它
  });

  it("uses the audio kind for audio files", () => {
    setup({ file: file("a.mp3") });
    expect(screen.getByTestId("pick-card")).toHaveAttribute("data-kind", "audio");
  });

  it("replaces through the same input, and still accepts a drop", () => {
    const { input, onFile } = setup({ file: file("a.mp4") });
    const onClick = vi.fn();
    input.addEventListener("click", onClick);
    const replace = screen.getByText("Replace");
    expect(replace.closest("label")).toHaveAttribute("for", input.id);
    fireEvent.click(replace);
    expect(onClick).toHaveBeenCalledTimes(1);
    const next = file("b.mp4");
    fireEvent.drop(screen.getByTestId("pick-drop"), { dataTransfer: { types: ["Files"], files: [next] } });
    expect(onFile).toHaveBeenCalledWith(next);
  });

  it("removes the file and puts the focus back on the real input", () => {
    const { input, onFile } = setup({ file: file("a.mp4") });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onFile).toHaveBeenCalledWith(null);
    expect(input).toHaveFocus();
  });

  it("marks a problem on the card and announces it, tied to the input", () => {
    const { input } = setup({ file: file("a.mp4"), problem: "Too big" });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Too big");
    expect(screen.getByTestId("pick-card")).toHaveAttribute("data-invalid");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", alert.id);
  });

  it("has no alert and no invalid mark without a problem", () => {
    const { input } = setup({ file: file("a.mp4") });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("pick-card")).not.toHaveAttribute("data-invalid");
    expect(input).not.toHaveAttribute("aria-invalid");
  });
});
```

- [ ] **Step 2: 跑,确认失败**

`cd web && yarn vitest run src/features/library/file-pick-tile.test.tsx` → FAIL(模块不存在)。

- [ ] **Step 3: 实现** `web/src/features/library/file-pick-tile.tsx`

```tsx
import { ClapperboardIcon, FileIcon, MusicIcon, UploadIcon, XIcon } from "lucide-react";
import { type DragEvent, type ReactNode, useId, useRef, useState } from "react";
import { fileKind, formatFileSize } from "./add-sheet-helpers";
import { SpotlightCard } from "./fx/spotlight-card";
import "./library.css";

const KIND_ICON = { video: ClapperboardIcon, audio: MusicIcon, other: FileIcon } as const;

/** 只接「文件」拖动:拖文字 / 链接进来不亮落点,也不吃掉 drop。 */
function dragHasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

export interface FilePickTileProps {
  file: File | null;
  /** 选中 / 拖入一个文件时给文件;点 ✕ 时给 null。取消选择器不会调用。 */
  onFile: (file: File | null) => void;
  accept: string;
  /** 真实 `<input type=file>` 的 data-testid;同时派生 `${id}-drop`(拖放容器)、`${id}-tile`(空态)、`${id}-card`(选中态)。 */
  inputTestId?: string;
  /** 真实输入的可访问名称(磁贴里的可见文字很长,不拿它当名称)。 */
  label: string;
  title: string;
  /** 拖着文件悬停时代替标题的文字。 */
  dropLabel: string;
  /** 「也可以把文件拖到这里」:触屏设备上由 CSS 隐藏。 */
  dragHint?: string;
  replaceLabel: string;
  removeLabel: string;
  /** 已本地化的问题文案;有值时文件卡变红色调并 role="alert"。 */
  problem?: string | null;
  disabled?: boolean;
  /** 空态磁贴里标题下面的提示行(格式、大小 / 时长限制)。 */
  children?: ReactNode;
}

/**
 * 选文件磁贴(R-A3):真实的 `<input type=file>` 始终在 DOM 里,视觉隐藏但可聚焦(`.lib-pick-input`);
 * 空态是 SpotlightCard 虚线磁贴,里面的 `<label htmlFor>` 触发选择器(点按手势里的原生激活,iOS 也能开);
 * 选中后变文件卡(类型图标、文件名省略、大小、更换、✕)。纯展示:文字都由调用方传入,状态在调用方。
 */
export function FilePickTile({
  file, onFile, accept, inputTestId, label, title, dropLabel, dragHint, replaceLabel, removeLabel, problem, disabled = false, children,
}: FilePickTileProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const tid = (suffix: string) => (inputTestId ? `${inputTestId}-${suffix}` : undefined);

  const over = (e: DragEvent<HTMLDivElement>) => {
    if (disabled || !dragHasFiles(e)) return;
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = "copy";
    } catch { /* 个别浏览器 / 测试垫片的 dataTransfer 只读 */ }
    setDragging(true);
  };
  const leave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
  };
  const drop = (e: DragEvent<HTMLDivElement>) => {
    if (disabled || !dragHasFiles(e)) return;
    e.preventDefault();
    setDragging(false);
    const first = e.dataTransfer.files?.[0];
    if (first) onFile(first); // 拖入的文件绕过 accept:类型不对由 checkUpload 提示(R-A5)
  };
  const remove = () => {
    onFile(null);
    input.current?.focus();
  };

  const Icon = file ? KIND_ICON[fileKind(file)] : UploadIcon;

  return (
    <div className="lib-pick-wrap" data-testid={tid("drop")} data-drag={dragging ? "" : undefined}
      onDragEnter={over} onDragOver={over} onDragLeave={leave} onDrop={drop}>
      <input
        ref={input}
        id={id}
        type="file"
        accept={accept}
        disabled={disabled}
        data-testid={inputTestId}
        className="lib-pick-input"
        aria-label={label}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? errorId : undefined}
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = ""; // 再选同一个文件也触发 change;「更换」里取消不会清掉已选(R-A4)
          if (picked) onFile(picked);
        }}
      />
      {file ? (
        <div className="lib-pick-card lib-tint lib-pick-surface" data-testid={tid("card")} data-kind={fileKind(file)} data-invalid={problem ? "" : undefined}>
          <span className="lib-pick-ico" aria-hidden><Icon /></span>
          <span className="lib-pick-meta">
            <span className="lib-pick-name text-body font-semibold text-ink" title={file.name}>{file.name}</span>
            <span className="num text-meta text-ink-2">{formatFileSize(file.size)}</span>
          </span>
          <label htmlFor={id} className="lib-pick-act">{replaceLabel}</label>
          <button type="button" className="lib-pick-act lib-pick-x" aria-label={removeLabel} disabled={disabled} onClick={remove}>
            <XIcon aria-hidden />
          </button>
        </div>
      ) : (
        <SpotlightCard className="lib-pick lib-pick-surface" data-testid={tid("tile")}>
          <label htmlFor={id} className="lib-pick-face">
            <span className="lib-pick-ico" aria-hidden><Icon /></span>
            <span className="text-body font-semibold text-ink">{dragging ? dropLabel : title}</span>
            {children}
            {dragHint ? <span className="lib-pick-drag text-meta text-ink-3">{dragHint}</span> : null}
          </label>
        </SpotlightCard>
      )}
      {problem ? <p id={errorId} role="alert" className="mt-1.5 text-meta text-red">{problem}</p> : null}
    </div>
  );
}
```

- [ ] **Step 4: 跑,确认通过**

`cd web && yarn vitest run src/features/library/file-pick-tile.test.tsx src/features/library/fx/spotlight-card.test.tsx` → 全绿。
可能的出入:(1) jsdom 的 label 点击转发(见测试里的注释);(2) user-event 对文件输入的空格键;(3) `fireEvent.dragOver` 的 `dataTransfer` 垫片是否保留 `types`——若 `types` 丢了,改用 `Object.defineProperty(event, "dataTransfer", …)` 手工派发,不要放宽组件里「只接文件」的判断。每处修正都写进提交信息。

- [ ] **Step 5: 提交**

```
git add web/src/features/library/file-pick-tile.tsx web/src/features/library/file-pick-tile.test.tsx
git commit -m "feat(web): library file pick tile with drag and drop and a file card"
```

---

## Task AP4: `SubtitlePicker` 组件

**Files:**
- Create: `web/src/features/library/subtitle-picker.tsx`
- Create: `web/src/features/library/subtitle-picker.test.tsx`

- [ ] **Step 1: 先写测试** `web/src/features/library/subtitle-picker.test.tsx`

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SubtitlePicker, type SubtitlePickerProps } from "./subtitle-picker";

const file = (name: string, size = 100) => new File([new Uint8Array(size)], name);

function setup(over: Partial<SubtitlePickerProps> = {}) {
  const onFile = vi.fn();
  render(<SubtitlePicker file={null} onFile={onFile} inputTestId="subs" label="Subtitles (optional)" addLabel="Add" removeLabel="Remove subtitles" {...over} />);
  return { onFile, input: screen.getByTestId("subs") as HTMLInputElement };
}

describe("SubtitlePicker", () => {
  it("is a compact row with an Add chip that opens the real, visually hidden input", () => {
    const { input } = setup();
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", ".srt,.vtt");
    expect(input).toHaveAttribute("aria-label", "Subtitles (optional)");
    expect(input.className).toMatch(/\blib-pick-input\b/);
    expect(screen.getByText("Subtitles (optional)")).toBeInTheDocument();
    const add = screen.getByText("Add");
    expect(add.closest("label")).toHaveAttribute("for", input.id);
    expect(add.className).toMatch(/\blib-chip\b/);
    const onClick = vi.fn();
    input.addEventListener("click", onClick);
    fireEvent.click(add);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("hands the chosen file up and clears the input value; an empty change is ignored", () => {
    const { input, onFile } = setup();
    const f = file("a.srt");
    fireEvent.change(input, { target: { files: [f] } });
    expect(onFile).toHaveBeenCalledWith(f);
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { files: [] } });
    expect(onFile).toHaveBeenCalledTimes(1);
  });

  it("shows the chosen file name and size with a remove button that returns focus to the input", () => {
    const { input, onFile } = setup({ file: file("episode.srt", 2048) });
    expect(screen.getByText("episode.srt")).toHaveAttribute("title", "episode.srt");
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.queryByText("Add")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove subtitles" }));
    expect(onFile).toHaveBeenCalledWith(null);
    expect(input).toHaveFocus();
  });

  it("announces a problem in red text and marks the row", () => {
    const { input } = setup({ file: file("a.ass"), problem: "Must be .srt or .vtt" });
    expect(screen.getByRole("alert")).toHaveTextContent("Must be .srt or .vtt");
    expect(screen.getByTestId("subs-row")).toHaveAttribute("data-invalid");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });
});
```

- [ ] **Step 2: 跑,确认失败** `cd web && yarn vitest run src/features/library/subtitle-picker.test.tsx` → FAIL(模块不存在)。

- [ ] **Step 3: 实现** `web/src/features/library/subtitle-picker.tsx`

```tsx
import { SubtitlesIcon, XIcon } from "lucide-react";
import { useId, useRef } from "react";
import { formatFileSize } from "./add-sheet-helpers";
import "./library.css";

export interface SubtitlePickerProps {
  file: File | null;
  onFile: (file: File | null) => void;
  accept?: string;
  /** 真实输入的 data-testid;同时派生 `${id}-row`。 */
  inputTestId?: string;
  /** 「字幕(可选,.srt / .vtt)」:既是可见文字,也是输入的可访问名称。 */
  label: string;
  addLabel: string;
  removeLabel: string;
  problem?: string | null;
  disabled?: boolean;
}

/**
 * 可选字幕的次级行(R-A3 同一套「label + 视觉隐藏的真实输入」):空态是「标题 + 添加胶囊」,选中后是文件名 + 大小 + ✕。
 * 纯展示;不做拖放(需求只要求主文件)。
 */
export function SubtitlePicker({
  file, onFile, accept = ".srt,.vtt", inputTestId, label, addLabel, removeLabel, problem, disabled = false,
}: SubtitlePickerProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const input = useRef<HTMLInputElement>(null);
  const remove = () => {
    onFile(null);
    input.current?.focus();
  };
  return (
    <div className="lib-pick-wrap">
      <input
        ref={input}
        id={id}
        type="file"
        accept={accept}
        disabled={disabled}
        data-testid={inputTestId}
        className="lib-pick-input"
        aria-label={label}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? errorId : undefined}
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = "";
          if (picked) onFile(picked);
        }}
      />
      <div className="lib-subrow lib-pick-surface" data-testid={inputTestId ? `${inputTestId}-row` : undefined} data-invalid={problem ? "" : undefined}>
        <span className="lib-pick-ico" aria-hidden><SubtitlesIcon /></span>
        <span className="lib-pick-meta">
          {file ? (
            <>
              <span className="lib-pick-name text-sub font-semibold text-ink" title={file.name}>{file.name}</span>
              <span className="num text-meta text-ink-2">{formatFileSize(file.size)}</span>
            </>
          ) : (
            <span className="text-sub font-medium text-ink">{label}</span>
          )}
        </span>
        {file ? (
          <button type="button" className="lib-pick-act lib-pick-x" aria-label={removeLabel} disabled={disabled} onClick={remove}>
            <XIcon aria-hidden />
          </button>
        ) : (
          <label htmlFor={id} className="lib-chip lib-sub-add">{addLabel}</label>
        )}
      </div>
      {problem ? <p id={errorId} role="alert" className="mt-1.5 text-meta text-red">{problem}</p> : null}
    </div>
  );
}
```

- [ ] **Step 4: 跑,确认通过** `cd web && yarn vitest run src/features/library/subtitle-picker.test.tsx` → 全绿。

- [ ] **Step 5: 提交**

```
git add web/src/features/library/subtitle-picker.tsx web/src/features/library/subtitle-picker.test.tsx
git commit -m "feat(web): library subtitle picker row"
```

---

## Task AP5: `UploadForm` 接线(磁贴 + 字幕行 + 玻璃标题框 + SpecularButton)

**Files:**
- Modify: `web/src/features/library/upload-form.tsx`(整份重写,导出 `UploadForm`、`checkUpload`、`UploadProblem` 保持,新增 `checkSubtitles`)
- Modify: `web/src/features/library/upload-form.test.tsx`(只追加,不改既有断言)

- [ ] **Step 1: 先写测试** —— 在 `upload-form.test.tsx` 里:

(a) 把顶部 import 改成(只多了 `checkSubtitles`):

```tsx
import { UploadForm, checkSubtitles, checkUpload } from "./upload-form";
```

(b) 在 `describe("checkUpload (R-L19)")` 之后追加:

```tsx
describe("checkSubtitles (R-A2)", () => {
  it("checks the extension, then the 2 MiB cap", () => {
    expect(checkSubtitles(f("a.ass", 1))).toBe("subtitleBadType");
    expect(checkSubtitles(f("a", 1))).toBe("subtitleBadType");
    expect(checkSubtitles(f("a.srt", 3 * MIB))).toBe("subtitleTooLarge");
    expect(checkSubtitles(f("a.VTT", 100))).toBeNull();
  });
});
```

(c) 在 `describe("UploadForm")` 末尾(最后一个 `it` 之后、`});` 之前)追加:

```tsx
  it("replaces the raw file inputs with a pick tile and a subtitle row, keeping the real inputs and test ids (R-A3)", () => {
    renderWithProviders(<UploadForm limits={LIMITS} asr onSubmit={vi.fn()} />);
    expect(screen.getByTestId("library-upload-file-tile")).toBeInTheDocument();
    expect(screen.getByText("选择视频或音频")).toBeInTheDocument();
    expect(screen.getByText("格式:mp4 · m4v · mov · webm · mkv · mp3 +6")).toBeInTheDocument();
    expect(screen.getByText("单个最大 10 MB,最长 90 分钟")).toBeInTheDocument();
    expect(screen.getByLabelText("音频或视频文件")).toBe(screen.getByTestId("library-upload-file"));
    expect(screen.getByLabelText("字幕(可选,.srt / .vtt)")).toBe(screen.getByTestId("library-upload-subtitles"));
    expect(screen.getByTestId("library-upload-file")).toHaveAttribute("accept", expect.stringContaining("audio/*,video/*,.mp4"));
    expect(screen.getByTestId("library-upload-subtitles")).toHaveAttribute("accept", ".srt,.vtt");
    expect(screen.getByRole("button", { name: "上传" }).className).toMatch(/\blib-spec\b/);
    expect(screen.getByRole("button", { name: "上传" })).toBeDisabled();
  });

  it("turns the tile into a file card with name and size, and removing it empties the form again", () => {
    renderWithProviders(<UploadForm limits={LIMITS} asr onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByTestId("library-upload-file"), { target: { files: [file("Talk.mp4", 2048)] } });
    expect(screen.getByTestId("library-upload-file-card")).toBeInTheDocument();
    expect(screen.getByText("Talk.mp4")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "移除文件" }));
    expect(screen.getByTestId("library-upload-file-tile")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传" })).toBeDisabled();
  });

  it("fills the title from the file name until the user types one (R-A9)", () => {
    const onSubmit = vi.fn();
    renderWithProviders(<UploadForm limits={LIMITS} asr onSubmit={onSubmit} />);
    const title = screen.getByLabelText("标题(可选)") as HTMLInputElement;
    expect(title.value).toBe("");
    fireEvent.change(screen.getByTestId("library-upload-file"), { target: { files: [file("my_cool_talk.mp4", 100)] } });
    expect(title.value).toBe("my cool talk");
    expect(screen.getByText("已根据文件名填写,可以修改。")).toBeInTheDocument();
    fireEvent.change(title, { target: { value: "Mine" } });
    expect(screen.queryByText("已根据文件名填写,可以修改。")).toBeNull();
    fireEvent.change(screen.getByTestId("library-upload-file"), { target: { files: [file("other.mp4", 100)] } });
    expect(title.value).toBe("Mine");
    fireEvent.click(screen.getByRole("button", { name: "上传" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ filename: "other.mp4", title: "Mine" }));
  });

  it("submits the derived title when the user never touched the field", () => {
    const onSubmit = vi.fn();
    renderWithProviders(<UploadForm limits={LIMITS} asr onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId("library-upload-file"), { target: { files: [file("Friends.S01E02.mp4", 100)] } });
    fireEvent.click(screen.getByRole("button", { name: "上传" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: "Friends S01E02", subtitles: null }));
  });

  it("shows a wrong file type inline before submit, in the red alert under the card", () => {
    renderWithProviders(<UploadForm limits={LIMITS} asr onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByTestId("library-upload-file"), { target: { files: [file("notes.exe", 10)] } });
    expect(screen.getByRole("alert")).toHaveTextContent("不支持这种文件类型。");
    expect(screen.getByTestId("library-upload-file-card")).toHaveAttribute("data-invalid");
    expect(screen.getByRole("button", { name: "上传" })).toBeDisabled();
  });

  it("shows a subtitle problem on the subtitle row even before a media file is chosen", () => {
    renderWithProviders(<UploadForm limits={LIMITS} asr onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByTestId("library-upload-subtitles"), { target: { files: [file("a.ass", 10)] } });
    expect(screen.getByRole("alert")).toHaveTextContent("字幕必须是 .srt 或 .vtt 文件。");
    expect(screen.getByTestId("library-upload-subtitles-row")).toHaveAttribute("data-invalid");
    expect(screen.getByTestId("library-upload-file-tile")).toBeInTheDocument();
  });

  it("removes the chosen subtitles with the cross", () => {
    renderWithProviders(<UploadForm limits={LIMITS} asr={false} onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByTestId("library-upload-subtitles"), { target: { files: [file("a.vtt", 10)] } });
    expect(screen.getByText("a.vtt")).toBeInTheDocument();
    expect(screen.queryByTestId("library-upload-noasr")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "移除字幕" }));
    expect(screen.queryByText("a.vtt")).toBeNull();
    expect(screen.getByTestId("library-upload-noasr")).toBeInTheDocument();
  });

  it("shows the no-transcription warning as a tinted card", () => {
    renderWithProviders(<UploadForm limits={LIMITS} asr={false} onSubmit={vi.fn()} />);
    expect(screen.getByTestId("library-upload-noasr").className).toMatch(/\blib-note--warn\b/);
  });

  it("shows progress after submit and ignores a second submit (R-A10)", () => {
    const onSubmit = vi.fn();
    renderWithProviders(<UploadForm limits={LIMITS} asr onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId("library-upload-file"), { target: { files: [file("a.mp4", 100)] } });
    fireEvent.click(screen.getByRole("button", { name: "上传" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const busy = screen.getByRole("button", { name: "正在加入上传…" });
    expect(busy).toBeDisabled();
    expect(screen.getByTestId("library-upload-form")).toHaveAttribute("aria-busy", "true");
    fireEvent.click(busy);
    fireEvent.submit(screen.getByTestId("library-upload-form"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: 跑,确认失败**

`cd web && yarn vitest run src/features/library/upload-form.test.tsx`
预期:`checkSubtitles` 未导出 + 新增 `UploadForm` 用例失败;旧的三条 `UploadForm` 用例此时仍绿(还没改实现)。

- [ ] **Step 3: 实现** —— 用 Write 整份重写 `web/src/features/library/upload-form.tsx`:

```tsx
import { LoaderIcon, TriangleAlertIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { deriveTitle, formatsHint } from "./add-sheet-helpers";
import { FilePickTile } from "./file-pick-tile";
import { SpecularButton } from "./fx/specular-button";
import {
  LIBRARY_FORMATS, MAX_SUBTITLE_BYTES, MAX_TITLE_CHARS, MIB, SUBTITLE_FORMATS, extOf, type LibraryLimits,
} from "./library-api";
import "./locales";
import { SubtitlePicker } from "./subtitle-picker";
import type { UploadInput } from "./upload-client";

export type UploadProblem = "badType" | "empty" | "tooLarge" | "overQuota" | "subtitleBadType" | "subtitleTooLarge";

const formatsOf = (limits: LibraryLimits): readonly string[] => (limits.formats.length ? limits.formats : LIBRARY_FORMATS);

/** 字幕两条:扩展名、2 MiB 上限(R-A2:从 checkUpload 抽出,先选字幕后选文件时也能立刻提示)。 */
export function checkSubtitles(subtitles: { name: string; size: number }): "subtitleBadType" | "subtitleTooLarge" | null {
  if (!(SUBTITLE_FORMATS as readonly string[]).includes(extOf(subtitles.name))) return "subtitleBadType";
  if (subtitles.size > MAX_SUBTITLE_BYTES) return "subtitleTooLarge";
  return null;
}

/** 客户端预检(R-L19;服务端仍是最终裁判):扩展名、空文件、单文件上限、剩余配额、字幕。 */
export function checkUpload(
  file: { name: string; size: number }, limits: LibraryLimits, subtitles: { name: string; size: number } | null,
): UploadProblem | null {
  if (!formatsOf(limits).includes(extOf(file.name))) return "badType";
  if (file.size <= 0) return "empty";
  if (file.size > limits.maxUploadMb * MIB) return "tooLarge";
  if (limits.usedBytes + file.size > limits.quotaMb * MIB) return "overQuota";
  return subtitles ? checkSubtitles(subtitles) : null;
}

/**
 * 上传页签(spec §11.3):选文件磁贴、可选字幕行、标题(选文件后按文件名自动填写,R-A9);
 * 提交即交给上传任务表,弹层由调用方关闭(R-A10:所以这里只做「提交即禁用」的进行中状态,真实进度在列表卡)。
 */
export function UploadForm({ limits, asr, onSubmit }: { limits: LibraryLimits; asr: boolean; onSubmit: (input: UploadInput) => void }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [subs, setSubs] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const formats = formatsOf(limits);
  const mediaProblem = file ? checkUpload(file, limits, null) : null;
  const subsProblem = subs ? checkSubtitles(subs) : null;
  const problem = mediaProblem ?? subsProblem;
  const accept = ["audio/*", "video/*", ...formats.map((f) => `.${f}`)].join(",");

  const pickFile = (next: File | null) => {
    setFile(next);
    if (!titleTouched) setTitle(next ? deriveTitle(next.name) : "");
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!file || problem || submitted) return;
    onSubmit({
      file, filename: file.name, title: title.trim() || undefined,
      subtitles: subs ? { file: subs, filename: subs.name } : null,
    });
    setSubmitted(true);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" data-testid="library-upload-form" aria-busy={submitted || undefined}>
      <FilePickTile
        file={file}
        onFile={pickFile}
        accept={accept}
        inputTestId="library-upload-file"
        label={t("web.library.upload.file")}
        title={t("web.library.upload.pickTitle")}
        dropLabel={t("web.library.upload.pickDrop")}
        dragHint={t("web.library.upload.pickDrag")}
        replaceLabel={t("web.library.upload.replace")}
        removeLabel={t("web.library.upload.remove")}
        problem={mediaProblem ? t(`web.library.upload.${mediaProblem}`, { mb: limits.maxUploadMb }) : null}
        disabled={submitted}
      >
        <span className="text-meta text-ink-2">{t("web.library.upload.formats", { list: formatsHint(formats) })}</span>
        <span className="text-meta text-ink-3">{t("web.library.upload.limits", { mb: limits.maxUploadMb, minutes: limits.maxDurationMinutes })}</span>
      </FilePickTile>
      <SubtitlePicker
        file={subs}
        onFile={setSubs}
        inputTestId="library-upload-subtitles"
        label={t("web.library.upload.subtitles")}
        addLabel={t("web.library.upload.subtitlesAdd")}
        removeLabel={t("web.library.upload.subtitlesRemove")}
        problem={subsProblem ? t(`web.library.upload.${subsProblem}`) : null}
        disabled={submitted}
      />
      {!asr && !subs ? (
        <div data-testid="library-upload-noasr" className="lib-note lib-note--warn">
          <TriangleAlertIcon aria-hidden />
          <p>{t("web.library.upload.noAsr")}</p>
        </div>
      ) : null}
      <div>
        <label className="lib-ffield">
          <span className="lib-ffield-label">{t("web.library.upload.titleLabel")}</span>
          <input type="text" autoComplete="off" value={title} maxLength={MAX_TITLE_CHARS} className="lib-ffield-input" disabled={submitted}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleTouched(true);
            }} />
        </label>
        {file && !titleTouched && title ? <p className="mt-1 px-1 text-meta text-ink-3">{t("web.library.upload.titleAuto")}</p> : null}
      </div>
      <SpecularButton type="submit" disabled={!file || !!problem || submitted} className="h-12">
        {submitted ? (
          <>
            <LoaderIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
            {t("web.library.upload.submitting")}
          </>
        ) : t("web.library.upload.submit")}
      </SpecularButton>
    </form>
  );
}
```

- [ ] **Step 4: 跑,确认通过**

`cd web && yarn vitest run src/features/library/upload-form.test.tsx src/features/library/add-sheet.test.tsx src/features/library/library-list-page.test.tsx`
预期全绿。**既有断言一条都不该需要改**:旧用例用的 `getByTestId("library-upload-file")`、`getByTestId("library-upload-subtitles")`、`getByLabelText("标题(可选)")`、`getByRole("button", {name: "上传"})`、`getByRole("alert")`、`library-upload-noasr` 在新标记里都还成立;`add-sheet.test.tsx` 里 `accept` 与「单个最大 500 MB,最长 90 分钟」断言也成立(限制行是独立 `<span>`)。若某条旧断言真的失败,**先查实现是否违背了 Global Constraints**,实在是标记变化引起的,才改测试,并在本节末尾记一行「改了哪条、为什么」。
- 注意 `getByText("格式:mp4 · m4v · mov · webm · mkv · mp3 +6")` 依赖 `limitsOrDefault(null)` 的 12 个默认格式;`LIMITS` 是 `{ ...limitsOrDefault(null), … }` 所以格式齐全。

- [ ] **Step 5: 提交**

```
git add web/src/features/library/upload-form.tsx web/src/features/library/upload-form.test.tsx
git commit -m "feat(web): restyle the library upload form with a pick tile, subtitle row and glass title field"
```

---

## Task AP6: `ImportForm` 链接页签 + `AddSheet` 页签换皮

**Files:**
- Modify: `web/src/features/library/import-form.tsx`(整份重写;`isHttpUrl` 与组件签名不变)
- Modify: `web/src/features/library/import-form.test.tsx`(只追加)
- Modify: `web/src/features/library/add-sheet.tsx`(单处 Edit)
- Modify: `web/src/features/library/add-sheet.test.tsx`(只追加)

- [ ] **Step 1: 先写测试**

(a) `import-form.test.tsx`:顶部 import 改为(多一个 `act`):

```tsx
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
```

在文件末尾追加:

```tsx
describe("ImportForm polish (R-A13, R-A14)", () => {
  const withClipboard = (readText: () => Promise<string>) => {
    Object.defineProperty(navigator, "clipboard", { value: { readText }, configurable: true });
  };
  const withoutClipboard = () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  };

  it("shows the DRM notice as an amber card and the disabled notice as a plain card", () => {
    const { unmount } = renderWithProviders(<ImportForm linkImport onImported={vi.fn()} />);
    expect(screen.getByTestId("library-drm-note").className).toMatch(/\blib-note--warn\b/);
    unmount();
    renderWithProviders(<ImportForm linkImport={false} onImported={vi.fn()} />);
    expect(screen.getByTestId("library-link-disabled").className).toMatch(/\blib-note\b/);
    expect(screen.getByTestId("library-link-disabled")).toHaveAttribute("role", "status");
  });

  it("uses glass fields and the specular button", () => {
    withoutClipboard();
    renderWithProviders(<ImportForm linkImport onImported={vi.fn()} />);
    expect(screen.getByLabelText("视频页面链接").className).toMatch(/\blib-ffield-input\b/);
    expect(screen.getByLabelText("标题(可选)").className).toMatch(/\blib-ffield-input\b/);
    expect(screen.getByRole("button", { name: "导入" }).className).toMatch(/\blib-spec\b/);
    expect(screen.getByRole("button", { name: "导入" })).toBeDisabled();
  });

  it("hides the paste button when the clipboard cannot be read", () => {
    withoutClipboard();
    renderWithProviders(<ImportForm linkImport onImported={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "粘贴" })).toBeNull();
  });

  it("pastes a trimmed link into the field and clears an old error", async () => {
    withClipboard(() => Promise.resolve("  https://www.youtube.com/watch?v=x \n"));
    renderWithProviders(<ImportForm linkImport onImported={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("视频页面链接"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "导入" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "粘贴" }));
    });
    expect((screen.getByLabelText("视频页面链接") as HTMLInputElement).value).toBe("https://www.youtube.com/watch?v=x");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stays quiet and focuses the field when the paste is refused", async () => {
    withClipboard(() => Promise.reject(new DOMException("denied", "NotAllowedError")));
    renderWithProviders(<ImportForm linkImport onImported={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "粘贴" }));
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("视频页面链接")).toHaveFocus();
  });

  it("shows the import as in progress while the request is pending, and an error as a red card", async () => {
    withoutClipboard();
    let release: (r: Response) => void = () => {};
    const mock = createFetchMock({
      "POST /api/library/imports": () => new Promise<Response>((resolve) => { release = resolve; }),
    });
    renderWithProviders(<ImportForm linkImport onImported={vi.fn()} />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    fireEvent.change(screen.getByLabelText("视频页面链接"), { target: { value: "http://10.0.0.1/x" } });
    fireEvent.click(screen.getByRole("button", { name: "导入" }));
    expect(await screen.findByRole("button", { name: "导入中…" })).toBeDisabled();
    await act(async () => { release(json({ error: "Invalid URL" }, 400)); });
    const alert = await screen.findByRole("alert");
    expect(alert.className).toMatch(/\blib-note--err\b/);
    expect(screen.getByRole("button", { name: "导入" })).toBeEnabled();
  });
});
```

(b) `add-sheet.test.tsx` 在 `describe` 末尾追加:

```tsx
  it("restyles the tabs as a full-width glass segmented control (R-A8)", () => {
    renderWithProviders(<AddSheet open onOpenChange={vi.fn()} config={CONFIG} onUpload={vi.fn()} onImported={vi.fn()} />);
    const group = screen.getByRole("radiogroup", { name: "来源" });
    expect(group.className).toMatch(/\blib-seg\b/);
    expect(group.className).toMatch(/\bw-full\b/);
    expect(screen.getByTestId("library-tab-upload").className).toMatch(/\bflex-1\b/);
    expect(screen.getByTestId("library-tab-link").className).toMatch(/\bflex-1\b/);
  });

  it("shows the pick tile instead of a bare file input on the upload tab, formats and limits included (R-A3)", () => {
    renderWithProviders(<AddSheet open onOpenChange={vi.fn()} config={CONFIG} onUpload={vi.fn()} onImported={vi.fn()} />);
    expect(screen.getByTestId("library-upload-file-tile")).toBeInTheDocument();
    expect(screen.getByText("选择视频或音频")).toBeInTheDocument();
    expect(screen.getByText("格式:mp4 · mp3")).toBeInTheDocument();
    expect(screen.getByTestId("library-upload-file").className).toMatch(/\blib-pick-input\b/);
  });

  it("keeps the link tab on the same glass style, notices included", () => {
    renderWithProviders(<AddSheet open onOpenChange={vi.fn()} config={{ ...CONFIG, linkImport: true }} onUpload={vi.fn()} onImported={vi.fn()} />);
    fireEvent.click(screen.getByTestId("library-tab-link"));
    expect(screen.getByTestId("library-drm-note").className).toMatch(/\blib-note\b/);
    expect(screen.getByLabelText("视频页面链接").className).toMatch(/\blib-ffield-input\b/);
  });
```

- [ ] **Step 2: 跑,确认失败**

`cd web && yarn vitest run src/features/library/import-form.test.tsx src/features/library/add-sheet.test.tsx`
预期:新增用例失败,旧用例仍绿(还没改实现)。

- [ ] **Step 3: 实现**

(i) `add-sheet.tsx`:Edit 一处。old `value={tab} onChange={setTab}` → new `value={tab} onChange={setTab} className="lib-seg flex w-full" optionClassName="flex-1"`。(`SegmentedControl` 的 `cn` 会让 `flex` 盖掉 `inline-flex`;换皮靠 `.library-root .lib-seg …`,R-A8。)

(ii) `import-form.tsx` 用 Write 整份重写:

```tsx
import { ClipboardPasteIcon, InfoIcon, Link2OffIcon, LoaderIcon, TriangleAlertIcon } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { SpecularButton } from "./fx/specular-button";
import { LIBRARY_SERVER_ERRORS, MAX_TITLE_CHARS, MAX_URL_CHARS, importLink, type LibraryItem } from "./library-api";
import "./locales";

/** 只做形状检查:http(s)、有主机、无用户信息、≤ 2000 字;能否访问由服务端判定(spec §7.2)。 */
export function isHttpUrl(value: string): boolean {
  const s = value.trim();
  if (!s || s.length > MAX_URL_CHARS) return false;
  try {
    const u = new URL(s);
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

// 导入时的 404 = 管理员刚关掉链接导入(spec §9),不是「素材不存在」
const IMPORT_ERRORS: Record<string, string> = { ...LIBRARY_SERVER_ERRORS, "Not Found": "web.library.link.disabled" };

/** 只有能读剪贴板(安全上下文)才给「粘贴」按钮(R-A13)。 */
const canPaste = (): boolean => typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function";

/** 链接页签(spec §7.4、§11.3):DRM 文案常驻(着色卡片);开关关时只显示说明。链接只放在 POST 体里。 */
export function ImportForm({ linkImport, onImported }: { linkImport: boolean; onImported: (item: LibraryItem) => void }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urlInput = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!isHttpUrl(url)) {
      setError(t("web.library.link.badUrl"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const item = await importLink(api, { url: url.trim(), title: title.trim() || undefined });
      setUrl("");
      setTitle("");
      onImported(item);
    } catch (err) {
      setError(translateServerError(t, err, IMPORT_ERRORS));
    } finally {
      setBusy(false);
    }
  };

  // 必须在点击手势里调用(iOS 会弹「粘贴」确认气泡);读到的内容只进输入框状态,不记日志(隐私)。
  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) {
        setUrl(text);
        setError(null);
        return;
      }
    } catch { /* 被拒绝或不支持:不报错,让用户自己长按粘贴 */ }
    urlInput.current?.focus();
  };

  const pasteable = canPaste();

  return (
    <div className="flex flex-col gap-3" data-testid="library-import">
      <div data-testid="library-drm-note" className="lib-note lib-note--warn">
        <InfoIcon aria-hidden />
        <p>{t("web.library.link.drm")}</p>
      </div>
      {!linkImport ? (
        <div data-testid="library-link-disabled" role="status" className="lib-note">
          <Link2OffIcon aria-hidden />
          <p>{t("web.library.link.disabled")}</p>
        </div>
      ) : (
        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-3" aria-busy={busy || undefined}>
          <div className={`lib-ffield${pasteable ? " lib-ffield--paste" : ""}`}>
            <label className="lib-ffield-in">
              <span className="lib-ffield-label">{t("web.library.link.url")}</span>
              <input ref={urlInput} type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} maxLength={MAX_URL_CHARS}
                placeholder={t("web.library.link.placeholder")} value={url} className="lib-ffield-input" onChange={(e) => setUrl(e.target.value)} />
            </label>
            {pasteable ? (
              <button type="button" className="lib-chip lib-ffield-paste text-blue" onClick={() => void paste()}>
                <ClipboardPasteIcon aria-hidden />{t("web.library.link.paste")}
              </button>
            ) : null}
          </div>
          <label className="lib-ffield">
            <span className="lib-ffield-label">{t("web.library.link.titleLabel")}</span>
            <input type="text" autoComplete="off" value={title} maxLength={MAX_TITLE_CHARS} className="lib-ffield-input" onChange={(e) => setTitle(e.target.value)} />
          </label>
          {error ? (
            <div role="alert" className="lib-note lib-note--err">
              <TriangleAlertIcon aria-hidden />
              <p>{error}</p>
            </div>
          ) : null}
          <p className="text-meta text-ink-2">{t("web.library.link.note")}</p>
          <SpecularButton type="submit" disabled={busy || !url.trim()} className="h-12">
            {busy ? (
              <>
                <LoaderIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
                {t("web.library.link.submitting")}
              </>
            ) : t("web.library.link.submit")}
          </SpecularButton>
        </form>
      )}
    </div>
  );
}
```

注意:(1) 粘贴按钮在 `<label>` **外面**(与输入框同在 `.lib-ffield` 容器里),所以 `getByLabelText("视频页面链接")` 只命中输入框;(2) 按钮名是「粘贴」,与「导入」不冲突(既有测试按 `{name: "导入"}` 精确匹配);(3) 第一条追加用例里两次 `renderWithProviders`,第二次前先 `unmount()`,避免同名 testid 重复。

- [ ] **Step 4: 跑,确认通过**

`cd web && yarn vitest run src/features/library/import-form.test.tsx src/features/library/add-sheet.test.tsx src/features/library/upload-form.test.tsx src/features/library/library-list-page.test.tsx src/features/library/ui.test.ts`
预期全绿。既有 `import-form.test.tsx` 断言预期**不用改**:`library-drm-note` 的 `toHaveTextContent(DRM)`(文本在卡片里的 `<p>`,图标是 `aria-hidden` 的 SVG 无文字)、`library-link-disabled` 的文字、`queryByRole("textbox")` 为空(关闭时没有输入框)、`getByRole("alert")` 单个(错误卡)、404 → 「管理员没有开启链接导入。」。真有断言失败,按 AP5 同样的规矩处理并记录。

- [ ] **Step 5: 架构与类型检查(本计划的收尾检查,各跑一次)**

`cd web && yarn vitest run src/architecture.test.ts && cd .. && yarn web:typecheck`
预期通过。新文件只从 `~/…`(`~/api`、`~/auth`)、`@renderer/*`、`lucide-react`、库内相对路径导入,没有新的跨 feature 边。

- [ ] **Step 6: 提交**

```
git add web/src/features/library/import-form.tsx web/src/features/library/import-form.test.tsx web/src/features/library/add-sheet.tsx web/src/features/library/add-sheet.test.tsx
git commit -m "feat(web): restyle the library link tab and the add-sheet tabs"
```

---

## Task AP7: 文档与真机清单

**Files:**
- Create: `web/src/features/library/CLAUDE.md`(R-A1:此前不存在)
- Create: `docs/superpowers/plans/2026-10-14-library-add-sheet-polish-device-checklist.md`

只有文档,无代码测试。

- [ ] **Step 1: 新建 `web/src/features/library/CLAUDE.md`**(Write)

````markdown
# web/src/features/library/

Follow-along library: upload / import material, play it sentence by sentence, shadow it. Lazy-loaded behind `/library` and `/library/:id`; only `index.ts` is public (`LibraryListPage`, `LibraryPlayerPage`, `useLibraryEnabled`). Spec: `docs/superpowers/specs/2026-10-13-video-import-design.md` §11; visual source of truth: `docs/superpowers/design/video-import-v1/mockup-glass.html` (D11).

## What lives here
- Pages: `library-list-page.tsx` (list, usage bar, add button, opens the sheet), `player-page.tsx` (+ `segment-list.tsx`, `shadow-panel.tsx`, `use-media-player.ts`, `use-shadowing.ts`).
- Add material (bottom sheet): `add-sheet.tsx` (tabs) → `upload-form.tsx` (`checkUpload` / `checkSubtitles` validate; the form owns the state) → `file-pick-tile.tsx` (big dashed tile → file card, drag and drop) and `subtitle-picker.tsx` (compact row); `import-form.tsx` (link tab, paste button, DRM / disabled notices); `add-sheet-helpers.ts` (`formatFileSize`, `formatsHint`, `fileKind`, `deriveTitle`).
- Upload pipeline: `upload-client.ts` (chunked, resumable), `upload-store.ts` (module-level jobs; the list cards show progress), `library-api.ts` (endpoints, `limitsOrDefault`, `extOf`, `stemOf`), `config.ts` (`/api/library/config`; kept free of lazy strings).
- Visual layer: `library.css` (scoped to `.library-root`; the add-sheet form has its own section), `library-root.tsx`, `fx/` (hand-written effects: SpotlightCard, SpecularButton, GlassSurface, SoftAurora, …; no new npm dependencies).
- Strings: `locales/{en,zh-CN}.json` merged lazily by `locales.ts` (every module using `web.library.*` does `import "./locales"`); `i18n/` holds only the nav label (eager).
- `test-fixtures.ts` / `test-i18n.ts` are test-only; product code must not import them.

## Allowed dependencies
- `lib/`, `api/`, `components/`, `layout/`, `auth/`, `settings/`, `@renderer/*`, `~/features/practice` (the one allowed cross-feature edge, see `architecture.test.ts`). Never import `chat` or `lookup`.

## Test
- `cd web && yarn vitest run src/features/library`; style rules only: `yarn vitest run src/features/library/library-css.test.ts`.

## Pitfalls
- Blur budget: at most 3 `backdrop-filter` declarations in `library.css` (`.lib-glass`, `.lib-gblur`, the add sheet); `library-css.test.ts` counts them. Tiles, cards, fields and notices use translucent fill + highlight border only. No new `@keyframes` for form controls (transitions only); `html.lite` and `prefers-reduced-motion` sections at the end of `library.css` must list new transitions / animations.
- The add sheet is a Radix portal: it carries its own `library-root lib-sheet` classes so the CSS variables apply. Submitting the upload form closes the sheet immediately (`library-list-page.tsx`); progress is on the list card, not in the sheet.
- File inputs: the real `<input type=file>` stays in the DOM, visually hidden (`.lib-pick-input`, not `hidden` / `display:none`) and is opened by a `<label htmlFor>` so iOS Safari opens the picker inside the tap. Never call `input.click()` after an `await`. Reset `value` after reading `files[0]`. A dropped file bypasses `accept`, so `checkUpload` is the only type check.
- The title field auto-fills from the file name until the user types in it (`titleTouched`); the submitted title is still `title.trim() || undefined`.
- `SegmentedControl` is shared: restyle it only through `className` / `optionClassName` and `.library-root .lib-seg …` selectors.
- Words, titles, links and file names never go into URLs or logs; the import link travels only in the POST body.
- Real-device behaviour (iOS picker, drag and drop, clipboard paste, glass look) is unverified; see `docs/superpowers/plans/2026-10-14-library-add-sheet-polish-device-checklist.md`.
````

(写完后核对一遍:文件清单里的每个文件名都存在于目录;`~/features/practice` 一条与 `architecture.test.ts` 第 68–78 行的 `library->practice` 注释一致。)

- [ ] **Step 2: 新建真机清单** `docs/superpowers/plans/2026-10-14-library-add-sheet-polish-device-checklist.md`(Write;下面整段是文件内容,外层四反引号只是本计划里的围栏):

````markdown
# 添加素材弹层美化 · 真机验证清单

> **状态:未在真机验证(UNVERIFIED)。** 随计划 `2026-10-14-library-add-sheet-polish.md` 交付;下面所有勾选框在用户用真机测完之前一律保持空。
> jsdom 只能证明「真实的文件输入还在 DOM 里、label 指向它、点 label 会点到它、拖入的文件被接收、校验文案对」,**不能**证明 iOS Safari 点磁贴真的弹出选择器、拖放手感、剪贴板权限气泡、暗色玻璃的观感与性能。
> 范围:iPhone Safari 浏览器标签页(主屏幕 PWA 另记);桌面 Chrome / Safari / Firefox 用于拖放与键盘。

## 填写前先记

| 项 | 值 |
|---|---|
| 设备 / 系统版本 / 浏览器 | (用户填) |
| 被测构建(`git rev-parse --short HEAD`) | (用户填) |
| 外观(浅色 / 深色)、是否开了「减少动态效果」「减少透明度」 | (用户填) |
| 跟读库配置(单个上限 MB、时长、是否开启链接导入、是否有转写) | (用户填) |

每项记录:通过 / 不通过 + 一句现象。不要把真实文件名、链接或任何令牌贴进记录。

## A. iOS 选择器(最关键)

- [ ] A1 点「选择视频或音频」磁贴任意位置(图标、标题、小字):**第一次点按就**弹出系统文件 / 相册选择器。
- [ ] A2 选一个视频后,磁贴变成文件卡:类型图标、文件名(过长以省略号收尾)、大小。
- [ ] A3 点文件卡上的「更换」:再次弹出选择器;在选择器里**取消**:已选的文件**还在**(不会被清掉)。
- [ ] A4 点 ✕ 移除:回到磁贴;再选**同一个**文件:能再次选中(change 会触发)。
- [ ] A5 点字幕行的「添加」胶囊:弹出选择器,能选 .srt / .vtt;选中后显示文件名与 ✕。
- [ ] A6 键盘 / 辅助功能:接外接键盘 Tab 能聚焦到文件框(磁贴出现蓝色焦点环),回车或空格打开选择器;VoiceOver 读出的是「音频或视频文件」而不是一长串提示文字。

## B. 校验与提示

- [ ] B1 选一个超过上限的文件:文件卡变红色调,卡片下方红字提示,「上传」按钮灰掉且一眼能看出不可点。
- [ ] B2 选一个不支持的类型(如 .exe 或 .txt):红字「不支持这种文件类型。」。
- [ ] B3 先选一个 .ass 字幕再选视频:字幕行变红并提示;移除后恢复。
- [ ] B4 服务器没有转写且没选字幕时,琥珀色提示卡可见;选了字幕后消失。

## C. 标题与提交

- [ ] C1 选文件后标题框自动填上文件名主干(下划线变空格);手改后再换文件不再覆盖;框下有一行小字说明自动填写。
- [ ] C2 点「上传」:按钮立刻变为转圈 + 「正在加入上传…」,弹层随即关闭,列表里出现带进度的上传卡(进度只在列表卡上,弹层里没有进度条,这是有意的)。
- [ ] C3 iOS 键盘弹出时标题框不被遮住,16px 字号没有触发页面缩放。

## D. 桌面拖放

- [ ] D1 把一个视频文件拖到磁贴上:磁贴边框变蓝、底色变淡蓝、标题变「松开即可添加」;松开后变文件卡。
- [ ] D2 拖到已有文件卡上:同样高亮,松开后替换。
- [ ] D3 拖一段文字或一个链接到磁贴上:没有高亮,松开没有反应。
- [ ] D4 一次拖入多个文件:只取第一个。
- [ ] D5 拖入一个不支持的类型:红字提示(而不是静默忽略)。
- [ ] D6 鼠标悬停磁贴有高光跟随与蓝色边框;触屏设备上不显示「也可以把文件拖到这里」。

## E. 链接页签

- [ ] E1 页签是同一风格的分段控件;切换时弹层高度变化自然,不抖。
- [ ] E2 DRM 说明是琥珀色提示卡且常驻;管理员关闭链接导入时只显示灰色说明卡,没有输入框。
- [ ] E3 点「粘贴」:iOS 弹出系统「粘贴」确认气泡,允许后链接填入输入框(两端空白被去掉);拒绝后不报错、输入框获得焦点。
- [ ] E4 在不支持读剪贴板的环境(非 HTTPS 的局域网地址):没有「粘贴」按钮,输入框仍可手动粘贴。
- [ ] E5 提交一个无效链接:红色提示卡;提交中按钮显示转圈 + 「导入中…」。

## F. 玻璃观感与降级

- [ ] F1 暗色:弹层是强玻璃板,磁贴、文件卡、字幕行、输入框是半透明填充 + 亮边,没有第二层模糊(滑动 / 打字不卡)。
- [ ] F2 浅色:同上,文字对比度足够(尤其红 / 琥珀提示卡里的字)。
- [ ] F3 系统开了「减少动态效果」:磁贴边框 / 输入框焦点光晕没有过渡动画,主按钮没有扫光,转圈图标不转。
- [ ] F4 低端机(`html.lite`):弹层退为实色;表单没有过渡动画。
- [ ] F5 360 px 宽:磁贴、文件卡(文件名省略,更换与 ✕ 各 44 px 命中区)、字幕行、粘贴胶囊都不溢出、不重叠。
````

- [ ] **Step 3: 核对(不是测试)**

`ls web/src/features/library/CLAUDE.md docs/superpowers/plans/2026-10-14-library-add-sheet-polish-device-checklist.md`;用 Grep 确认 CLAUDE.md 里提到的每个文件名都存在、清单里没有真实链接 / 令牌 / 个人信息。

- [ ] **Step 4: 提交**

```
git add web/src/features/library/CLAUDE.md docs/superpowers/plans/2026-10-14-library-add-sheet-polish-device-checklist.md
git commit -m "docs: library CLAUDE.md and the add-sheet polish device checklist"
```

---

## Review notes(给执行者与评审)

- **与需求字面的偏差:**(1)「提交后的进度状态」:上传页签只有「提交即禁用 + 转圈 + 文案」,不是进度条——弹层在 `onUpload` 里被同步关掉,真实进度在列表卡(R-A10);链接页签的进行中状态是真的可见。(2)`library-css.test.ts` 体积上限 22,000 → 28,000(R-A11);gzip ≤ 6 kB 的 spec 目标未实测。(3)「library CLAUDE.md」原先不存在,本计划新建(R-A1)。(4)中文字幕标签由「.srt 或 .vtt」改为「.srt / .vtt」(R-A15)。(5)标题现在会被预填(spec §11.3 只说「标题」可选;预填后提交的值与服务端默认标题几乎一致,只多了下划线 / 点号换空格)。
- **风险:**(a)全部代码与测试**未运行**,jsdom 的 label 点击转发、user-event 对文件框空格键、`fireEvent` 的 `dataTransfer` 垫片、`library.css` 的 CRLF 与行首锚点都可能需要第一次运行时微调;(b)真机行为(iOS 选择器、拖放、剪贴板、玻璃观感)未验证;(c)`.lite` 下转圈图标仍会转(沿用现有做法);(d)`library.css` 与 `locales/*.json` 是共享文件,合并时保留双方;(e)`SegmentedControl` 换皮依赖 `.library-root` 的特异性,如果以后给它加内联样式会失效。
- **勾选框:** 本文件里的 `- [ ]` 只在工作合并且测试通过后由用户 / 主控勾选;真机清单永远保持空,直到用户在真机上测完。
