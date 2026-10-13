# iOS Safari 点输入框页面跳到顶部(计划 C)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** iOS Safari(浏览器标签页,非主屏幕应用)里点 1 对 1 对话输入框(`chat-input`)或联机输入条(`room-input`)时,页面不再整体跳到顶部、不再需要点空白处恢复。做法:键盘相关事件后把被 iOS 平移的布局视口复位到 `(0,0)`(rAF 合并,不在事件里强制布局);把 `html` / `body` 固定成不可滚动的外壳,让滚动只发生在内部容器;确认触屏输入框字号 ≥ 16 px;不改动联机助手面板的键盘判定。

**Architecture:** 只动 `layout/use-app-height.ts`(新增复位逻辑)、`index.css`(固定外壳,字号规则已存在,只补测试)、`app.tsx` 里 `AnnouncementFrame` 的一处包裹(全站维护页需要自己的滚动容器)。复位逻辑是同一个 effect 里的 `schedule()`:`visualViewport` 的 `resize` / `scroll`、`window` 的 `resize`、`document` 的 `focusin` / `focusout` 都只排一个 `requestAnimationFrame`;rAF 里读 `scrollY` / `visualViewport.offsetTop`,非 0 才 `scrollTo(0, 0)`;`focusout` 之后再排一次延迟复位等键盘收起动画结束。双指放大(`scale > 1.01`)时不复位。

**Tech Stack:** React 18 hook + vitest(jsdom,手写 `visualViewport` / rAF / 计时器假对象)+ Tailwind `@layer base`;不新增依赖、不改 `enjoy/`、不新增跨 feature 依赖。

**Spec:** `docs/superpowers/specs/2026-10-13-defs-default-lookup-ios-design.md` §1(D8)与 §4(本计划实现 §4.1–§4.3)。真机清单:`docs/superpowers/plans/2026-10-13-ios-keyboard-scroll-device-checklist.md`(**未在真机验证**)。

## Global Constraints

- **这是假设驱动的修复,未在真机复现。** 写计划时只读了代码,没有运行任何测试、构建,更没有碰过 iPhone。下面的根因是按代码推出的排序假设(见「根因假设」);单元测试只能证明「条件满足时调用了 `scrollTo(0,0)`」。是否真的修好,只由用户按设备清单在 iPhone Safari 上判定,清单里的框在那之前一律不勾。计划与 PR 描述里都要写「未在真机验证」。
- **文件归属:** 本计划只改 `web/src/layout/`、`web/src/index.css`、`web/src/app.tsx`(仅 `AnnouncementFrame` 一处)、对应测试与 `CLAUDE.md` / `web/README.md` 的追加。不碰 `features/wordbook/` 的 `def_lang` 文件(计划 A)、`features/lookup/` 与 `server/`(计划 B)。不改 `features/rooms/assist/use-soft-keyboard.ts` 与 `dock-snap.ts`(spec §4.2.4)。
- **不放宽 `architecture.test.ts`。** `layout/` 只用 `lib/`、`components/` 等低层;生产代码不新增任何 import 边。T4 的共存测试需要 `layout/` 的测试引用 rooms 内部的 `use-soft-keyboard`;执行者先读 `architecture.test.ts` 是否扫描测试文件,若扫描就把该测试改放到 `features/rooms/assist/app-height-coexist.test.tsx`(它引用 `~/layout/use-app-height`,layout 是 features 允许的依赖),不得放宽规则。
- **不改桌面外观。** 字号规则本来就只在 `@media (pointer: coarse)`;固定外壳在桌面上也成立(滚动本来就发生在 `<main>` 里),不引入新的视觉变化。
- **不禁用缩放。** 不加 `maximum-scale=1` / `user-scalable=no`(无障碍;`use-soft-keyboard.ts` 已按 `scale` 修正缩放)。
- **隐私:** 不新增日志、不记录输入内容、不读写 localStorage。
- **每个任务结束:** `cd web && yarn vitest run <该任务的测试> src/architecture.test.ts`;合并前 `yarn web:typecheck && yarn web:test && yarn web:build`(用户要求才跑全量)。提交 conventional,一任务一提交,信息以 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` 结尾。「固定外壳」单独一次提交(T2),便于真机失败时单独回滚。
- **验证口径(如实):** jsdom 没有布局,`position: fixed` 的效果、iOS 的平移行为、键盘动画时序全部不可测,标「未验证」。测试里手写的 `visualViewport` 假对象与 rAF / 计时器队列按读到的真实 API 写,执行者第一次运行以真实结果为准修正(尤其:`renderHook` 的卸载、`Object.create(window)` 假窗口上继承的属性)。

---

## 现状(已读代码核对)

- `web/src/layout/use-app-height.ts`:只监听 `visualViewport` 与 `window` 的 `resize`,把 `visualViewport.height`(无则 `innerHeight`)写进 `document.documentElement` 的 `--app-height`。**没有**监听 `visualViewport` 的 `scroll`,没有 `focusin` / `focusout`,没有任何 `scrollTo`。
- 只有 `AppShell` 调用它(`layout/app-shell.tsx`);外壳 `div` 高度 `var(--app-height, 100dvh)`,里面 `<main>` 是 `overflow-y-auto overscroll-contain` 的唯一滚动区。`app.tsx` 的 `AnnouncementFrame` 同样用 `var(--app-height, 100dvh)`,内层容器 `overflow-y-auto` 并把 `--app-height` 改成 `100%`(让出横幅高度)。
- `index.css`:`html, body, #root { height: 100% }`;`body { overscroll-behavior-y: none }`;**没有** `position: fixed` / `overflow: hidden`。文件末尾已有 `@media (pointer: coarse) { input, textarea, select { font-size: 16px !important } }`(spec §4.1 说「输入框字号若 < 16 px 会放大」,但该规则其实已经存在,见 R-K4)。
- `index.html`:`viewport` 含 `viewport-fit=cover, interactive-widget=resizes-content`(Safari 不支持 `interactive-widget`,Chrome 才认,所以 iOS 靠 `visualViewport` + `--app-height`)。
- 输入框:对话页 `Textarea[chat-input]`(`text-base`)、联机 `<input room-input>`(`text-base`)。其余见 R-K4 清单。
- 键盘相关其它代码:`rooms/assist/use-soft-keyboard.ts`(`vv` 的 `resize` / `scroll` + `focusin` / `focusout`,只 `setOpen`)、`dock-snap.ts::keyboardOpen`(纯函数)、`wordbook/spell/use-reveal-blank.ts`(`vv` 的 `resize` / `scroll` 后 rAF `scrollIntoView({block:"nearest"})`,只在隐藏输入框聚焦时)。
- `layout.test.tsx` 已有一个 `useAppHeight` 用例(假 `visualViewport` 只收一个监听、`resize` 后高度更新);本计划保持它通过。

