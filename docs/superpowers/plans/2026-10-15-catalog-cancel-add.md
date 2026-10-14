# 精选 ·「取消入库」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **先读** 根 `CLAUDE.md`、`web/CLAUDE.md`、`web/src/features/library/CLAUDE.md`、`docs/superpowers/plans/2026-10-14-curated-library-web-results.md`(站长裁定 1–8,尤其裁定 2 紧凑行卡、裁定 5 副本删除正文)。站长已批准本需求(2026-10-15),**没有设计稿闸门**;视觉照本计划 R-C5 与现有 `library.css` `.lib-cat-*`。

**Goal:** 「精选」页签里,已添加的卡片在「已添加 · 去学习」旁边多一个小的次要按钮「取消入库」;点它打开现有的副本删除确认框(正文补一句:这一份上的逐句跟读分数和进度会一起删除);确认后调用**现有** `DELETE /api/library/items/{id}` 删掉副本,卡片回到「添加到我的库」,「我的素材」里不留旧条目;可以再加回来。

**Architecture:** 全部在 `web/src/features/library/` 懒加载块里。把列表页里的删除确认 `AlertDialog` 抽成同目录的 `delete-item-dialog.tsx`(列表页与精选视图共用,文案不分叉);`use-catalog.ts` 加 `remove(catalogId, itemId)`(复用 `library-api.ts::deleteItem`,并发去重、404 视为已删除、只在 `addedItemId` 未变时清空);`catalog-card.tsx` 加按钮;`catalog-view.tsx` 持有确认框状态并通过新的可选属性 `onCopyRemoved(itemId)` 通知 `library-list-page.tsx` 从「我的素材」列表里去掉该条。**服务端不改。**

**Tech Stack:** React 18、react-router、i18next、sonner、Radix AlertDialog(`@renderer/components/ui/alert-dialog`,已在用)、vitest + Testing Library(`~/test/fetch-mock`、`~/test/render`)。

## Global Constraints

- **只碰这些文件**:`web/src/features/library/{delete-item-dialog.tsx(新),use-catalog.ts,use-catalog.test.tsx,catalog-card.tsx,catalog-view.tsx,catalog-view.test.tsx,library-list-page.tsx,library-list-page.test.tsx,library.css,library-css.test.ts,library-lazy.test.ts,locales/en.json,locales/zh-CN.json,CLAUDE.md}`;控制者另改 `docs/changelog/2026-10.json`。
- **并行车道「精选保留视频」**同时在改 `server/app/library/catalog_*`、播放页与 `kind` 处理:本计划**不碰** `server/` 任何文件、`player-page.tsx`、`use-poster.ts`、`item-card.tsx`、`catalog-api.ts`(类型不变)。合并时若 `library.css` / `locales/*.json` 冲突,只是相邻行,手工合并。
- `src/architecture.test.ts` 不改(不新增跨 feature 边;`@renderer/*` 已是允许的依赖);`library-lazy.test.ts` 的 `LAZY_ONLY` 加 `"delete-item-dialog"`。
- 文案:新增 3 个键 `web.library.catalog.{remove,removeLabel,removed}`,改 1 个键 `web.library.catalog.deleteCopyBody`;只在懒加载的 `locales/{en,zh-CN}.json`(`locales.test.ts` 校验中英一致)。
- 视觉:深色优先玻璃,沿用 `library.css` 变量;**不新增 `backdrop-filter`、不新增 `@keyframes`、不新增 transition**(所以 `html.lite` / `prefers-reduced-motion` 两段不用改);按钮 44 px 高;360 px 宽紧凑行卡一行放得下;`library.css` 体积上限 `32_000` 字符不动(现 30 068,本计划约 +600)。
- 标题、条目 id 不进日志;条目 id 只出现在 `DELETE` 的 URL 路径里(现状);无新查询参数。
- 测试只跑定向:`cd web && yarn vitest run src/features/library src/architecture.test.ts`;合并前根目录 `yarn web:typecheck`。不跑全量、E2E、build,不碰容器。
- 提交:`feat(web): …`,一个任务一个提交,结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。新文件用 LF;改旧文件保留原换行(结果文档偏差 10)。

## 服务端核对(已读代码,不改)

