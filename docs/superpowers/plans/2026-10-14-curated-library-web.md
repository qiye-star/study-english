# 精选库 · 网页(车道 W)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **先读** `2026-10-14-curated-library-INDEX.md`(§6 形状、§9 文件归属)与 spec §10。**Task 0(设计稿)可以立即做;Task 1 起被两件事阻塞:① 控制者把设计稿给用户看并得到确认(BLOCKED ON MOCKUP APPROVAL);② 车道 SC 已合并(契约夹具与网页类型已同步)。** 设计稿评审时用户提出的修改,写成本计划末尾的 `## Addendum (日期)`,其中的裁定优先于正文。

**Goal:** 在跟读库里加「精选」:列表页顶部 `我的 / 精选` 分段;「精选」列出已发布的内置素材(封面、标题、级别、标签、时长、句数、许可说明),一键「添加到我的库」(幂等,已添加显示「去学习」),成功后进入播放页。「我的」里的副本带「精选」徽标、菜单里没有「重新识别 / 重新分句」、不能换字幕;播放页对有封面的音频条目显示封面;副本已有译文时即使 `config.ai` 为假也能打开「译」(只显示已存的)。

**Architecture:** 全部在 `web/src/features/library/` 的懒加载块里:新文件 `catalog-api.ts`(列表、添加、封面 blob)、`use-catalog.ts`(取列表、添加中的状态、错误)、`catalog-view.tsx`(网格 + 级别筛选 + 空状态)、`catalog-card.tsx`;`library-list-page.tsx` 加分段与 `?tab=catalog`。不新增跨 feature 边、不新增 npm 依赖、不碰 `theme.css` 与 `GlassTabBar`;样式进 `library.css`(遵守其 `backdrop-filter` 预算与 `.lite` / 减少动态效果段)。主包不变(`library-lazy.test.ts` 守卫)。

**Tech Stack:** React 18、react-router、i18next、vitest + Testing Library、`camelcase-keys`(已有)。

## Global Constraints

- **合并顺序:SC →(SI ‖ W)→ AU → Z。** W 只依赖 SC 的用户接口;与 SI 无共同文件。
- **文件归属(INDEX §9):** `docs/superpowers/design/curated-library-v1/mockup.html`;SC 合并后:`web/src/features/library/` 下本计划列出的新旧文件、`web/README.md`。`features/library/library-api.ts`、`config.ts`、`library-contract.test.ts`、`locales/*` 在 SC 合并后才可改(SC 已为它们做过契约同步)。
- `src/architecture.test.ts` 不改(不新增跨 feature 边);`library-lazy.test.ts` 的 `LAZY_ONLY` 加入新的懒模块名(`catalog-api`、`catalog-view`、`use-catalog`)。
- 新增文案键 ≤ 15 个,放 `locales/{en,zh-CN}.json`(懒加载;`locales.test.ts` 校验中英键一致);不加进 `i18n/`(主包)。
- 标题、许可说明、链接从不进 URL 与日志;`?tab=catalog` 是唯一新增的查询参数。
- 每个任务只跑 `cd web && yarn vitest run <列出的文件>`;合并前 `yarn web:typecheck`(根目录)。不跑 E2E、不 build、不碰容器。
- 提交:`feat(web): …`,一个任务一个提交,结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## 本计划的裁定