## 根因假设(按可能性排序,均未真机复现)

1. **H1(最可能):iOS 在输入框聚焦时平移了布局视口,而页面没有任何复位。** iOS Safari 为了让光标可见,会把视觉视口相对布局视口平移(`visualViewport.offsetTop > 0`,有时伴随 `window.scrollY`)。外壳高度被设成 `visualViewport.height`、顶端固定在布局视口 `y = 0`,平移后可见区域是 `[offsetTop, offsetTop + height]`,与外壳 `[0, height]` 错位:用户看到的是外壳被「顶走」或页面整体「跳」,键盘收起 / 点空白处时 iOS 才把偏移还原,正是「需要点空白处才能恢复」。代码证据:只听 `resize` 不听 `scroll`;`html/body` 没有固定,文档本身可被 iOS 平移。
2. **H2:高度更新与平移竞速。** `--app-height` 只在 `visualViewport.resize` 时写。键盘动画期间 `resize` 与平移的先后在 iOS 上不确定,外壳先缩、平移后到(或相反),中间帧内容错位;`scroll` 事件不更新高度,也没有再复位。与 H1 同一修复面(`scroll` / `focusin` / `focusout` 后复位)。
3. **H3:触屏输入框字号 < 16 px 导致 iOS 自动放大。** 代码里规则已存在(`index.css` 末尾,`!important`,覆盖了 `Input` 的 `text-sm`、`FIELD` 的 `text-body`(15px)),所以对 iPhone 应不成立;残余风险是 `pointer: coarse` 不命中(带鼠标的 iPad)与将来有人写 `!text-[13px]`。处理:补样式源码断言测试守住,不改 CSS。真机上看 `visualViewport.scale` 是否变大即可证伪。
4. **H4:`scrollIntoView` 一类程序化滚动把祖先(含文档)滚走。** `room-message-list.tsx`、`use-reveal-blank.ts` 会调用,但都在 `visualViewport` 事件或显式动作之后,且目标在 `<main>` 或列表内部;`html/body` 固定且 `overflow: hidden` 后不会再有文档可滚。可能性低,由 T2 顺带消除。
5. **H5(排除):独立主屏幕应用的安全区 / 状态栏问题。** 用户确认只在 Safari 标签页出现,不在本计划范围。

## 本计划的裁定

> 规格与代码不一致或没写清的地方,按下面裁定实施;**没有改规格**。「代价」= 裁定错了的后果。

- **R-K1 复位用 `window.scrollTo(0, 0)`,不用 `translateY(offsetTop)`。** spec §4.2.1 指定 `scrollTo`。条件:`window.scrollY !== 0` 或 `visualViewport.offsetTop > 0`。理由:外壳本来就贴布局视口顶端,把视觉视口拉回 0 就让可见区域与外壳重合,不需要额外状态。代价:若 iOS 不接受 `scrollTo` 复位视觉视口平移(未验证),问题依旧;后手在设备清单末尾「失败时怎么办」(`--app-top` + `translateY`),需要先写 Addendum 再做,本计划不实现。
- **R-K2 双指放大时不复位。** `visualViewport.scale > 1.01` 时 `offsetTop` 可以合法 > 0(用户在放大的页面上平移),强行 `scrollTo(0,0)` 会把用户的手势拽回。与 `use-soft-keyboard.ts` 的 `zoomed()` 同一阈值。代价:放大状态下输入框聚焦的偏移不复位,可接受(用户主动放大)。
- **R-K3 复位只挂在 `useAppHeight`,调用点不变(仍只有 `AppShell`)。** 保持既有调用结构与测试;`/login`、`/install` 不在 `AppShell` 里,不会得到复位。这两页是居中表单,不是用户报告的页面,且 `AnnouncementFrame` 读的 `--app-height` 在退出登录后保留的是上一次的值(既有行为,本计划不动)。设备清单 D2 只要求「不比修复前更差」。代价:登录页键盘行为若也有问题,另起一项把 `useAppHeight` 上移到 `AnnouncementFrame`(那时再删 `AppShell` 里的调用)。
- **R-K4 字号(spec §4.2.3):已满足,不新增 CSS,补测试。** 读 `index.css` 末尾:`@media (pointer: coarse) { input, textarea, select { font-size: 16px !important } }`,未分层(优先于 `@layer utilities`),只作用于触屏,桌面外观不变。逐个确认受影响输入框(全部来自对 `web/src` 的 `<input` / `<textarea` / `<Input` / `<Textarea` / `<select` 搜索,排除测试):
  - 对话:`chat/conversation-page.tsx` `chat-input`(`text-base`)、`chat/conversation-settings-sheet.tsx`(`select`×4 + `Textarea`×2,`selectClass` / `textareaClass` 均 `text-base`)、`chat/scenario-sheet.tsx`(`select`、`Textarea`)、`chat/sheet-form.tsx` 的类名。
  - 联机:`rooms/room-composer.tsx` `room-input`(`text-base`)、`rooms/code-input.tsx`、`rooms/create/settings-fields.tsx` `room-name`、`rooms/extras/invite-sheet.tsx`(只读)。
  - 背单词:`wordbook/typing-question.tsx`(`text-title`)、`learned-page.tsx`(搜索 / 日期 / 选择,`FIELD` = `text-body` 15px)、`goals-stepper.tsx`、`goals-sheet.tsx`、`free-review-sheet.tsx`、`spell/use-cloze-input.ts`(隐藏输入框已 `text-[16px]`)。
  - 其它:`pages/login-page.tsx`(`FIELD` = `text-base`)、`pages/me-page.tsx` 的透明 `select`、`practice/practice-page.tsx` `reference-input`、`grammar/grammar-prompt-editor.tsx`(`text-base`)、`agents/persona-editor-sheet.tsx`、`agents/agent-settings-page.tsx`、`agents/memory/*`(`FIELD` = `text-body` 15px)、`realtime/call-text-draft.tsx`。
  其中 `text-body`(15px)的几处(`learned-page`、`agents/memory`)靠全局规则抬到 16px;测试断言规则存在且是 `!important`、位于 `@layer` 之外。排除:`!text-*` 覆盖输入框的情况不存在(搜索只命中 `app.tsx` 的 Toaster 类名)。代价:带鼠标的 iPad Safari 的 `pointer` 为 `fine`,不命中规则(桌面外观优先,可接受)。