- `server/app/routers/library.py::delete_item`:`owned()` 只找当前用户自己的条目(否则 `fail("not_found")` → 404 `{"error":"Not Found"}`);`store.delete_item()` 删 `library_attempts`(逐句跟读分数)、`library_segments`、`library_items`(含 `resume_idx` 进度),吊销票据,`paths.remove_item_files()` 只删 `items/{user}/{item}` 与 `tmp/{item}` 两个目录——**副本的 `media_path` 指向精选库的共享文件,不在这两个目录里,所以共享文件不会被删**。`assessments`(练习记录里的录音与评测)保留(`store.delete_item` docstring)。
- 之后 `catalog_id` 非空时调 `catalog_store.collect_if_orphan()`:只有条目已下架(`retired_at` 非空)**且**没有任何副本时才删精选行与文件;已发布的条目不受影响。
- 测试已覆盖:`server/tests/test_library_catalog_media.py::test_deleting_a_copy_never_deletes_the_shared_file`、`::test_deleting_the_last_copy_of_a_retired_item_collects_it`。
- 再加回来:`catalog_store.add_to_library()` 用 `_copy_of(user, catalog_id)` 判断已有副本;删除后找不到 → 新建一份(新 id,`created: true`);唯一索引 `ux_library_items_user_id_catalog_id` 因旧行已删不冲突。已下架的条目再加 → 404 `Built-in item not found`(现有「已下架」吐司 + 卡片去掉)。
- 404 有多种:`Not Found`(条目不存在)、`Library is disabled`(跟读库被关)、`Built-in library is disabled` 等。**只有 `ApiError.status === 404 && message === "Not Found"` 才算「已经删掉了」**(R-C4)。

## 本计划的裁定

- **R-C1 复用删除接口,服务端不改。** 网页用 `card.addedItemId` 调 `deleteItem(api, itemId)`;不新增 `/catalog/{id}/remove` 之类的接口。
- **R-C2 播放页不加「取消入库」。** 播放页没有删除入口(副本连 ⋯ 都没有,结果文档裁定 6),「我的素材」里的删除已覆盖;加按钮还会碰并行车道正在改的 `player-page.tsx`。
- **R-C3 确认框就是现有那个**(抽成 `DeleteItemDialog`,行为不变):标题「删除这条素材?」、按钮「删除」不变;副本正文 `deleteCopyBody` 改为补一句「逐句跟读分数和进度会一起删除,重新添加后从头开始」。不为「取消入库」另起标题 / 按钮文案(文案键少)。
- **R-C4 并发与失败**:同一张卡的 `remove` 并发只发一次 `DELETE` 并共享同一个 promise;进行中两个按钮都禁用(`aria-busy` 在「取消入库」上);失败 → `toast.error(translateServerError(...))`,卡片保持「已添加」;`404 Not Found` = 已经不在了(别的标签页或「我的素材」里删过)→ 当作成功;成功时只在该卡的 `addedItemId` 仍等于被删的 id 时才清空(防止「删 → 加」交错把新副本 id 抹掉)。不重取目录列表。
- **R-C5 视觉**:窄屏(< 430 px,紧凑行卡)「已添加 · 去学习」(`flex: 1`)与「取消入库」(`flex: none`,44 px 高,透明底 + 0.5 px 发丝边、`ink-2` 13 px 字)同一行;≥ 430 px 两列大卡宽度不够(卡内约 169 px),「取消入库」换到下一行、整行宽、无边框文字按钮(仍 44 px 高)。无图标(省宽度)。无障碍名 `removeLabel` =「取消入库:{{title}}」(以可见文字开头,满足 label-in-name)。
- **R-C6 「我的素材」不留旧条目**:`CatalogView` 新增可选属性 `onCopyRemoved(itemId)`,列表页传 `list.remove`(`useLibraryItems` 在两个页签下都挂着,不重取)。反方向(在「我的素材」删副本后切到「精选」)本来就对:`CatalogView` 每次切过去都重新挂载并取列表。
- **R-C7 成功吐司**用新键 `removed`「已取消入库」/ "Removed from your library",不复用「已删除」。

---

## Task 1: 共用确认框 + `useCatalog.remove` + 文案

**Files:** Create `web/src/features/library/delete-item-dialog.tsx`;Modify `library-list-page.tsx`、`library-list-page.test.tsx`、`use-catalog.ts`、`use-catalog.test.tsx`、`library-lazy.test.ts`、`locales/{en,zh-CN}.json`

**Interfaces:**