- **R-W1 入口是分段,不是新路由。** `/library?tab=catalog`;`config.catalog` 为假时不渲染分段,`?tab=catalog` 被忽略(回到「我的」)。理由:不加路由就不碰 `app.tsx` 与底部导航,懒加载块不变。
- **R-W2 添加后直接进播放页**(`navigate("/library/" + item.id)`);`created: false`(已添加过)同样进入,不报错。列表上「已添加」的卡片按钮文案是「去学习」。
- **R-W3 筛选只在客户端**:级别筛选芯片(全部 + 出现过的级别),目录 ≤ 200 条,一次取完,不分页、不进 URL。
- **R-W4 封面**:目录卡片经 `GET /api/library/catalog/{id}/poster` 取 blob(同 `use-poster.ts` 的懒取 + 撤销 URL 做法,抽一个 `fetchBlob` 参数,不复制逻辑);副本走现有 `/items/{id}/poster`。`use-poster.ts` 的 `enabled` 由调用方决定:播放页改为 `detail.hasPoster`(不再只限 `kind === "video"`)。
- **R-W5 副本的菜单**:`item.source === "catalog"` 时不传 `onReprocess` / `onRebuild`,也不显示「换字幕」(若列表页有该入口);标题改名、删除照常。删除确认文案对副本补一句「不会影响精选库里的原条目,之后可以重新添加」。
- **R-W6 「译」开关**:`canTranslate = (ai || detail.segments.some((s) => s.zh && s.zhLang === native)) && native !== "en-US"`;`ai` 为假时开关只显示已存译文,不请求 `translate`(`use-translations.ts` 收到 `ai=false` 时跳过请求)。
- **R-W7 视觉**:以 Task 0 的设计稿为唯一依据;沿用 `fx/` 现成效果(`SpotlightCard`、`SpecularButton`、`CountUp`),不新增效果、不新增 `@keyframes`、不新增 `backdrop-filter`。

---

## Task 0: HTML 设计稿(给用户看;不改任何源码)

**Files:** Create `docs/superpowers/design/curated-library-v1/mockup.html`(单文件,内联 CSS / JS,不引外部脚本与字体)

- [ ] **Step 1:** 读 `docs/superpowers/design/video-import-v1/mockup-glass.html`(玻璃参数、深色优先、色板、卡片与分段的样式)与 `web/src/features/library/library.css` 的变量名;设计稿复用同一套 CSS 变量名与数值,便于实现时直接对照。
- [ ] **Step 2:** 设计稿内容(375 × 812 手机框,深色为默认,右上角一个「浅色 / 深色」切换只用于评审):
  1. **列表页 ·「我的」**:顶部 `我的 / 精选` 分段;卡片里有一张副本,带「精选」小徽标、大小显示「不占空间」。
  2. **列表页 ·「精选」**:级别芯片(全部 · A2 · B1 · B2);2 列网格(≥ 400 px 时 2 列,更窄 1 列)卡片:封面 16:9(无封面时音频图标渐变底)、标题两行截断、级别徽标、最多 3 个标签、`时长 · 句数`、许可说明一行小字(灰)、按钮三态:「添加到我的库」(主按钮)/ 添加中(按钮内转圈)/「已添加 · 去学习」(次按钮)。
  3. **空状态**:「精选素材正在准备中」+ 一句说明。
  4. **错误提示**:「这条精选素材已下架」吐司样例。
  5. **播放页**(副本):音频区显示封面图;句子下有中文译文;「译」开关在 `ai` 关闭时仍可用的说明标注。
  6. 每个区块旁用小号注释写出:用到的 `fx/` 组件、模糊层数(≤ 3)、`.lite` 下的退化。
- [ ] **Step 3:** 不提交源码改动;只 `git add` 这个 HTML。**提交** `docs: curated library mockup v1`。
- [ ] **Step 4(控制者):** 把设计稿给用户看,记录确认或修改;修改写进本计划 `## Addendum`。**在此之前不得开始 Task 1。**

---

## Task 1: 接口与数据钩子(BLOCKED ON MOCKUP APPROVAL)

**Files:** Create `web/src/features/library/{catalog-api.ts,catalog-api.test.ts,use-catalog.ts,use-catalog.test.tsx}`;Modify `library-contract.test.ts`、`library-lazy.test.ts`