- **R-K5 固定外壳(spec §4.2.2)— 已读代码,可行,但全站维护页需要一个滚动容器。** `html` / `body` 改为 `position: fixed; inset: 0; width: 100%; overflow: hidden; overscroll-behavior: none`,`#root` 保持 `height: 100%`。逐类核对「是否依赖文档滚动」:
  - **`AppShell` 下的全部路由**(`/practice*`、`/chat*`、`/progress`、`/vocabulary`、`/rank*`、`/rooms*`、`/wordbook*`、`/me*`、联动路由):滚动都发生在 `<main class="overflow-y-auto">` 或页面自带的列表容器(对话 `message-list`、联机 `room-messages`、助手面板、各抽屉)。顶栏 `GlassTopBar` 是 `sticky top-0`,相对 `<main>` 粘住,与文档滚动无关;`useScrolled(useScrollRoot())` 监听的是 `<main>` 的 `scroll`。**不受影响。**
  - **`/login`、`/install`:** 在 `AnnouncementFrame` 的内层 `overflow-y-auto` 容器里(`min-h-[100dvh]` 在更矮的容器里就纵向滚动,这是既有行为)。**不受影响。**
  - **全站维护页 `MaintenanceScreen`(`mode === "full"`):** `AnnouncementFrame` 提前返回,它直接挂在 `#root` 下,`min-h-[100dvh]`,**没有滚动容器**。现在依赖文档滚动(横屏小屏文字超出时),固定外壳后会被截断。**必须修**:T3 在 `app.tsx` 里给它包一层 `h-[100dvh] overflow-y-auto`。
  - **程序化滚动:** 搜索 `scrollTo(` / `window.scroll` / `scrollingElement` / `pageYOffset` 在生产代码里**没有命中**;`scrollIntoView` 的调用点(`rooms/room-message-list.tsx`、`wordbook/spell/use-reveal-blank.ts`、`wordbook/goals-sheet.tsx`、`practice/register-daily-tasks.tsx` 滚到 `#shadowing`)目标都在 `<main>` / 列表 / 抽屉内部,滚的是内部容器。
  - **全屏覆盖层:** `BottomSheet` 的遮罩与内容、`hold-to-talk-bar` 的覆盖层、`realtime-call-screen`、`goals-confirm` 都是 `fixed`,相对视口定位,不受 `body` 变成 `fixed` 影响;Radix 的滚动锁(`react-remove-scroll`)对一个本来就不能滚的 `body` 无副作用。
  - **`IntersectionObserver`(联机语音自动转文字「进入视野」):** `root` 为 `null` 时以视口为根并受祖先 `overflow` 裁剪,行为不变。
  - **E2E:** `web/e2e` 里没有 `scrollTo` / `scrollY` / `innerHeight` 的使用;Playwright 的 `scrollIntoViewIfNeeded` 对内部滚动容器照常工作(未运行,标未验证)。
  代价:若漏掉某个依赖文档滚动的页面,表现为「内容被截断、滑不动」;回滚只需还原 T2 那一次提交。
- **R-K6 `html` 与 `body` 都固定(按 spec),`width: 100%`。** 只固定 `body` 在部分 iOS 版本上 `html` 仍可被平移;两者都固定并加 `inset: 0`。代价:无已知副作用,`.dark` 类仍在 `html` 上工作。
- **R-K7 `focusout` 之后再复位一次(spec §4.2.1「键盘收起后再复位一次」)用 350 ms 延迟。** iOS 键盘收起动画约 250–300 ms;延迟结束时再排一次 rAF 复位。`visualViewport` 的 `resize` / `scroll` 在动画期间本来也会触发复位,延迟这一次是兜底。`focusin` 时清掉待执行的延迟。代价:350 ms 是经验值(未验证),不对时只多一次无害的 rAF。
- **R-K8 与 `use-soft-keyboard` / `use-reveal-blank` 共存(spec §4.2.4)。** `scrollTo(0,0)` 只在偏移非 0 时调用、复位后偏移为 0,所以 `visualViewport.scroll` 至多多触发一次、随后收敛(T1 测试「复位后再来 scroll 事件不再调用」)。`use-soft-keyboard` 的 `update` 只 `setOpen(同一个布尔值)`,React 会跳过重渲染;`use-reveal-blank` 只在隐藏输入框聚焦时 rAF `scrollIntoView`,滚的是内部容器,不改 `offsetTop`。T4 用集成测试钉住「同时挂载时 `scrollTo` 不循环、软键盘状态不抖」。不改这两个文件的判定。
- **R-K9 rAF 与计时器通过传入的 `win` 调用。** 与现有 `useAppHeight(win)` 的可注入窗口一致,测试用手写队列而不是假计时器(确定、不依赖 jsdom 的 rAF)。代价:`win` 必须有 `requestAnimationFrame` / `cancelAnimationFrame` / `setTimeout` / `clearTimeout` / `scrollTo` / `scrollY`;真实 `window` 都有。现有 `layout.test.tsx` 的假窗口是 `Object.create(window)`,继承了 jsdom 的这些方法;`scrollTo` 在 jsdom 里是「未实现」(只打印),但该用例 `offsetTop` / `scrollY` 都是 0,不会调用。
- **R-K10 `app.tsx` 与 `components/maintenance-screen.test.tsx` 各动一处,超出「layout/ 与输入框样式」。** 理由只有 R-K5 的维护页:固定外壳让它失去滚动,修复必须在 `AnnouncementFrame`(在 `app.tsx`)。只加一个 `div` 包裹与一个断言用例,不动 `MaintenanceScreen` 本身。