```ts
// delete-item-dialog.tsx
export function DeleteItemDialog(props: { open: boolean; copy: boolean; onCancel(): void; onConfirm(): void }): JSX.Element;
// use-catalog.ts —— 返回值新增
remove(catalogId: string, itemId: string): Promise<void>;
removing: ReadonlySet<string>; // catalogId
```

- [ ] **Step 1: 失败测试** `use-catalog.test.tsx` 追加(文件顶部 import 不变;新增一个 setup):

```tsx
function setupAdded(del: Handler, add: Handler = () => json({ item: itemRaw({ id: "i2", source: "catalog" }), created: true })) {
  const mock = createFetchMock({
    "GET /api/library/catalog": () => json({ items: [card("c1", { added_item_id: "i1" }), card("c2")] }),
    "DELETE /api/library/items/i1": del,
    "POST /api/library/catalog/c1/add": add,
  });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const wrapper = ({ children }: { children: ReactNode }) => <TestProviders api={api}>{children}</TestProviders>;
  return { mock, ...renderHook(() => useCatalog(true), { wrapper }) };
}
const deletes = (mock: { calls: { method: string }[] }) => mock.calls.filter((c) => c.method === "DELETE").length;

describe("useCatalog.remove (cancel an add)", () => {
  it("deletes the copy and puts the card back to not added, without reloading the list", async () => {
    const { result, mock } = setupAdded(() => json({ deleted: true }));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    await act(async () => { await result.current.remove("c1", "i1"); });
    expect(result.current.items[0].addedItemId).toBeNull();
    expect(result.current.removing.size).toBe(0);
    expect(deletes(mock)).toBe(1);
    expect(mock.calls.filter((c) => c.method === "GET")).toHaveLength(1);
  });

  it("a double tap sends one DELETE and shares the promise", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const { result, mock } = setupAdded(async () => { await gate; return json({ deleted: true }); });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    let a!: Promise<unknown>;
    let b!: Promise<unknown>;
    act(() => { a = result.current.remove("c1", "i1"); b = result.current.remove("c1", "i1"); });
    expect(a).toBe(b);
    expect(result.current.removing.has("c1")).toBe(true);
    await act(async () => { release(); await a; });
    expect(deletes(mock)).toBe(1);
  });

  it("404 Not Found means it is already gone: treated as success", async () => {
    const { result } = setupAdded(() => json({ error: "Not Found" }, 404));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    await act(async () => { await result.current.remove("c1", "i1"); });
    expect(result.current.items[0].addedItemId).toBeNull();
  });

  it("other 404s (library switched off) and 500s rethrow and keep the card added", async () => {
    for (const reply of [() => json({ error: "Library is disabled" }, 404), () => json({ error: "boom" }, 500)]) {
      const { result, unmount } = setupAdded(reply);
      await waitFor(() => expect(result.current.items).toHaveLength(2));
      let caught: unknown;
      await act(async () => { await result.current.remove("c1", "i1").catch((e: unknown) => { caught = e; }); });
      expect(caught).toBeInstanceOf(ApiError);
      expect(result.current.items[0].addedItemId).toBe("i1");
      expect(result.current.removing.size).toBe(0);
      unmount();
    }
  });

  it("add → cancel → add again makes a fresh copy", async () => {
    const { result, mock } = setupAdded(() => json({ deleted: true }));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    await act(async () => { await result.current.remove("c1", "i1"); });
    await act(async () => { await result.current.add("c1"); });
    expect(result.current.items[0].addedItemId).toBe("i2");
    expect(mock.calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(deletes(mock)).toBe(1);
  });
});
```

- [ ] **Step 2: 实现** `use-catalog.ts`(`import { deleteItem } from "./library-api";`;保持现有 `add` 不变):