- [ ] **Step 1: 失败测试** `catalog-api.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "~/api/client";
import { addCatalogItem, fetchCatalogPoster, listCatalog } from "./catalog-api";

const api = (reply: unknown) => ({ request: vi.fn(async () => reply) }) as unknown as ApiClient & { request: ReturnType<typeof vi.fn> };

describe("catalog api", () => {
  it("lists built-in items", async () => {
    const a = api({ items: [{ id: "c1", title: "T", level: "B1", tags: ["news"], licenseNote: null, durationMs: 1, segCount: 2, hasPoster: true, publishedAt: "x", addedItemId: null }] });
    const items = await listCatalog(a);
    expect(a.request).toHaveBeenCalledWith("GET", "/api/library/catalog", expect.anything());
    expect(items[0].addedItemId).toBeNull();
  });
  it("adds an item (ids only in the URL) and unwraps {item, created}", async () => {
    const a = api({ item: { id: "i1", source: "catalog" }, created: false });
    const out = await addCatalogItem(a, "c1");
    expect(a.request).toHaveBeenCalledWith("POST", "/api/library/catalog/c1/add", expect.anything());
    expect(out).toEqual({ item: { id: "i1", source: "catalog" }, created: false });
  });
  it("fetches the poster as a blob", async () => {
    const a = api(new Blob(["x"]));
    await fetchCatalogPoster(a, "c1");
    expect(a.request).toHaveBeenCalledWith("GET", "/api/library/catalog/c1/poster", expect.objectContaining({ as: "blob" }));
  });
});
```

  (`ApiClient.request` 的确切签名与参数形状以 `web/src/api/client.ts` 为准;`library-api.ts` 里 `fetchPoster` 的写法是模板。)
- [ ] **Step 2: 实现** `catalog-api.ts`(只用 `encodeURIComponent` 拼 id;类型键与 INDEX §6 的 `CatalogCard` 一一对应):

```ts
import type { ApiClient } from "~/api/client";
import type { LibraryItem } from "./library-api";

/** 精选库卡片(spec 2026-10-14-curated-library §9;服务端 catalog_store.public_out,ApiClient 已转 camelCase)。 */
export interface CatalogCard {
  id: string; title: string; level: string | null; tags: string[]; licenseNote: string | null;
  durationMs: number | null; segCount: number; hasPoster: boolean; publishedAt: string | null; addedItemId: string | null;
}
export interface CatalogAdd { item: LibraryItem; created: boolean }

const enc = encodeURIComponent;

export async function listCatalog(api: ApiClient, signal?: AbortSignal): Promise<CatalogCard[]> {
  const reply = await api.request<{ items: CatalogCard[] }>("GET", "/api/library/catalog", { signal });
  return reply.items ?? [];
}

export function addCatalogItem(api: ApiClient, id: string): Promise<CatalogAdd> {
  return api.request<CatalogAdd>("POST", `/api/library/catalog/${enc(id)}/add`, {});
}

export function fetchCatalogPoster(api: ApiClient, id: string, signal?: AbortSignal): Promise<Blob> {
  return api.request<Blob>("GET", `/api/library/catalog/${enc(id)}/poster`, { as: "blob", signal });
}
```

- [ ] **Step 3: 契约**:`library-contract.test.ts` 追加(夹具键 `catalog_list` / `catalog_add` / `catalog_add_again` 由 SC 手工加过):

```ts
const CARD: Record<keyof CatalogCard, true> = {
  id: true, title: true, level: true, tags: true, licenseNote: true, durationMs: true, segCount: true, hasPoster: true,
  publishedAt: true, addedItemId: true,
};

describe("catalog contract (server fixture)", () => {
  it("list cards and the add reply match", () => {
    const list = cc<{ items: CatalogCard[] }>(c.catalog_list);
    expect(keysOf(list.items[0])).toEqual(keys(CARD));
    const add = cc<{ item: LibraryItem; created: boolean }>(c.catalog_add);
    expect(keysOf(add)).toEqual(["created", "item"]);
    expect(keysOf(add.item)).toEqual(keys(ITEM));
    expect(add.item.source).toBe("catalog");
    expect(cc<{ created: boolean }>(c.catalog_add_again).created).toBe(false);
  });
});
```

  (`import type { CatalogCard } from "./catalog-api";`)