---

## 文件结构

```
web/src/layout/use-app-height.ts           T1:复位逻辑(改)
web/src/layout/use-app-height.test.ts      T1:新(假 visualViewport / rAF / 计时器)
web/src/index.css                          T2:html / body 固定外壳(改,单独一次提交)
web/src/styles/viewport-lock.test.ts       T2:新(样式源码断言:固定规则 + 16px 规则)
web/src/app.tsx                            T3:AnnouncementFrame 维护分支加滚动容器(改)
web/src/components/maintenance-screen.test.tsx   T3:追加一个用例
web/src/layout/app-height-coexist.test.tsx T4:新(与 useSoftKeyboard 共存;若 architecture 测试不允许,改放 rooms/assist/,见 Global Constraints)
web/src/layout/CLAUDE.md  web/README.md    T5
docs/superpowers/plans/2026-10-13-ios-keyboard-scroll-device-checklist.md   已随本计划交付(UNVERIFIED)
```

**合并顺序:** T1 → T2 → T3 → T4 → T5。T2 与 T3 必须同一个 PR 且 T3 紧跟 T2(T2 单独合并会让维护页失去滚动)。整个计划在 A、B 之后合并(spec §6)。

---

## Task T1: `useAppHeight` 复位 `scrollTo(0,0)`

**Files:**
- Modify: `web/src/layout/use-app-height.ts`
- Create: `web/src/layout/use-app-height.test.ts`

**Interfaces:**
- Produces: `useAppHeight(win?: Window): void`(签名不变)、`KEYBOARD_SETTLE_MS = 350`(导出,测试用)。

- [ ] **Step 1: 写失败测试** — 创建 `web/src/layout/use-app-height.test.ts`:

```ts
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KEYBOARD_SETTLE_MS, useAppHeight } from "./use-app-height";

type Fn = () => void;

class Bus {
  private map = new Map<string, Set<Fn>>();
  addEventListener = (type: string, fn: Fn) => {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type)!.add(fn);
  };
  removeEventListener = (type: string, fn: Fn) => { this.map.get(type)?.delete(fn); };
  emit(type: string) { [...(this.map.get(type) ?? [])].forEach((fn) => fn()); }
  get size() { return [...this.map.values()].reduce((n, set) => n + set.size, 0); }
}

interface VV { height: number; offsetTop: number; scale: number }

/** 手写的窗口:visualViewport / window / document 三条事件总线,rAF 与计时器各一个队列,scrollTo 是 mock。 */
function makeEnv(vv: Partial<VV> | null = {}) {
  const vvBus = new Bus();
  const winBus = new Bus();
  const docBus = new Bus();
  const visualViewport = vv === null ? null : Object.assign(vvBus, { height: 600, offsetTop: 0, scale: 1 }, vv);

  const frames = new Map<number, Fn>();
  let nextFrame = 1;
  const timers = new Map<number, Fn>();
  let nextTimer = 1;

  const win = {
    visualViewport,
    innerHeight: 700,
    scrollY: 0,
    document: Object.assign(docBus, { documentElement: document.documentElement }),
    addEventListener: winBus.addEventListener,
    removeEventListener: winBus.removeEventListener,
    scrollTo: vi.fn(),
    requestAnimationFrame: vi.fn((cb: Fn) => { const id = nextFrame++; frames.set(id, cb); return id; }),
    cancelAnimationFrame: vi.fn((id: number) => { frames.delete(id); }),
    setTimeout: vi.fn((cb: Fn) => { const id = nextTimer++; timers.set(id, cb); return id; }),
    clearTimeout: vi.fn((id: number) => { timers.delete(id); }),
  };
  return {
    win,
    window: win as unknown as Window,
    vv: visualViewport as (Bus & VV) | null,
    vvBus, winBus, docBus,
    flushFrames() { const run = [...frames.values()]; frames.clear(); run.forEach((fn) => fn()); },
    fireTimers() { const run = [...timers.values()]; timers.clear(); run.forEach((fn) => fn()); },
    pendingFrames: () => frames.size,
    pendingTimers: () => timers.size,
  };
}

afterEach(() => document.documentElement.style.removeProperty("--app-height"));

describe("useAppHeight: --app-height", () => {
  it("writes the visual viewport height (innerHeight without one) and follows both resize sources", () => {
    const env = makeEnv({ height: 600 });
    renderHook(() => useAppHeight(env.window));
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("600px");
    env.vv!.height = 420;
    env.vvBus.emit("resize");
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("420px");
    env.vv!.height = 380;
    env.winBus.emit("resize");
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("380px");

    const plain = makeEnv(null);
    renderHook(() => useAppHeight(plain.window));
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("700px");
  });
});

describe("useAppHeight: keeping the layout viewport at the origin", () => {
  it("does not call scrollTo when nothing is offset, whatever the event", () => {
    const env = makeEnv({ offsetTop: 0 });
    renderHook(() => useAppHeight(env.window));
    for (const [bus, type] of [[env.vvBus, "resize"], [env.vvBus, "scroll"], [env.winBus, "resize"], [env.docBus, "focusin"], [env.docBus, "focusout"]] as const) {
      bus.emit(type);
      env.flushFrames();
    }
    env.fireTimers();
    env.flushFrames();
    expect(env.win.scrollTo).not.toHaveBeenCalled();
  });

  it("scrolls back to (0,0) in the next frame when visualViewport.offsetTop > 0 (not synchronously)", () => {
    const env = makeEnv({ offsetTop: 0 });
    renderHook(() => useAppHeight(env.window));
    env.vv!.offsetTop = 38;
    env.vvBus.emit("scroll");
    expect(env.win.scrollTo).not.toHaveBeenCalled();
    env.flushFrames();
    expect(env.win.scrollTo).toHaveBeenCalledTimes(1);
    expect(env.win.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("also corrects window.scrollY !== 0 and reacts to focusin", () => {
    const env = makeEnv({ offsetTop: 0 });
    renderHook(() => useAppHeight(env.window));
    env.win.scrollY = 120;
    env.docBus.emit("focusin");
    env.flushFrames();
    expect(env.win.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("works without visualViewport (scrollY only)", () => {
    const env = makeEnv(null);
    renderHook(() => useAppHeight(env.window));
    env.docBus.emit("focusin");
    env.flushFrames();
    expect(env.win.scrollTo).not.toHaveBeenCalled();
    env.win.scrollY = 5;
    env.winBus.emit("resize");
    env.flushFrames();
    expect(env.win.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("coalesces a burst of events into one frame and one scrollTo", () => {
    const env = makeEnv({ offsetTop: 40 });
    renderHook(() => useAppHeight(env.window));
    for (let i = 0; i < 6; i++) { env.vvBus.emit("scroll"); env.vvBus.emit("resize"); env.docBus.emit("focusin"); }
    expect(env.win.requestAnimationFrame).toHaveBeenCalledTimes(1);
    env.flushFrames();
    expect(env.win.scrollTo).toHaveBeenCalledTimes(1);
  });

  it("does not force layout in the handlers: scrollY / offsetTop are read only inside the frame", () => {
    const env = makeEnv({ offsetTop: 0 });
    const reads = vi.fn(() => 0);
    Object.defineProperty(env.win, "scrollY", { get: reads, configurable: true });
    renderHook(() => useAppHeight(env.window));
    reads.mockClear();
    env.vvBus.emit("scroll");
    env.docBus.emit("focusin");
    expect(reads).not.toHaveBeenCalled();
    env.flushFrames();
    expect(reads).toHaveBeenCalled();
  });

  it("settles once the correction took effect: a later scroll event does not call scrollTo again", () => {
    const env = makeEnv({ offsetTop: 30 });
    env.win.scrollTo.mockImplementation(() => { env.vv!.offsetTop = 0; });
    renderHook(() => useAppHeight(env.window));
    env.vvBus.emit("scroll");
    env.flushFrames();
    env.vvBus.emit("scroll"); // scrollTo 自己引起的那一次 scroll 事件
    env.flushFrames();
    expect(env.win.scrollTo).toHaveBeenCalledTimes(1);
  });

  it("leaves a pinch-zoomed page alone (R-K2)", () => {
    const env = makeEnv({ offsetTop: 50, scale: 1.8 });
    renderHook(() => useAppHeight(env.window));
    env.vvBus.emit("scroll");
    env.flushFrames();
    expect(env.win.scrollTo).not.toHaveBeenCalled();
  });

  it("resets once more after the keyboard has finished closing (focusout + delay)", () => {
    const env = makeEnv({ offsetTop: 0 });
    renderHook(() => useAppHeight(env.window));
    env.docBus.emit("focusout");
    env.flushFrames();
    expect(env.win.scrollTo).not.toHaveBeenCalled();
    expect(env.win.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), KEYBOARD_SETTLE_MS);
    env.vv!.offsetTop = 22; // 键盘动画结束时仍有残余偏移
    env.fireTimers();
    env.flushFrames();
    expect(env.win.scrollTo).toHaveBeenCalledTimes(1);
    expect(env.win.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("a new focusin cancels the pending post-blur reset", () => {
    const env = makeEnv({ offsetTop: 0 });
    renderHook(() => useAppHeight(env.window));
    env.docBus.emit("focusout");
    expect(env.pendingTimers()).toBe(1);
    env.docBus.emit("focusin");
    expect(env.pendingTimers()).toBe(0);
  });

  it("removes every listener and cancels pending frame and timer on unmount", () => {
    const env = makeEnv({ offsetTop: 40 });
    const { unmount } = renderHook(() => useAppHeight(env.window));
    expect(env.vvBus.size).toBeGreaterThan(0);
    env.vvBus.emit("scroll");
    env.docBus.emit("focusout");
    expect(env.pendingFrames()).toBe(1);
    expect(env.pendingTimers()).toBe(1);
    unmount();
    expect(env.vvBus.size).toBe(0);
    expect(env.winBus.size).toBe(0);
    expect(env.docBus.size).toBe(0);
    expect(env.pendingFrames()).toBe(0);
    expect(env.pendingTimers()).toBe(0);
    env.flushFrames();
    env.fireTimers();
    expect(env.win.scrollTo).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 看它失败** — `cd web && yarn vitest run src/layout/use-app-height.test.ts`:`KEYBOARD_SETTLE_MS` 未导出,全部用例红。
- [ ] **Step 3: 实现** — 整体替换 `web/src/layout/use-app-height.ts`:

```ts
import { useEffect } from "react";

/** iOS 键盘收起动画约 250–300 ms;focusout 之后在这之后再复位一次(R-K7,经验值,未真机验证)。 */
export const KEYBOARD_SETTLE_MS = 350;