```ts
/** 404 只有 `Not Found`(条目不在了)才算已删除;`Library is disabled` 等其他 404 照抛(R-C4)。 */
const isGone = (err: unknown) => err instanceof ApiError && err.status === 404 && err.message === "Not Found";
const without = (id: string) => (s: ReadonlySet<string>) => {
  const next = new Set(s);
  next.delete(id);
  return next;
};

// useCatalog 内:
const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
const removals = useRef(new Map<string, Promise<void>>());

const remove = useCallback((catalogId: string, itemId: string): Promise<void> => {
  const running = removals.current.get(catalogId);
  if (running) return running;
  setRemoving((s) => new Set(s).add(catalogId));
  const run = deleteItem(api, itemId)
    .catch((err: unknown) => { if (!isGone(err)) throw err; })
    .then(() => {
      setState((s) => ({
        ...s,
        items: s.items.map((c) => (c.id === catalogId && c.addedItemId === itemId ? { ...c, addedItemId: null } : c)),
      }));
    })
    .finally(() => {
      removals.current.delete(catalogId);
      setRemoving(without(catalogId));
    });
  removals.current.set(catalogId, run);
  return run;
}, [api]);

return { ...state, adding, add, removing, remove, reload: () => reload() };
```

  (`add` 的 `finally` 里那段删 Set 的代码可以顺手改用 `without(id)`,行为不变。)更新文件头注释:加一句「`remove`:取消入库(R-C4)」。
- [ ] **Step 3: 抽确认框** `delete-item-dialog.tsx`(把 `library-list-page.tsx` 第 263–278 行的 `AlertDialog` 原样搬过去,不改类名与结构):