- [ ] **Step 4: 钩子** `use-catalog.ts`:`useCatalog(enabled)` → `{ items, error, loading, refresh, add(id): Promise<CatalogAdd>, adding: string | null }`;`add` 成功后把该卡片的 `addedItemId` 就地改成新副本 id(不必重取列表);并发点击同一张卡只发一次(`adding === id` 时直接返回同一个 promise)。测试 `use-catalog.test.tsx` 用 `renderHook` + 假 `ApiClient`:首次加载、`add` 更新 `addedItemId`、双击只请求一次、404 文案经 `translateServerError(t, err, LIBRARY_SERVER_ERRORS)` 映射到 `web.library.errors.catalogNotFound`。
- [ ] **Step 5:** `library-lazy.test.ts` 的 `LAZY_ONLY` 加 `"catalog-api"`、`"catalog-view"`、`"use-catalog"`。
- [ ] **Step 6:** `yarn vitest run src/features/library/catalog-api.test.ts src/features/library/use-catalog.test.tsx src/features/library/library-contract.test.ts src/features/library/library-lazy.test.ts` → 绿。**提交** `feat(web): catalog API and hook`。

---

## Task 2: 「精选」视图与分段(BLOCKED ON MOCKUP APPROVAL)

**Files:** Create `catalog-view.tsx`、`catalog-card.tsx`、`catalog-view.test.tsx`;Modify `library-list-page.tsx`、`library-list-page.test.tsx`、`library.css`、`library-css.test.ts`(若需登记新选择器)、`locales/{en,zh-CN}.json`

- [ ] **Step 1: 文案键**(`web.library.catalog.*`,≤ 12 个):`tabMine`「我的」/ "Mine"、`tabCatalog`「精选」/ "Featured"、`add`「添加到我的库」/ "Add to my library"、`adding`「正在添加」/ "Adding"、`open`「去学习」/ "Study"、`added`「已添加」/ "Added"、`allLevels`「全部」/ "All"、`empty`「精选素材正在准备中」/ "Featured items are on the way"、`emptyHint`「管理员发布后会出现在这里。」/ "They will appear here once published."、`badge`「精选」/ "Featured"、`noSpace`「不占空间」/ "Uses no space"、`deleteCopyNote`「不会影响精选库里的原条目,之后可以重新添加。」/ "The featured original stays; you can add it again later."。
- [ ] **Step 2: 失败测试** `catalog-view.test.tsx`(假 `ApiClient`,`test-i18n.ts` 提供 `t`;路由用 `MemoryRouter` + 一个探针路由断言跳转):

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { CatalogView } from "./catalog-view";
import type { CatalogCard } from "./catalog-api";

const CARD: CatalogCard = { id: "c1", title: "VOA: Coffee", level: "B1", tags: ["news", "food"], licenseNote: "VOA · Public domain",
  durationMs: 61000, segCount: 12, hasPoster: false, publishedAt: "2026-10-14T00:00:00Z", addedItemId: null };

function fakeApi(items: CatalogCard[], add = vi.fn(async () => ({ item: { id: "i9", source: "catalog" }, created: true }))) {
  return { request: vi.fn(async (method: string, url: string) => (method === "GET" ? { items } : add(url))) };
}