/**
 * iOS 键盘弹出时 visualViewport 变矮;把它写进 --app-height,让输入栏始终可见。
 *
 * 另外:iOS Safari 在输入框聚焦时会把视觉视口相对布局视口平移(visualViewport.offsetTop > 0,有时 scrollY > 0),
 * 而外壳贴在布局视口顶端,平移后页面错位 / 「跳到顶部」(计划 2026-10-13-ios-keyboard-scroll,假设 H1,未真机验证)。
 * visualViewport 的 resize / scroll、window 的 resize、focusin / focusout 之后排一个 rAF(合并),
 * 帧内才读偏移;非 0 就 scrollTo(0, 0)。复位后偏移为 0,不会循环。双指放大(scale > 1.01)时不动用户的平移。
 */
export function useAppHeight(win: Window = window): void {
  useEffect(() => {
    const viewport = win.visualViewport;
    const doc = win.document;
    let frame = 0;
    let timer = 0;

    const apply = () => {
      const height = Math.round(viewport ? viewport.height : win.innerHeight);
      doc.documentElement.style.setProperty("--app-height", `${height}px`);
    };

    const settle = () => {
      frame = 0;
      if (viewport && viewport.scale > 1.01) return;
      if (win.scrollY !== 0 || (viewport?.offsetTop ?? 0) > 0) win.scrollTo(0, 0);
    };
    const schedule = () => {
      if (frame === 0) frame = win.requestAnimationFrame(settle);
    };

    const onViewport = () => {
      apply();
      schedule();
    };
    const onFocusIn = () => {
      win.clearTimeout(timer);
      timer = 0;
      schedule();
    };
    const onFocusOut = () => {
      schedule();
      win.clearTimeout(timer);
      timer = win.setTimeout(() => {
        timer = 0;
        schedule();
      }, KEYBOARD_SETTLE_MS);
    };

    apply();
    viewport?.addEventListener("resize", onViewport);
    viewport?.addEventListener("scroll", schedule);
    win.addEventListener("resize", onViewport);
    doc.addEventListener("focusin", onFocusIn);
    doc.addEventListener("focusout", onFocusOut);
    return () => {
      viewport?.removeEventListener("resize", onViewport);
      viewport?.removeEventListener("scroll", schedule);
      win.removeEventListener("resize", onViewport);
      doc.removeEventListener("focusin", onFocusIn);
      doc.removeEventListener("focusout", onFocusOut);
      if (frame !== 0) win.cancelAnimationFrame(frame);
      win.clearTimeout(timer);
    };
  }, [win]);
}
```

  注意 `visualViewport` 的 `scroll` 直接挂 `schedule`(不重算高度,高度只随 `resize` 变);`schedule` 签名无参,`addEventListener` 会传事件对象,忽略即可。
- [ ] **Step 4: 看它通过** — `cd web && yarn vitest run src/layout/use-app-height.test.ts src/layout/layout.test.tsx`。`layout.test.tsx` 里原有的 `useAppHeight` 用例必须不改就通过(它的假窗口继承 jsdom 的 `requestAnimationFrame` / `setTimeout`,`resize` 触发的 `schedule()` 会真的排一个 rAF,`scrollY` / `offsetTop` 为 0 不调用 `scrollTo`);若因 `Object.create(window)` 上调用继承方法出现 `Illegal invocation`,在该用例的假窗口里补 `requestAnimationFrame: () => 1, cancelAnimationFrame: () => {}, setTimeout: () => 1, clearTimeout: () => {}`(这是测试替身补全,不是放宽断言)。
- [ ] **Step 5: 提交** — `git add web/src/layout/use-app-height.ts web/src/layout/use-app-height.test.ts web/src/layout/layout.test.tsx` → `fix(web): reset the iOS-panned layout viewport to the origin after keyboard events`(尾行 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`)。

---

## Task T2: 固定 `html` / `body` 外壳(单独一次提交)+ 样式源码断言

**Files:**
- Modify: `web/src/index.css`(只改 `@layer base` 里的 `html, body, #root` 规则与 `body` 的 `overscroll-behavior-y`)
- Create: `web/src/styles/viewport-lock.test.ts`

- [ ] **Step 1: 写失败测试** — 创建 `web/src/styles/viewport-lock.test.ts`(节点环境读源码,同 `theme.test.ts` 的做法):

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 计划 2026-10-13-ios-keyboard-scroll:外壳固定 + 触屏输入框 16px。jsdom 没有布局,这里只断言样式源码;
 * 固定外壳在 iOS 上是否真的止住跳动,由真机清单判定(未验证)。
 */
const css = readFileSync(fileURLToPath(new URL("../index.css", import.meta.url)), "utf8");