```tsx
import { useTranslation } from "react-i18next";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@renderer/components/ui/alert-dialog";
import "./locales";

/** 删除确认:「我的素材」里的删除与「精选」卡片的「取消入库」共用(R-C3);副本(`copy`)用自己的正文 `deleteCopyBody`。 */
export function DeleteItemDialog({ open, copy, onCancel, onConfirm }: {
  open: boolean; copy: boolean; onCancel(): void; onConfirm(): void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <AlertDialogContent className="rounded-sheet border-[0.5px] border-hair bg-surface">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-title font-semibold text-ink">{t("web.library.confirmDelete.title")}</AlertDialogTitle>
          <AlertDialogDescription className="text-sub text-ink-2">
            {t(copy ? "web.library.catalog.deleteCopyBody" : "web.library.confirmDelete.body")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 rounded-button">{t("web.common.cancel")}</AlertDialogCancel>
          <AlertDialogAction className="h-11 rounded-button" onClick={onConfirm}>{t("web.library.confirmDelete.confirm")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

  `library-list-page.tsx`:原位置换成 `<DeleteItemDialog open={!!pendingDelete} copy={pendingDelete?.source === "catalog"} onCancel={() => setPendingDelete(null)} onConfirm={() => void confirmDelete()} />`(其余两个 `AlertDialog` 仍用,import 保留)。
- [ ] **Step 4: 文案**(只改 `catalog` 对象):

| 键 | zh-CN | en |
|---|---|---|
| `deleteCopyBody`(改) | 只会从你的跟读库里移除这一份,精选库里的原条目不受影响,之后可以重新添加。这一份上的逐句跟读分数和进度也会一起删除,重新添加后从头开始;你的录音和评测仍保留在练习记录里。 | This only removes your copy. The featured original stays and you can add it again later. Sentence scores and progress on this copy are deleted too, so adding it again starts fresh; your recordings and assessments stay in your practice history. |
| `remove`(新) | 取消入库 | Remove |
| `removeLabel`(新) | 取消入库:{{title}} | Remove from my library: {{title}} |
| `removed`(新) | 已取消入库 | Removed from your library |

  (两种语言的 `removeLabel` 都以可见文字开头(「取消入库」/ "Remove"),满足 label-in-name。)
- [ ] **Step 5:** `library-list-page.test.tsx` 现有用例「deleting a featured copy explains…」追加一行 `expect(within(dialog).getByText(/逐句跟读分数和进度也会一起删除/)).toBeInTheDocument();`;「deletes after confirmation」不改(验证抽出来后行为不变)。`library-lazy.test.ts` 的 `LAZY_ONLY` 加 `"delete-item-dialog"`。
- [ ] **Step 6:** `cd web && yarn vitest run src/features/library/use-catalog.test.tsx src/features/library/library-list-page.test.tsx src/features/library/library-lazy.test.ts src/features/library/locales.test.ts` → 绿。**提交** `feat(web): shared delete dialog and catalog remove in useCatalog`。

---

## Task 2: 卡片上的「取消入库」+ 视图接线 + 样式

**Files:** Modify `catalog-card.tsx`、`catalog-view.tsx`、`catalog-view.test.tsx`、`library-list-page.tsx`、`library-list-page.test.tsx`、`library.css`、`library-css.test.ts`、`web/src/features/library/CLAUDE.md`

**Interfaces:**

```ts
// catalog-card.tsx —— 新增两个可选属性(不传就不显示按钮)
removing?: boolean; onRemove?(card: CatalogCard): void;
// catalog-view.tsx
export function CatalogView(props?: { onCopyRemoved?(itemId: string): void }): JSX.Element;
```

- [ ] **Step 1: 失败测试** `catalog-view.test.tsx` 追加(沿用文件里的 `card()`、`vi.mock("sonner")`、`beforeEach` 的 `setUiLanguage("zh-CN")`;`toast.success` 也要在 `beforeEach` 里 `mockClear`):

```tsx
function renderAdded(del: Handler, onCopyRemoved = vi.fn()) {
  const mock = createFetchMock({
    "GET /api/library/catalog": () => json({ items: [card({ added_item_id: "i1" }), card({ id: "c2", title: "Other" })] }),
    "DELETE /api/library/items/i1": del,
  });
  renderWithProviders(<CatalogView onCopyRemoved={onCopyRemoved} />,
    { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/library?tab=catalog", path: "/library" });
  return { mock, onCopyRemoved };
}

describe("CatalogView · 取消入库", () => {
  it("only added cards show it, labelled with the title", async () => {
    renderAdded(() => json({ deleted: true }));
    const c1 = await screen.findByTestId("catalog-card-c1");
    expect(within(c1).getByRole("button", { name: "取消入库:VOA: Coffee" })).toHaveTextContent("取消入库");
    expect(within(screen.getByTestId("catalog-card-c2")).queryByRole("button", { name: /取消入库/ })).toBeNull();
  });

  it("confirming deletes the copy, puts the card back, toasts and tells the page", async () => {
    const { mock, onCopyRemoved } = renderAdded(() => json({ deleted: true }));
    fireEvent.click(await screen.findByRole("button", { name: "取消入库:VOA: Coffee" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/逐句跟读分数和进度也会一起删除/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    const c1 = screen.getByTestId("catalog-card-c1");
    await waitFor(() => expect(within(c1).getByRole("button", { name: "添加到我的库" })).toBeInTheDocument());
    expect(mock.calls.filter((c) => c.method === "DELETE").map((c) => c.url.pathname)).toEqual(["/api/library/items/i1"]);
    expect(toast.success).toHaveBeenCalledWith("已取消入库");
    expect(onCopyRemoved).toHaveBeenCalledWith("i1");
    expect(screen.getByTestId("location")).toHaveTextContent("/library");
  });

  it("cancelling the dialog sends nothing", async () => {
    const { mock } = renderAdded(() => json({ deleted: true }));
    fireEvent.click(await screen.findByRole("button", { name: "取消入库:VOA: Coffee" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mock.calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("a failed delete toasts and keeps the card added", async () => {
    const { onCopyRemoved } = renderAdded(() => json({ error: "boom" }, 500));
    fireEvent.click(await screen.findByRole("button", { name: "取消入库:VOA: Coffee" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "删除" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(within(screen.getByTestId("catalog-card-c1")).getByRole("button", { name: /已添加.*去学习/ })).toBeEnabled();
    expect(onCopyRemoved).not.toHaveBeenCalled();
  });

  it("while removing, both buttons are disabled and 取消入库 is busy", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    renderAdded(async () => { await gate; return json({ deleted: true }); });
    fireEvent.click(await screen.findByRole("button", { name: "取消入库:VOA: Coffee" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "删除" }));
    const undo = await screen.findByRole("button", { name: "取消入库:VOA: Coffee" });
    await waitFor(() => expect(undo).toHaveAttribute("aria-busy", "true"));
    expect(undo).toBeDisabled();
    expect(screen.getByRole("button", { name: /已添加.*去学习/ })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "添加到我的库" })).toHaveLength(2));
  });
});
```

  (`renderWithProviders` 渲染的 `location` 探针与 `toast` mock 的写法以该文件现有用例为准;若 Radix 关闭动画让 `queryByRole("alertdialog")` 晚一拍,保持 `waitFor`。)
- [ ] **Step 2: 失败测试** `library-list-page.test.tsx`:把文件顶部 `./catalog-view` 的 mock 改成会调用 `onCopyRemoved` 的桩(原有断言只用 `catalog-view-stub`,不受影响):

```tsx
vi.mock("./catalog-view", () => ({
  CatalogView: ({ onCopyRemoved }: { onCopyRemoved?: (id: string) => void }) => (
    <div>
      <p data-testid="catalog-view-stub">catalog view</p>
      <button type="button" onClick={() => onCopyRemoved?.("i1")}>stub-remove</button>
    </div>
  ),
}));
```

  在 `describe` 里 `ON` 定义之后追加:

```tsx
  it("a copy removed in 精选 is gone from 我的素材 without a reload (R-C6)", async () => {
    const mock = render([itemRaw({ source: "catalog", catalog_id: "c1", library_bytes: 0 })], {}, ON, "/library?tab=catalog");
    await screen.findByTestId("catalog-view-stub");
    await waitFor(() => expect(mock.calls.some((c) => c.method === "GET" && c.url.pathname === "/api/library/items")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "stub-remove" }));
    fireEvent.click(screen.getByTestId("library-tab-mine"));
    await waitFor(() => expect(screen.queryByTestId("catalog-view-stub")).toBeNull());
    expect(screen.queryByTestId("library-item-i1")).toBeNull();
  });
```

  (`render` 返回 fetch mock、列表接口路径以该测试文件 `render` 助手的真实实现为准;若列表为空时显示空状态,断言不变。)
- [ ] **Step 3: 失败测试** `library-css.test.ts` 在「styles the featured section …」之后追加:

```ts
  it("the 取消入库 control is a 44px ghost button beside 去学习, wraps under it in two columns, no blur / keyframes / transition (R-C5)", () => {
    const section = sectionAfter(css, "精选(.lib-cat-*");
    const undo = blockOf(css, /^\.lib-cat-undo\s*\{/m);
    expect(undo).toContain("height: 44px;");
    expect(undo).toContain("flex: none;");
    expect(undo).not.toContain("transition");
    expect(undo).not.toContain("backdrop-filter");
    expect(blockOf(css, /^\.lib-cat-act\s*\{/m)).toContain("display: flex;");
    const wide = blockOf(section, /@media \(min-width: 430px\)\s*\{/);
    expect(wide).toMatch(/\.lib-cat-act\s*\{[^}]*flex-wrap: wrap;/);
    expect(wide).toMatch(/\.lib-cat-undo\s*\{[^}]*flex-basis: 100%;/);
    expect(section).not.toContain("@keyframes");
  });
```

- [ ] **Step 4: 实现。**
  - `catalog-card.tsx`:签名加 `removing = false, onRemove`;`addedItemId` 分支改成(「已添加 · 去学习」按钮只加 `disabled={removing}`,其余不变):

```tsx
<>
  <button type="button" disabled={removing} className="lib-cat-open lib-cat-btn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpen(card)}>
    {/* 原有内容不变 */}
  </button>
  {onRemove ? (
    <button type="button" className="lib-cat-undo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      disabled={removing} aria-busy={removing || undefined}
      aria-label={t("web.library.catalog.removeLabel", { title: card.title })} onClick={() => onRemove(card)}>
      {t("web.library.catalog.remove")}
    </button>
  ) : null}
</>
```

    文件头注释补一句:「已添加时旁边有次要按钮『取消入库』(计划 2026-10-15-catalog-cancel-add,R-C5)」。
  - `catalog-view.tsx`:

```tsx
export function CatalogView({ onCopyRemoved }: { onCopyRemoved?(itemId: string): void } = {}) {
  // …现有代码…
  const [pendingRemove, setPendingRemove] = useState<CatalogCard | null>(null);
  const confirmRemove = () => {
    const target = pendingRemove;
    setPendingRemove(null);
    const itemId = target?.addedItemId;
    if (!target || !itemId) return;
    catalog.remove(target.id, itemId).then(() => {
      toast.success(t("web.library.catalog.removed"));
      onCopyRemoved?.(itemId);
    }, (err: unknown) => {
      toast.error(translateServerError(t, err, LIBRARY_SERVER_ERRORS));
    });
  };
  // 卡片:<CatalogItemCard … removing={catalog.removing.has(card.id)} onRemove={setPendingRemove} />
  // 列表 </ul> 之后:
  // <DeleteItemDialog open={!!pendingRemove} copy onCancel={() => setPendingRemove(null)} onConfirm={confirmRemove} />
}
```

    外层 `return` 用 `<>…</>` 或放进现有 `div[data-testid=catalog-view]` 里(Radix 走 portal,位置无关)。
  - `library-list-page.tsx`:`<CatalogView onCopyRemoved={list.remove} />`(`list.remove` 是稳定的 `useCallback`)。副本 `library_bytes = 0`,不需要 `loadConfig()`。
  - `library.css`(精选分节内,`.lib-cat-btn` 之后;媒体查询内各加一行):

```css
.lib-cat-act { grid-area: act; display: flex; gap: 8px; }
.lib-cat-act .lib-cat-btn { flex: 1; min-width: 0; }
/* 取消入库(计划 2026-10-15,R-C5):次要的文字按钮,44px 触控;窄屏与「去学习」同行,两列时换到下一行 */
.lib-cat-undo {
  flex: none;
  height: 44px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 500;
  color: rgb(var(--ink-2));
  background: transparent;
  border: 0.5px solid var(--lib-hair);
}
.lib-cat-undo:disabled, .lib-cat-open:disabled { opacity: 0.6; cursor: default; }
/* @media (min-width: 430px) 内:*/
  .lib-cat-act { padding: 4px 12px 12px; flex-wrap: wrap; gap: 0; }
  .lib-cat-undo { flex-basis: 100%; border-color: transparent; }
```

    (`.lib-cat-act { grid-area: act; }` 原规则改成上面那行,不重复声明;媒体查询里原有的 `.lib-cat-act { padding: … }` 合并为一行。)宽度核对:360 px 屏 → 卡内约 304 px;「取消入库」约 77 px + 间距 8 px,留给「✓ 已添加 · 去学习 ›」约 219 px(内容约 150 px)。≥ 430 px 两列 → 卡内约 169 px,放不下两者,所以换行。
  - `web/src/features/library/CLAUDE.md` Pitfalls 里「A copy's media is shared…」一条末尾补:「精选卡片的『取消入库』(`useCatalog.remove`)用同一个 `DELETE /items/{id}` 与同一个 `DeleteItemDialog`;只有 `404 Not Found` 当作已删除;成功后 `onCopyRemoved` 让列表页去掉该条。播放页没有这个入口。」
- [ ] **Step 5:** `cd web && yarn vitest run src/features/library src/architecture.test.ts` → 绿;根目录 `yarn web:typecheck` → 绿。**提交** `feat(web): cancel adding a featured item from its card`。

---

## Task 3(仅控制者): 更新日志草稿

**Files:** `docs/changelog/2026-10.json`(数组按日期升序,追加到末尾)

- [ ] 合并、部署并由用户确认后,追加一条(每条 zh / en ≤ 200 字符;`server/tests/test_changelog_import.py` 校验):

```json
{
  "entry_date": "2026-10-15",
  "version": null,
  "title_zh": "精选素材可以取消入库",
  "title_en": "Undo adding a featured item",
  "items": [
    {
      "tag": "library",
      "zh": "「精选」里已添加的素材旁多了「取消入库」:确认后从你的跟读库移除这一份(这一份的跟读分数和进度一并删除),之后可以随时再加回来。",
      "en": "Featured items you added now have a 「Remove」 button: after you confirm, your copy leaves your library (its scores and progress go with it), and you can add it again any time."
    }
  ]
}
```

- [ ] 提醒用户运行 `docker compose exec server python -m app.admin.changelog_import`(镜像需重建后才带上新文件,重建只在用户要求时做),然后在管理端「更新日志」发布。**提交** `docs(changelog): cancel adding a featured item`。

## 未验证

- 真实服务端上走完「添加 → 取消入库 → 再添加」:只在假 fetch 上验证;服务端没有「删副本后再添加」的专门测试(读代码确认 `_copy_of` + 唯一索引不冲突)。建议以后补 `server/tests/test_library_catalog_api.py` 一条(不在本计划,避免与并行车道冲突)。
- 「添加」接口带限流(`limited_user`):反复「加 → 取消 → 加」可能触发 429,网页走现有错误吐司;没有实测阈值。
- 360 / 390 / 430 px 实际版面与「取消入库」在两列卡里换行后的高度(同一行的邻卡会被撑高)只做了 CSS 结构测试,jsdom 无布局;真机(iOS Safari / 安卓 Chrome)未看。
- Radix 确认框关闭动画期间正文会从副本文案闪回普通文案(列表页现状同样存在),未处理。
- `en` 的 "Remove" 与「取消入库」语气差异、`removeLabel` 在读屏里的念法未经真人读屏验证。