function renderView(api: ReturnType<typeof fakeApi>) {
  // 用 library 里现有的测试注入方式提供 ApiClient(参照 library-list-page.test.tsx 的 useAuth mock)
  return render(
    <MemoryRouter initialEntries={["/library?tab=catalog"]}>
      <Routes>
        <Route path="/library" element={<CatalogView api={api as never} />} />
        <Route path="/library/:id" element={<p>player page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CatalogView", () => {
  it("shows cards with level, tags, length and the license line", async () => {
    renderView(fakeApi([CARD]));
    expect(await screen.findByText("VOA: Coffee")).toBeInTheDocument();
    expect(screen.getByText("B1")).toBeInTheDocument();
    expect(screen.getByText("VOA · Public domain")).toBeInTheDocument();
  });

  it("adds and opens the player", async () => {
    const api = fakeApi([CARD]);
    renderView(api);
    await userEvent.click(await screen.findByRole("button", { name: "web.library.catalog.add" }));
    expect(await screen.findByText("player page")).toBeInTheDocument();
    expect(api.request).toHaveBeenCalledWith("POST", "/api/library/catalog/c1/add", expect.anything());
  });

  it("an added card opens the existing copy without a request", async () => {
    const api = fakeApi([{ ...CARD, addedItemId: "i1" }]);
    renderView(api);
    await userEvent.click(await screen.findByRole("button", { name: "web.library.catalog.open" }));
    expect(await screen.findByText("player page")).toBeInTheDocument();
    expect(api.request).toHaveBeenCalledTimes(1);  // only the list
  });

  it("filters by level on the client and shows the empty state", async () => {
    renderView(fakeApi([CARD, { ...CARD, id: "c2", title: "Other", level: "A2" }]));
    await userEvent.click(await screen.findByRole("button", { name: "A2" }));
    expect(screen.queryByText("VOA: Coffee")).toBeNull();
    expect(screen.getByText("Other")).toBeInTheDocument();
  });

  it("empty catalog", async () => {
    renderView(fakeApi([]));
    expect(await screen.findByText("web.library.catalog.empty")).toBeInTheDocument();
  });
});
```

  (`CatalogView` 接受可选 `api` 属性只为测试;产品代码里用 `useAuth().api`。若 `test-i18n.ts` 返回真实文案而不是键名,把断言里的键名换成 `t(...)` 的结果——以该助手的真实行为为准。)
- [ ] **Step 3: 实现**(视觉照设计稿;类名前缀 `lib-cat-`):
  - `catalog-card.tsx`:`SpotlightCard` 外框(列表卡片规则:半透明填充 + 高光边,**不**加 `backdrop-filter`);封面经 `usePosterUrl(card.id, card.hasPoster, ref, fetchCatalogPoster)`(见 Task 3 对 `use-poster.ts` 的扩展;Task 2 可先不显示封面,Task 3 接上);级别徽标、≤ 3 个标签、`formatDuration(durationMs) · {segCount} 句`(复用 `format.ts`)、许可说明一行 `text-ink-3`;按钮:`addedItemId` → 次按钮 `open`,否则主按钮 `SpecularButton` `add` / `adding`。
  - `catalog-view.tsx`:`useCatalog(true)`;级别芯片(全部 + 出现过的级别,按 `A1…C2` 排);网格 `grid-cols-1 min-[400px]:grid-cols-2 gap-3`;空状态 / 错误(`PageError` + 重试)/ 加载(`PageLoading`);`add` → `navigate("/library/" + id)`(R-W2);错误 `toast.error(translateServerError(...))`。
  - `library-list-page.tsx`:`config.catalog` 为真时在 `PageHeader` 下渲染 `SegmentedControl`(`我的 / 精选`,`className` 走 `.library-root .lib-seg`),值来自 `useSearchParams().get("tab") === "catalog"`,切换时 `setSearchParams(tab === "catalog" ? {tab} : {}, {replace: true})`;`catalog` 时渲染 `<CatalogView />` 并隐藏「添加素材」按钮与已用空间条;否则原样。
  - `library.css`:新增 `.lib-cat-*` 规则;**不**新增 `backdrop-filter` 与 `@keyframes`;在文件末尾 `.lite` 与 `prefers-reduced-motion` 段补上新 transition。
- [ ] **Step 4:** `library-list-page.test.tsx` 追加:`config.catalog: false` 时没有分段;`?tab=catalog` + `catalog: true` 时渲染精选视图(mock `./catalog-view` 为一个标记组件即可)。
- [ ] **Step 5:** `yarn vitest run src/features/library` → 绿(含 `library-css.test.ts` 的模糊预算、`locales.test.ts`)。**提交** `feat(web): featured tab in the library`。

---

## Task 3: 副本的徽标、菜单、封面与「译」(BLOCKED ON MOCKUP APPROVAL)

**Files:** Modify `item-card.tsx`(+ 测试)、`item-menu.tsx`(+ 测试)、`library-list-page.tsx`(删除确认补一句)、`use-poster.ts`(+ 测试)、`player-page.tsx`(+ 测试)、`use-translations.ts`(+ 测试,若需要)

- [ ] **Step 1: 失败测试**(追加到对应 `*.test.tsx`;造数据用 `test-fixtures.ts` 的条目工厂并覆盖 `source: "catalog"`、`catalogId: "c1"`、`libraryBytes: 0`、`kind: "audio"`、`hasPoster: true`):
  - `item-card.test.tsx`:副本显示 `web.library.catalog.badge` 与 `web.library.catalog.noSpace`;`subSource: "asr"` 的副本菜单里没有「重新识别」「重新分句」。
  - `use-poster.test.tsx`:`usePosterUrl(id, true, undefined, fetcher)` 用传入的 `fetcher` 取 blob;不传时仍用 `fetchPoster`(现有测试不变)。
  - `player-page.test.tsx`:`kind: "audio"` 且 `hasPoster: true` 的条目在音频区渲染 `<img>`(`alt=""`);`config.ai = false` 且句子带 `zh`(`zhLang` = 母语)时「译」开关可见,打开后显示译文且没有发出 `translate` 请求。
- [ ] **Step 2: 实现。**
  - `use-poster.ts`:签名加第 4 个可选参数 `fetcher: (api: ApiClient, id: string, signal?: AbortSignal) => Promise<Blob> = fetchPoster`(R-W4);`catalog-card.tsx` 传 `fetchCatalogPoster`。
  - `item-card.tsx`:`item.source === "catalog"` → 标题旁小徽标 `badge`(琥珀以外的中性玻璃色,按设计稿),大小处显示 `noSpace`;`canReprocess` / `canRebuild` 再加 `&& item.source !== "catalog"`(R-W5)。
  - `library-list-page.tsx`:删除确认框对副本多显示一行 `deleteCopyNote`;若页面有「补传 / 替换字幕」入口,对副本不显示。
  - `player-page.tsx`:`usePosterUrl(detail.id, detail.hasPoster)`;音频区有 `poster` 时渲染 `<img src={poster} alt="" className="lib-stage-poster" />`(保留原有图标作为无封面时的回退);`canTranslate` 按 R-W6;把 `ai` 传给 `use-translations`,`ai=false` 时不请求。
- [ ] **Step 3:** `yarn vitest run src/features/library` → 绿;`yarn web:typecheck` → 绿。**提交** `feat(web): featured copies in my library and the player`。

---

## Task 4: 文档(誊写)

**Files:** `web/src/features/library/CLAUDE.md`、`web/README.md`

- [ ] **Step 1:** `features/library/CLAUDE.md`「What lives here」加一条:「精选库(spec `2026-10-14-curated-library-design.md` §10;设计稿 `docs/superpowers/design/curated-library-v1/mockup.html`):`catalog-api.ts`(列表 / 添加 / 封面)、`use-catalog.ts`、`catalog-view.tsx` + `catalog-card.tsx`(`/library?tab=catalog`,`config.catalog` 控制);副本是普通条目(`source: "catalog"`、`catalogId`),不能重新识别 / 换字幕。」「Pitfalls」加:「副本的媒体是共享文件:删除副本只删用户自己的条目;不要在网页上推断或显示文件路径。」「添加」接口幂等,已添加的卡片直接进入播放页。
- [ ] **Step 2:** `web/README.md` 的跟读库一节加「精选」一段(行为 + 未验证:真机上精选网格的滚动性能与玻璃效果、iOS 播放共享 m4a 与封面)。
- [ ] **Step 3:** **提交** `docs: featured library notes for the web app`。

## 未验证

真机(iOS Safari / Android Chrome)上的精选网格滚动、封面懒加载、`SpotlightCard` 在长列表里的性能;共享 m4a 在 iOS 上的 Range 播放与单句循环精度(与上传条目同一机制,但音频编码不同)。

## Addendum (2026-10-14,级别标注)

计划 `2026-10-14-level-annotations.md` Task T7:精选的级别芯片与卡片徽标改为「B1 · 中级」(`~/lib/levels::levelLabel`),芯片行下一行说明(`~/components/level-hint::LevelHint`,选「全部」时是 CEFR 总说明)。取值与筛选逻辑(`levelsOf`、`LEVEL_ORDER`)不变。