const decls = (body: string) =>
  Object.fromEntries([...body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

describe("document shell is locked (R-K5, R-K6)", () => {
  const lock = css.match(/html,\s*body\s*\{([^}]*)\}/)?.[1] ?? "";
  const d = decls(lock);

  it("html and body are fixed to the viewport and cannot scroll or rubber-band", () => {
    expect(d.position).toBe("fixed");
    expect(d.inset).toBe("0");
    expect(d.width).toBe("100%");
    expect(d.overflow).toBe("hidden");
    expect(d["overscroll-behavior"]).toBe("none");
  });

  it("the lock lives in @layer base next to the height rule", () => {
    const base = css.slice(css.indexOf("@layer base"), css.indexOf("@font-face"));
    expect(base).toMatch(/html,\s*body\s*\{[^}]*position:\s*fixed/);
    expect(base).toMatch(/html,\s*body,\s*#root\s*\{[^}]*height:\s*100%/);
  });
});

describe("touch inputs are at least 16px so iOS does not zoom on focus (R-K4)", () => {
  const rule = css.match(/@media \(pointer: coarse\)\s*\{\s*input,\s*textarea,\s*select\s*\{([^}]*)\}/);

  it("exists, covers input / textarea / select and is !important", () => {
    expect(rule, "the (pointer: coarse) rule is missing").not.toBeNull();
    expect(rule![1]).toMatch(/font-size:\s*16px\s*!important/);
  });

  it("sits outside @layer so it also beats utility classes such as text-sm / text-body", () => {
    const at = css.indexOf("@media (pointer: coarse)");
    const before = css.slice(0, at);
    const opened = (before.match(/@layer[^{]*\{/g) ?? []).length;
    // 每个 @layer 块的括号都已闭合:数大括号平衡
    const balance = [...before].reduce((n, c) => n + (c === "{" ? 1 : c === "}" ? -1 : 0), 0);
    expect(opened).toBeGreaterThan(0);
    expect(balance).toBe(0);
  });
});
```

- [ ] **Step 2: 看它失败** — `cd web && yarn vitest run src/styles/viewport-lock.test.ts`:固定外壳的用例红(现状没有 `html, body {` 规则;`html, body, #root` 里只有 `height`);16px 用例已绿(规则本来就在)。
- [ ] **Step 3: 实现** — `web/src/index.css`,把

```css
  html,
  body,
  #root {
    height: 100%;
  }
  body {
    @apply bg-background font-sans text-body text-foreground antialiased;
    -webkit-tap-highlight-color: transparent;
    overscroll-behavior-y: none;
  }
```

  换成:

```css
  /*
   * 固定外壳(计划 2026-10-13-ios-keyboard-scroll):滚动只发生在内部容器(AppShell 的 <main>、对话 / 房间的列表、抽屉),
   * 文档自己不滚也不橡皮筋,iOS 聚焦输入框时没有文档可被「顶走」。全站维护页没有内部滚动容器,由 app.tsx 的 AnnouncementFrame 补一层。
   */
  html,
  body {
    position: fixed;
    inset: 0;
    width: 100%;
    overflow: hidden;
    overscroll-behavior: none;
  }
  html,
  body,
  #root {
    height: 100%;
  }
  body {
    @apply bg-background font-sans text-body text-foreground antialiased;
    -webkit-tap-highlight-color: transparent;
  }
```

  (`body` 上原有的 `overscroll-behavior-y: none` 并入上面的 `overscroll-behavior: none`,所以删掉。)
- [ ] **Step 4: 看它通过** — `cd web && yarn vitest run src/styles/viewport-lock.test.ts src/styles/theme.test.ts src/layout`。
- [ ] **Step 5: 浏览器窗格目测(桌面,可选)** — `yarn web:dev`,375×812 与桌面宽度各看 `/practice`、`/chat`、`/me`:内容仍可滚动、顶栏滚动后变玻璃、没有出现整页滚动条。这只能证明桌面没坏,**不证明 iOS 修好**。
- [ ] **Step 6: 提交(单独一次,便于真机失败时回滚)** — `git add web/src/index.css web/src/styles/viewport-lock.test.ts` → `fix(web): lock html and body so only inner containers scroll`(尾行同上)。

---

## Task T3: 全站维护页的滚动容器

**Files:**
- Modify: `web/src/app.tsx`(`AnnouncementFrame` 的 `maintenance.mode === "full"` 分支)
- Modify: `web/src/components/maintenance-screen.test.tsx`(追加一个用例)

- [ ] **Step 1: 写失败测试** — 在 `maintenance-screen.test.tsx` 的第一个用例(`shows the maintenance page instead of the app …`)之后追加(同文件已有 `renderApp`、`ann` mock、中文设置):

```tsx
it("keeps the full-maintenance page scrollable now that html/body are locked (R-K5)", async () => {
  vi.mocked(ann.fetchAnnouncements).mockResolvedValue({
    announcements: [],
    maintenance: { mode: "full", messageZh: "数据库升级,预计 10 分钟", messageEn: "Upgrading" },
  });
  renderApp("/me");
  const main = await screen.findByRole("main");
  const scroller = main.parentElement!;
  expect(scroller.className).toMatch(/\boverflow-y-auto\b/);
  expect(scroller.className).toContain("h-[100dvh]");
});
```

- [ ] **Step 2: 看它失败** — `cd web && yarn vitest run src/components/maintenance-screen.test.tsx`:`main.parentElement` 现在是 `#root` 外的测试容器 `div`,没有 `overflow-y-auto`。
- [ ] **Step 3: 实现** — `app.tsx` 的 `AnnouncementFrame`,把 full 维护分支的返回改成:

```tsx
  if (state?.maintenance.mode === "full") {
    const m = state.maintenance;
    // html/body 已固定(index.css),维护页自己提供滚动容器;横屏小屏文字超出时才能滚动
    return (
      <div className="h-[100dvh] overflow-y-auto">
        <MaintenanceScreen message={pickText(i18n.language, m.messageZh, m.messageEn)} onRetry={() => void refreshAnnouncements()} />
      </div>
    );
  }
```
  `MaintenanceScreen` 自己的 `min-h-[100dvh]` 保持不变(包裹层刚好一屏高,内容更高时包裹层滚动)。
- [ ] **Step 4: 看它通过** — `cd web && yarn vitest run src/components/maintenance-screen.test.tsx`(原有的三个用例不变)。
- [ ] **Step 5: 提交** — `git add web/src/app.tsx web/src/components/maintenance-screen.test.tsx` → `fix(web): give the full-maintenance page its own scroll container`(尾行同上)。

---

## Task T4: 与 `useSoftKeyboard` 共存(不循环、不抖)

**Files:**
- Create: `web/src/layout/app-height-coexist.test.tsx`

- [ ] **Step 1: 先确认放置位置** — `cd web && yarn vitest run src/architecture.test.ts` 读一遍它是否扫描测试文件里的 `~/features/...` import。若不扫描,文件放 `web/src/layout/`;若扫描(`layout/` 不应依赖 features 内部路径),把同一文件放到 `web/src/features/rooms/assist/app-height-coexist.test.tsx` 并把 import 改成 `~/layout/use-app-height` 与 `./use-soft-keyboard`。下面按 `layout/` 写;**不得**为过这个测试放宽架构规则。
- [ ] **Step 2: 写测试** — 创建 `web/src/layout/app-height-coexist.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSoftKeyboard } from "~/features/rooms/assist/use-soft-keyboard";
import { useAppHeight } from "./use-app-height";

/**
 * spec §4.2.4:useAppHeight 的 scrollTo(0,0) 不能让 use-soft-keyboard(监听 vv.scroll)抖动或循环。
 * 真实 window + 手写 visualViewport(EventTarget)+ 手动 rAF 队列。
 */
class FakeVV extends EventTarget {
  height = 800;
  width = 390;
  offsetTop = 0;
  scale = 1;
}

let vv: FakeVV;
let frames: Array<() => void>;
let scrollTo: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vv = new FakeVV();
  frames = [];
  Object.defineProperty(window, "visualViewport", { configurable: true, value: vv });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { frames.push(() => cb(0)); return frames.length; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => { vv.offsetTop = 0; });
});
afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "visualViewport");
  document.documentElement.style.removeProperty("--app-height");
});

const flush = () => { const run = frames.splice(0); run.forEach((fn) => fn()); };

describe("useAppHeight together with useSoftKeyboard", () => {
  it("one correction per pan, no loop, and the keyboard state does not flap", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      useAppHeight();
      return useSoftKeyboard();
    });

    act(() => { vv.height = 420; vv.offsetTop = 36; vv.dispatchEvent(new Event("resize")); });
    act(() => { vv.dispatchEvent(new Event("scroll")); flush(); });
    const keyboard = result.current;
    const settledRenders = renders;
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);

    // scrollTo 自己引起的 scroll 事件:不再复位,软键盘状态不变,不再重渲染
    act(() => { vv.dispatchEvent(new Event("scroll")); flush(); });
    act(() => { vv.dispatchEvent(new Event("scroll")); flush(); });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(keyboard);
    expect(renders).toBe(settledRenders);
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("420px");
  });
});
```

- [ ] **Step 3: 运行** — `cd web && yarn vitest run src/layout/app-height-coexist.test.tsx`。写计划时未运行:执行者第一次运行以真实结果为准修正(重点:`vi.spyOn(window, "requestAnimationFrame")` 在 jsdom 上可否 spy;`Object.defineProperty(window, "visualViewport")` 在 jsdom 上是否可写;`useSoftKeyboard` 首次渲染后因 `update()` 多一次重渲染,`settledRenders` 取的是复位之后的数,这个差值已排除在断言之外)。
- [ ] **Step 4: 提交** — `git add web/src/layout/app-height-coexist.test.tsx` → `test(web): pin that the viewport reset does not loop with the soft-keyboard hook`(尾行同上)。

---

## Task T5: 文档

**Files:**
- Modify: `web/src/layout/CLAUDE.md`、`web/README.md`

- [ ] **Step 1: `layout/CLAUDE.md`** — 「What lives here」里 `use-app-height.ts` 一行改为:`use-app-height.ts`(`--app-height` + iOS 键盘后 `scrollTo(0,0)` 复位,`KEYBOARD_SETTLE_MS`)。「Pitfalls」追加三条:
  - `html` / `body` 在 `index.css` 里是 `position: fixed; overflow: hidden`:文档不滚,新页面必须有自己的滚动容器(`AppShell` 的 `<main>`;`AnnouncementFrame` 内层;全站维护页的包裹层)。不要依赖 `window.scrollTo` / 文档滚动。
  - 键盘跳动修复(计划 `2026-10-13-ios-keyboard-scroll`)**未在真机验证**;改 `use-app-height.ts` 前先读该计划的假设与 `…-device-checklist.md`。
  - 复位只在偏移非 0 且未双指放大时调用 `scrollTo(0,0)`;不要在 `visualViewport` 事件里同步读布局。
- [ ] **Step 2: `web/README.md`** — 先 `grep -n "未验证\|unverified\|iOS" web/README.md` 找到记录「真机未验证」的段落,在其末尾追加一条:iOS Safari 点输入框页面跳到顶部的修复(复位 `scrollTo(0,0)` + 固定 `html` / `body`)**尚未在真机验证**,清单见 `docs/superpowers/plans/2026-10-13-ios-keyboard-scroll-device-checklist.md`。
- [ ] **Step 3: 检查** — `cd web && yarn vitest run src/architecture.test.ts src/layout src/styles src/components/maintenance-screen.test.tsx`;`yarn web:typecheck`。
- [ ] **Step 4: 提交** — `git add web/src/layout/CLAUDE.md web/README.md` → `docs(web): document the viewport reset and the locked document shell`(尾行同上)。

---

## 最终检查与交付

- [ ] 全部任务后:`yarn web:typecheck && yarn web:test && yarn web:build`(**只在用户要求时跑全量**;E2E 不跑,它花钱且不模拟 iOS 软键盘)。
- [ ] 建议评审:`/code-review high`(重点:R-K5 的页面清单有没有漏;`useAppHeight` 的清理是否完整)。
- [ ] 交付说明里明确写:**未在真机验证**。请用户拿 iPhone Safari 按 `docs/superpowers/plans/2026-10-13-ios-keyboard-scroll-device-checklist.md` 逐项测,结果填回清单;用户确认修好之前,本计划的 `- [ ]` 与清单的框都不勾(`docs/CLAUDE.md`:合并且测试通过才勾,真机项由用户勾)。

## 结果表(执行后填)

| 项 | 结果 |
|---|---|
| T1 单元测试 | (待填) |
| T2 样式断言 | (待填) |
| T3 维护页包裹 | (待填) |
| T4 共存测试(放置位置:layout / rooms-assist) | (待填) |
| 全量 typecheck / test / build | (用户要求时才跑) |
| 真机清单 A–D | **UNVERIFIED**(用户验证) |
