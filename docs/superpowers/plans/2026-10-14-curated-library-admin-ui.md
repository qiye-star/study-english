# 精选库 · 管理端界面(车道 AU)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **前置:** 读 `2026-10-14-curated-library-INDEX.md`(§6 形状冻结)与 spec §9、§11。开发可在 SC 合并后开始(全部测试 mock `features/catalog/api.ts`,计划 P-7 的约定);**合并必须在 SI 合并之后**。

**Goal:** 管理后台新增「精选库」页(`/admin/catalog`,仅桌面):状态说明条(开关、识别 / 翻译 / 链接可用性、共享分析今日用量、**备份提示**)、条目表(标题、级别、标签、状态与进度、时长、句数、已译、副本数、发布开关)、「按链接导入」与「上传文件」两个对话框(上传可附字幕,8 MiB 分片、进度条、可取消)、详情抽屉(试听、句子与译文、逐句编辑、元数据编辑、补全译文、重试 / 取消、删除 / 强制删除);处理中的条目每 3 秒轮询。

**Architecture:** 新 feature 目录 `admin/src/features/catalog/`(`api.ts` 做 snake → camel、`upload.ts` 分片上传、`strings.ts` 全部中文文案、`catalog-page.tsx`、`import-dialog.tsx`、`upload-dialog.tsx`、`catalog-detail.tsx`、`catalog-icon.tsx`、`index.ts`、`CLAUDE.md`)。HTTP 客户端只会发 JSON,本车道给 `RequestOptions` 加 `form?: FormData`(不设 `Content-Type`,浏览器自带 boundary;仍带 CSRF)。试听用 `<audio src="/api/admin/library/catalog/{id}/media">`(同源 Cookie,`Range` 由服务端支持)。不引入新依赖;沿用现有 `Dialog`、`ConfirmDialog`(输入确认 + 理由)、`RoleGate`、`DataTable` 与 Tailwind 色义(蓝 = 主操作 / 进度,绿 = 已发布,琥珀 = 退役 / 部分未译,红 = 失败 / 危险)。

**Tech Stack:** React 18、react-router 7、Tailwind 3、vitest + Testing Library(jsdom)。

## Global Constraints

- **文件归属(INDEX §9):** `admin/src/api/client.ts`(+ `client.test.ts`)、`admin/src/features/catalog/*`、`admin/src/components/layout.tsx`、`admin/src/app.tsx`、`admin/README.md`(表格一行)、`admin/src/features/library/api.ts`(只改 `source` 联合类型)。
- **不导入其他 feature**(`camel` 复制一份,与 `features/library` 相同做法);`layout.tsx` 只导入 `features/catalog/strings.ts` 与 `catalog-icon.tsx`;`app.tsx` 只从 `index.ts` 导入。
- 测试 mock `features/catalog/api.ts` 或 stub `fetch`,不打网络;角色用 `session.setSession`(核对 `admin/src/api/session.ts` 的真实函数名)。
- 每个任务只跑 `cd admin && yarn vitest run <列出的文件>`;合并前 `yarn workspace admin typecheck`。不跑 E2E、不 build 镜像。
- 文案:界面全中文;服务端错误串(英文)经 `S.errors` 映射,映射不到的显示原文。
- 提交:`feat(admin): …`,一个任务一个提交,结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## 本计划的裁定

- **R-AU1 路由 `/catalog`**(不是 `/library/catalog`):`navItemFor` 以最长前缀匹配,放在 `/library` 下会被「跟读库」高亮抢走;导航放「内容」组、`/library` 之后,`min: "viewer"`。
- **R-AU2 上传在对话框里完成**(不像网页那样关掉弹层后台继续):管理端只桌面、单人操作,对话框显示分片进度与取消;关闭对话框 = 中止上传(已建的条目留在 `uploading`,表格里可「取消」)。失败的分片自动重试 2 次。
- **R-AU3 轮询**:表格里有 `uploading` / `queued` / `processing` 的条目时每 3 秒刷新列表;页面不可见时停(`document.visibilityState`)。
- **R-AU4 权限显示**:写操作按钮包在 `RoleGate min="operator"`;「强制删除」`min="superadmin"`(服务端要求二次验证,客户端收到 `Step-up required` 时已有的 `StepUpDialog` 自动弹出并重放)。
- **R-AU5 删除的说明文案**:删除确认框先显示 `refs`:0 →「将删除音频、封面与全部句子」;> 0 →「有 N 个学习者已加入:将下架并退役,等最后一个副本被删除后自动清理文件」。强制删除框写明「会同时删除这 N 个学习者的副本(学习记录中的评测保留)」。
- **R-AU6 备份提示常驻**在状态条下方(spec §11 固定文案),不可关闭。

---

## Task 0: 前置核对(只读)

- [ ] 读 `admin/src/api/client.ts`(`RequestOptions`、`once` 的 body 组装)、`api/session.ts`、`components/{dialog,confirm-dialog,role-gate,data-table,layout}.tsx`、`features/library/{library-page.tsx,library-page.test.tsx,api.ts,strings.ts,library-icon.tsx}`、`app.tsx`。确认 `ConfirmDialog` 的 `requireTyping` / `reasonRequired`、`RoleGate` 的 `min`、`setSession` 的签名;不一致以真实代码为准改本计划的代码,不改裁定。

---

## Task 1: 客户端支持 `FormData`(誊写)

**Files:** Modify `admin/src/api/client.ts`、`admin/src/api/client.test.ts`

- [ ] **Step 1: 失败测试**(追加到 `client.test.ts`,沿用该文件已有的 `createClient` 测试写法):

```ts
it("sends FormData without a JSON content type but with the CSRF header", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const req = createClient({
    getCsrf: () => "csrf-1",
    onUnauthorized: () => {},
    onStepUp: async () => false,
    fetchImpl: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch,
  });
  const form = new FormData();
  form.append("chunk", new Blob([new Uint8Array([1, 2, 3])]), "blob");
  await req("/api/admin/library/catalog/uploads/x/chunks/0", { method: "PUT", form });
  const headers = calls[0].init.headers as Record<string, string>;
  expect(calls[0].init.body).toBe(form);
  expect(headers["Content-Type"]).toBeUndefined();
  expect(headers["X-Admin-CSRF"]).toBe("csrf-1");
});
```

- [ ] **Step 2:** `cd admin && yarn vitest run src/api/client.test.ts` → 失败。
- [ ] **Step 3: 实现。** `RequestOptions` 加 `/** multipart(分片上传):浏览器自己写 Content-Type 与 boundary */ form?: FormData;`;`once` 里 `const method = opts.method ?? (opts.json !== undefined || opts.form !== undefined ? "POST" : "GET");`,`body: opts.form ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined),`(`Content-Type` 只在 `opts.json !== undefined` 时设,保持不变)。
- [ ] **Step 4:** 测试绿;`yarn workspace admin typecheck` 绿。**提交** `feat(admin): FormData bodies in the API client`。

---

## Task 2: `features/catalog` 的接口、文案与分片上传(誊写为主)

**Files:** Create `admin/src/features/catalog/{api.ts,api.test.ts,strings.ts,upload.ts,upload.test.ts}`

- [ ] **Step 1: 类型与接口** `api.ts`(形状逐字对 INDEX §6):

```ts
/** 精选库管理接口(spec 2026-10-14-curated-library §9;服务端 routers/admin_catalog.py)。wire 是 snake_case,这里转 camelCase。 */
import { request } from "../../api/client";

export type CatalogStatus = "uploading" | "queued" | "processing" | "ready" | "failed" | "canceled";
export const ACTIVE: CatalogStatus[] = ["uploading", "queued", "processing"];

export interface CatalogRow {
  id: string; title: string; level: string | null; tags: string[]; licenseNote: string | null;
  source: "upload" | "link"; sourceHost: string | null; status: CatalogStatus; stage: string | null; progress: number;
  errorKind: string | null; durationMs: number | null; segCount: number; translated: number; subSource: string | null;
  lowConfidence: boolean; mediaBytes: number; hasPoster: boolean; mediaMissing: boolean; aiLang: string;
  published: boolean; publishedAt: string | null; retired: boolean; refs: number; uploadReceived: number;
  uploadTotal: number; createdAt: string; updatedAt: string;
}
export interface CatalogSegment { idx: number; startMs: number; endMs: number; text: string; zh: string | null; zhLang: string | null; hasAnalysis: boolean; flags: string[] }
export interface CatalogState {
  enabled: boolean; available: boolean; asr: boolean; ai: boolean; link: boolean; proxyConfigured: boolean;
  aiDaily: number; aiToday: number; languages: string[]; levels: string[]; chunkBytes: number; maxUploadMb: number; formats: string[];
}
export interface CatalogMeta { title?: string; level?: string | null; tags?: string[]; licenseNote?: string | null }
export interface NewMeta extends CatalogMeta { aiLang?: string }
export interface UploadState { catalogId: string; status: CatalogStatus; uploadReceived: number; uploadTotal: number; chunkBytes: number }

const camelKey = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
export function camel<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((v) => camel(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[camelKey(k)] = camel(v);
    return out as T;
  }
  return value as T;
}
const snakeMeta = (m: NewMeta) => {
  const out: Record<string, unknown> = {};
  if (m.title !== undefined) out.title = m.title;
  if (m.level !== undefined) out.level = m.level;
  if (m.tags !== undefined) out.tags = m.tags;
  if (m.licenseNote !== undefined) out.license_note = m.licenseNote;
  if (m.aiLang !== undefined) out.ai_lang = m.aiLang;
  return out;
};

const BASE = "/api/admin/library/catalog";
const enc = encodeURIComponent;
export const deletePhrase = (id: string) => `DELETE ${id.slice(0, 8)}`;
export const purgePhrase = (id: string) => `PURGE ${id.slice(0, 8)}`;
export const mediaUrl = (id: string) => `${BASE}/${enc(id)}/media`;
export const posterUrl = (id: string) => `${BASE}/${enc(id)}/poster`;

export const fetchCatalog = async () => camel<{ items: CatalogRow[]; state: CatalogState }>(await request<unknown>(BASE));
export const fetchCatalogItem = async (id: string) =>
  camel<{ item: CatalogRow; segments: CatalogSegment[] }>(await request<unknown>(`${BASE}/${enc(id)}`));
const itemOf = async (p: Promise<unknown>) => camel<{ item: CatalogRow }>(await p).item;
export const importLink = (url: string, meta: NewMeta) => itemOf(request(`${BASE}/imports`, { json: { url, ...snakeMeta(meta) } }));
export const startUpload = async (filename: string, size: number, meta: NewMeta) =>
  camel<{ catalogId: string; chunkBytes: number }>(await request(`${BASE}/uploads`, { json: { filename, size, ...snakeMeta(meta) } }));
export const putChunk = async (id: string, n: number, blob: Blob, signal?: AbortSignal) => {
  const form = new FormData();
  form.append("chunk", blob, "blob");
  return camel<UploadState>(await request(`${BASE}/uploads/${enc(id)}/chunks/${n}`, { method: "PUT", form, signal }));
};
export const putSubtitles = async (id: string, file: Blob, name: string) => {
  const form = new FormData();
  form.append("file", file, name);
  return camel<{ cueCount: number }>(await request(`${BASE}/uploads/${enc(id)}/subtitles`, { method: "PUT", form }));
};
export const completeUpload = (id: string) => itemOf(request(`${BASE}/uploads/${enc(id)}/complete`, { method: "POST", json: {} }));
export const patchMeta = (id: string, meta: CatalogMeta) => itemOf(request(`${BASE}/${enc(id)}`, { method: "PATCH", json: snakeMeta(meta) }));
const action = (name: string) => (id: string) => itemOf(request(`${BASE}/${enc(id)}/${name}`, { method: "POST", json: {} }));
export const publish = action("publish");
export const unpublish = action("unpublish");
export const retry = action("retry");
export const cancel = action("cancel");
export const translateMissing = action("translate");
export const patchSegment = async (id: string, idx: number, patch: { text?: string; zh?: string; startMs?: number; endMs?: number }) => {
  const json: Record<string, unknown> = {};
  if (patch.text !== undefined) json.text = patch.text;
  if (patch.zh !== undefined) json.zh = patch.zh;
  if (patch.startMs !== undefined) json.start_ms = patch.startMs;
  if (patch.endMs !== undefined) json.end_ms = patch.endMs;
  return camel<{ segment: CatalogSegment }>(await request(`${BASE}/${enc(id)}/segments/${idx}`, { method: "PATCH", json })).segment;
};
export const deleteItem = (id: string, reason: string, confirm: string) =>
  request<{ id: string; outcome: "deleted" | "retired"; refs: number }>(`${BASE}/${enc(id)}/delete`, { method: "POST", json: { reason, confirm } });
export const purgeItem = async (id: string, reason: string, confirm: string) =>
  camel<{ id: string; copiesDeleted: number; users: number }>(await request(`${BASE}/${enc(id)}/purge`, { method: "POST", json: { reason, confirm } }));
```

- [ ] **Step 2: 分片上传** `upload.ts`:

```ts
/** 分片上传(R-AU2):逐片串行,失败的分片重试 2 次;abort 立即停止。返回最后的上传状态。 */
import { putChunk, type UploadState } from "./api";

export interface UploadProgress { sent: number; total: number }

export async function uploadChunks(
  id: string, file: Blob, chunkBytes: number, onProgress: (p: UploadProgress) => void, signal?: AbortSignal,
  send: typeof putChunk = putChunk,
): Promise<UploadState | null> {
  const count = Math.max(1, Math.ceil(file.size / chunkBytes));
  let last: UploadState | null = null;
  for (let n = 0; n < count; n++) {
    const blob = file.slice(n * chunkBytes, Math.min(file.size, (n + 1) * chunkBytes));
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      try {
        last = await send(id, n, blob, signal);
        break;
      } catch (e) {
        if ((e instanceof DOMException && e.name === "AbortError") || attempt >= 2) throw e;
      }
    }
    onProgress({ sent: Math.min(file.size, (n + 1) * chunkBytes), total: file.size });
  }
  return last;
}
```

- [ ] **Step 3: 文案** `strings.ts`(全部中文;`S.title` 给导航用):

```ts
/** features/catalog 的界面文案(zh-CN);`components/layout.tsx` 的导航项用 `S.title`。 */
export const S = {
  title: "精选库",
  intro: "内置素材:导入一次,所有学习者都能加入自己的跟读库。学习者只在跟读评测时扣额度。",
  backup: "数据库备份不包含音频与封面文件。服务器数据卷丢失或只恢复了数据库时,精选条目会显示「媒体缺失」,需要重新导入。",
  state: {
    enabled: (on: boolean) => (on ? "学习端「精选」已开启" : "学习端「精选」未开启(去「设置 → 跟读库」打开)"),
    unavailable: "跟读库不可用(总开关关闭或服务器缺少 ffmpeg),现在不能导入",
    asr: (on: boolean) => (on ? "没有字幕时会自动识别(系统付费)" : "自动识别不可用:没有字幕的素材会导入失败"),
    ai: (on: boolean) => (on ? "导入时自动生成逐句译文(系统付费)" : "译文不可用:导入后没有译文"),
    link: (on: boolean, proxy: boolean) => (on ? `链接导入可用 · 代理${proxy ? "已配置" : "未配置"}` : "链接导入不可用(没有 yt-dlp)"),
    shared: (today: string, cap: string) => `共享句子分析:今日 ${today} / ${cap} 句`,
  },
  actions: { importLink: "按链接导入", upload: "上传文件", refresh: "刷新" },
  cols: { title: "标题", level: "级别", tags: "标签", status: "状态", duration: "时长", sentences: "句数", translated: "已译", refs: "副本", published: "发布" },
  status: { uploading: "上传中", queued: "排队中", processing: "处理中", ready: "就绪", failed: "失败", canceled: "已取消" },
  stage: { fetch: "下载", probe: "检查", transcode: "转码", subtitles: "字幕", transcribe: "识别", segment: "分句", translate: "翻译" } as Record<string, string>,
  badges: { retired: "已退役", mediaMissing: "媒体缺失", partial: "部分未译", lowConfidence: "句界可能不准" },
  form: {
    url: "视频页面链接", urlHint: "可直接粘贴分享文本;服务器在大陆时需要配置代理才能访问 YouTube。",
    file: "音频或视频文件", subs: "字幕(可选,SRT / VTT)", title: "标题", titleHint: "留空则用页面标题或文件名",
    level: "级别", noLevel: "不设", tags: "话题标签(逗号分隔,最多 5 个)", license: "来源与许可说明",
    licenseHint: "例如:VOA Learning English · Public domain;TED · 讲者 · CC BY-NC-ND 4.0", aiLang: "译文语言",
    submit: "开始导入", uploading: (p: string) => `上传中 ${p}`, cancel: "取消",
  },
  detail: {
    listen: "试听", sentences: "句子", edit: "编辑", save: "保存", meta: "元数据", translate: "补全译文",
    retry: "重试", cancelJob: "取消处理", publish: "发布", unpublish: "下架", del: "删除", purge: "强制删除",
    editLocked: "已发布的条目不能改句子:先下架,改好再发布。已加入的学习者副本不会随之更新。",
  },
  confirm: {
    deleteTitle: "删除精选条目",
    deleteBody: (refs: number) =>
      refs === 0 ? "将删除音频、封面与全部句子,无法恢复。" : `有 ${refs} 个学习者已加入:将下架并退役,等最后一个副本被删除后自动清理文件。`,
    purgeTitle: "强制删除(含学习者副本)",
    purgeBody: (refs: number) => `会同时删除这 ${refs} 个学习者的副本(学习记录中的评测保留)。需要超级管理员与二次验证。`,
  },
  errors: {
    "Invalid link": "链接无效", "Link import is unavailable": "链接导入不可用(服务器没有 yt-dlp)",
    "Media tools are not installed": "服务器缺少 ffmpeg", "Unsupported file type": "不支持的文件类型",
    "File is too large": "文件太大", "Item is not ready": "条目还没处理完", "Item is published": "已发布的条目不能这样修改",
    "Media is missing": "媒体文件缺失,请重新导入", "Item is retired": "条目已退役", "Item is not running": "条目没有在处理",
    "Item has not failed": "条目没有失败", "AI is unavailable": "译文服务不可用", "Invalid sentence times": "句子时间不合法",
    "Invalid sentence text": "句子文字不合法", "Invalid level": "级别不合法", "Invalid tags": "标签不合法(最多 5 个,每个 ≤ 16 字,不能含逗号)",
    "Invalid license_note": "许可说明太长", "Unsupported language": "不支持的译文语言", "Catalog item not found": "条目不存在",
  } as Record<string, string>,
  errorKinds: { no_subtitles: "没有字幕且自动识别不可用:补传字幕后会自动重试", upstream: "上游服务失败", blocked: "站点拒绝了服务器(试试配置代理,或本机下载后上传)", drm: "受 DRM 保护,无法导入" } as Record<string, string>,
};

export const errorText = (message: string) => S.errors[message] ?? message;
```

- [ ] **Step 4: 测试** `api.test.ts` 与 `upload.test.ts`:

```ts
// api.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { camel, deletePhrase, fetchCatalog, importLink, patchMeta, purgePhrase, putChunk } from "./api";

const ID = "3f2a9c1e-0000-4000-8000-000000000001";
function stub(body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("catalog admin api", () => {
  it("phrases match the server", () => {
    expect(deletePhrase(ID)).toBe("DELETE 3f2a9c1e");
    expect(purgePhrase(ID)).toBe("PURGE 3f2a9c1e");
  });
  it("reads the list and state in camelCase", async () => {
    stub({ items: [{ id: ID, license_note: "VOA", media_missing: false, upload_total: 0 }], state: { proxy_configured: true, ai_today: 3 } });
    const out = await fetchCatalog();
    expect(out.items[0]).toMatchObject({ id: ID, licenseNote: "VOA", mediaMissing: false });
    expect(out.state).toMatchObject({ proxyConfigured: true, aiToday: 3 });
  });
  it("sends snake_case metadata and only the keys given", async () => {
    const calls = stub({ item: { id: ID } });
    await importLink("https://example.invalid/a", { licenseNote: "TED", aiLang: "zh-CN", level: null });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ url: "https://example.invalid/a", license_note: "TED", ai_lang: "zh-CN", level: null });
    await patchMeta(ID, { tags: ["a"] });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ tags: ["a"] });
    expect(calls[1].init.method).toBe("PATCH");
  });
  it("puts chunks as multipart", async () => {
    const calls = stub({ catalog_id: ID, status: "uploading", upload_received: 3, upload_total: 3, chunk_bytes: 8 });
    const state = await putChunk(ID, 0, new Blob([new Uint8Array([1, 2, 3])]));
    expect(calls[0].init.body).toBeInstanceOf(FormData);
    expect(state.uploadReceived).toBe(3);
  });
  it("camel keeps arrays", () => expect(camel({ a_b: [{ c_d: 1 }] })).toEqual({ aB: [{ cD: 1 }] }));
});

// upload.test.ts
import { describe, expect, it, vi } from "vitest";
import { uploadChunks } from "./upload";

describe("uploadChunks", () => {
  it("sends every chunk in order and reports progress", async () => {
    const send = vi.fn(async (_id: string, n: number) => ({ catalogId: "x", status: "uploading" as const, uploadReceived: (n + 1) * 4, uploadTotal: 10, chunkBytes: 4 }));
    const seen: number[] = [];
    await uploadChunks("x", new Blob([new Uint8Array(10)]), 4, (p) => seen.push(p.sent), undefined, send);
    expect(send.mock.calls.map((c) => c[1])).toEqual([0, 1, 2]);
    expect(seen).toEqual([4, 8, 10]);
  });
  it("retries a chunk twice, then gives up", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("net")).mockRejectedValueOnce(new Error("net"))
      .mockResolvedValue({ catalogId: "x", status: "uploading", uploadReceived: 4, uploadTotal: 4, chunkBytes: 4 });
    await uploadChunks("x", new Blob([new Uint8Array(4)]), 4, () => {}, undefined, send);
    expect(send).toHaveBeenCalledTimes(3);
    const fail = vi.fn().mockRejectedValue(new Error("net"));
    await expect(uploadChunks("x", new Blob([new Uint8Array(4)]), 4, () => {}, undefined, fail)).rejects.toThrow("net");
    expect(fail).toHaveBeenCalledTimes(3);
  });
  it("stops when aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(uploadChunks("x", new Blob([new Uint8Array(4)]), 4, () => {}, ctrl.signal, vi.fn())).rejects.toThrow("aborted");
  });
});
```

- [ ] **Step 5:** `cd admin && yarn vitest run src/features/catalog` → 绿。**提交** `feat(admin): catalog API client, strings and chunked upload`。

---

## Task 3: 页面:状态条、表格、导入与上传对话框

**Files:** Create `admin/src/features/catalog/{catalog-page.tsx,catalog-page.test.tsx,import-dialog.tsx,upload-dialog.tsx,catalog-icon.tsx,index.ts}`

- [ ] **Step 1: 失败测试** `catalog-page.test.tsx`(mock `./api`;角色经 `session.setSession`,参照 `features/library/library-page.test.tsx` 的写法):

```tsx
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import * as api from "./api";
import { CatalogPage } from "./catalog-page";
import { S } from "./strings";

/** 与 features/library/library-page.test.tsx 的 signIn 相同 */
function signIn(role: session.Role) {
  session.setSession({
    username: role, role, csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null,
    totpEnabled: false, safeMode: false, maintenanceMode: "off",
  });
}
afterEach(() => {
  cleanup();
  session.resetSessionForTests();
});

vi.mock("./api", async (orig) => ({ ...(await orig<typeof import("./api")>()), fetchCatalog: vi.fn(), importLink: vi.fn(), publish: vi.fn(), unpublish: vi.fn() }));

const ROW: api.CatalogRow = {
  id: "3f2a9c1e-0000-4000-8000-000000000001", title: "Talk one", level: "B1", tags: ["news"], licenseNote: "VOA",
  source: "upload", sourceHost: null, status: "ready", stage: null, progress: 100, errorKind: null, durationMs: 61000,
  segCount: 12, translated: 12, subSource: "uploaded", lowConfidence: false, mediaBytes: 500000, hasPoster: true,
  mediaMissing: false, aiLang: "zh-CN", published: false, publishedAt: null, retired: false, refs: 0,
  uploadReceived: 0, uploadTotal: 0, createdAt: "2026-10-14T00:00:00Z", updatedAt: "2026-10-14T00:00:00Z",
};
const STATE: api.CatalogState = {
  enabled: true, available: true, asr: true, ai: true, link: true, proxyConfigured: false, aiDaily: 300, aiToday: 4,
  languages: ["zh-CN", "ja-JP"], levels: ["A1", "A2", "B1", "B2", "C1", "C2"], chunkBytes: 8388608, maxUploadMb: 500, formats: ["mp4", "mp3"],
};

function setup(role: session.Role = "operator", rows = [ROW]) {
  signIn(role);
  vi.mocked(api.fetchCatalog).mockResolvedValue({ items: rows, state: STATE });
  return render(<MemoryRouter><CatalogPage /></MemoryRouter>);
}

describe("CatalogPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the state, the backup note and the rows", async () => {
    setup();
    expect(await screen.findByText("Talk one")).toBeInTheDocument();
    expect(screen.getByText(S.backup)).toBeInTheDocument();
    expect(screen.getByText(S.state.shared("4", "300"))).toBeInTheDocument();
  });

  it("publishes a ready row from the toggle", async () => {
    vi.mocked(api.publish).mockResolvedValue({ ...ROW, published: true });
    setup();
    const row = (await screen.findByText("Talk one")).closest("tr")!;
    await userEvent.click(within(row).getByRole("switch", { name: S.cols.published }));
    await waitFor(() => expect(api.publish).toHaveBeenCalledWith(ROW.id));
  });

  it("imports a link with metadata", async () => {
    vi.mocked(api.importLink).mockResolvedValue({ ...ROW, status: "queued" });
    setup();
    await userEvent.click(await screen.findByRole("button", { name: S.actions.importLink }));
    await userEvent.type(screen.getByLabelText(S.form.url), "https://learningenglish.voanews.com/a/1.html");
    await userEvent.type(screen.getByLabelText(S.form.license), "VOA");
    await userEvent.click(screen.getByRole("button", { name: S.form.submit }));
    await waitFor(() => expect(api.importLink).toHaveBeenCalledWith("https://learningenglish.voanews.com/a/1.html",
      expect.objectContaining({ licenseNote: "VOA", aiLang: "zh-CN" })));
  });

  it("hides write actions from viewers", async () => {
    setup("viewer");
    await screen.findByText("Talk one");
    expect(screen.queryByRole("button", { name: S.actions.importLink })).toBeNull();
  });

  it("shows failed rows with a readable reason and stage text while processing", async () => {
    setup("operator", [{ ...ROW, id: "a".repeat(8) + ROW.id.slice(8), status: "failed", errorKind: "no_subtitles" },
                       { ...ROW, title: "Busy", status: "processing", stage: "translate", progress: 90 }]);
    expect(await screen.findByText(S.errorKinds.no_subtitles)).toBeInTheDocument();
    expect(screen.getByText(/翻译/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2:** 跑 → 失败。
- [ ] **Step 3: 实现**(要点,具体样式照抄 `features/library/library-page.tsx` 的卡片 / 表格 / 状态条类名):
  - `catalog-page.tsx`:`useAsync(fetchCatalog, [tick])`;R-AU3 的轮询 `useEffect`(有 `ACTIVE` 状态的行时 `setInterval(3000)`,`visibilitychange` 时停 / 续);状态条五行(`S.state.*`)+ 备份提示(R-AU6,`role="note"`);表格列 = `S.cols`,`status` 列显示 `S.status[status]`、处理中加 `S.stage[stage] · progress%` 与蓝色进度条,失败显示 `S.errorKinds[errorKind] ?? errorKind`;徽标 `retired` / `mediaMissing` / `partial`(`translated < segCount`)/ `lowConfidence`(琥珀);发布列是 `role="switch"`、`aria-label={S.cols.published}`、`aria-checked={published}`,只有 `ready ∧ !retired ∧ !mediaMissing` 可点,点了调 `publish` / `unpublish` 并刷新;点标题打开详情抽屉(Task 4)。顶部按钮 `S.actions.*` 包在 `RoleGate min="operator"`。
  - `import-dialog.tsx`:`Dialog` + 表单(`label htmlFor` 绑定每个字段):链接、标题、级别(`<select>`:不设 + `state.levels`)、标签(逗号分隔 → `split(",").map(trim).filter(Boolean)`)、许可说明、译文语言(`state.languages`,默认 `zh-CN`);提交 `importLink(url, {title: title.trim() || undefined, level: level || null, tags, licenseNote: license.trim() || null, aiLang})`;错误用 `errorText(e.message)` 显示在框内;成功关闭并刷新。`state.link` 为假时提交按钮禁用并显示 `S.state.link(false, …)`。
  - `upload-dialog.tsx`:同样的元数据字段 + 文件(`accept` = `state.formats.map(f => "." + f).join(",")`)+ 可选字幕(`.srt,.vtt`);提交:`startUpload(file.name, file.size, meta)` → `uploadChunks(id, file, chunkBytes, setProgress, ctrl.signal)` → 有字幕则 `putSubtitles` → `completeUpload`;进度条 `S.form.uploading(pct)`;取消 = `ctrl.abort()` 并关闭(R-AU2)。文件大于 `state.maxUploadMb` 时客户端先拦。
  - `catalog-icon.tsx`:复制 `library-icon.tsx` 的 SVG 外框,图形换成一颗星(内联 SVG,`aria-hidden`)。
  - `index.ts`:`export * from "./api"; export { CatalogPage } from "./catalog-page";`。
- [ ] **Step 4:** `yarn vitest run src/features/catalog` → 绿。**提交** `feat(admin): catalog page with import and upload dialogs`。

---

## Task 4: 详情抽屉:试听、句子编辑、元数据、动作、删除

**Files:** Create `admin/src/features/catalog/{catalog-detail.tsx,catalog-detail.test.tsx}`;Modify `catalog-page.tsx`(打开抽屉)

- [ ] **Step 1: 失败测试** `catalog-detail.test.tsx`:

```tsx
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import * as api from "./api";
import { CatalogDetail } from "./catalog-detail";
import { S } from "./strings";

beforeEach(() => session.setSession({
  username: "op", role: "operator", csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null,
  totpEnabled: false, safeMode: false, maintenanceMode: "off",
}));
afterEach(() => {
  cleanup();
  session.resetSessionForTests();
});

vi.mock("./api", async (orig) => ({ ...(await orig<typeof import("./api")>()), fetchCatalogItem: vi.fn(), patchSegment: vi.fn(), deleteItem: vi.fn(), translateMissing: vi.fn() }));

const ID = "3f2a9c1e-0000-4000-8000-000000000001";
const ITEM = { id: ID, title: "Talk", level: "B1", tags: [], licenseNote: null, source: "upload", sourceHost: null, status: "ready",
  stage: null, progress: 100, errorKind: null, durationMs: 6000, segCount: 2, translated: 1, subSource: "uploaded", lowConfidence: false,
  mediaBytes: 1, hasPoster: false, mediaMissing: false, aiLang: "zh-CN", published: false, publishedAt: null, retired: false, refs: 2,
  uploadReceived: 0, uploadTotal: 0, createdAt: "", updatedAt: "" } as api.CatalogRow;
const SEGS: api.CatalogSegment[] = [
  { idx: 0, startMs: 500, endMs: 3000, text: "Hello there.", zh: "你好。", zhLang: "zh-CN", hasAnalysis: false, flags: [] },
  { idx: 1, startMs: 3200, endMs: 6000, text: "How are you?", zh: null, zhLang: null, hasAnalysis: false, flags: [] },
];

describe("CatalogDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.fetchCatalogItem).mockResolvedValue({ item: ITEM, segments: SEGS });
  });

  it("plays the media through the admin route and lists sentences with translations", async () => {
    render(<CatalogDetail id={ID} onClose={() => {}} onChanged={() => {}} />);
    expect(await screen.findByText("Hello there.")).toBeInTheDocument();
    expect(screen.getByText("你好。")).toBeInTheDocument();
    expect(document.querySelector("audio")?.getAttribute("src")).toBe(api.mediaUrl(ID));
  });

  it("edits a sentence while unpublished", async () => {
    vi.mocked(api.patchSegment).mockResolvedValue({ ...SEGS[1], zh: "你好吗?", zhLang: "zh-CN" });
    render(<CatalogDetail id={ID} onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText("How are you?");
    await userEvent.click(screen.getAllByRole("button", { name: S.detail.edit })[1]);
    await userEvent.type(screen.getByLabelText("译文"), "你好吗?");
    await userEvent.click(screen.getByRole("button", { name: S.detail.save }));
    await waitFor(() => expect(api.patchSegment).toHaveBeenCalledWith(ID, 1, expect.objectContaining({ zh: "你好吗?" })));
  });

  it("locks sentence edits once published", async () => {
    vi.mocked(api.fetchCatalogItem).mockResolvedValue({ item: { ...ITEM, published: true }, segments: SEGS });
    render(<CatalogDetail id={ID} onClose={() => {}} onChanged={() => {}} />);
    expect(await screen.findByText(S.detail.editLocked)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: S.detail.edit })).toBeNull();
  });

  it("explains retirement before deleting an item that learners added", async () => {
    vi.mocked(api.deleteItem).mockResolvedValue({ id: ID, outcome: "retired", refs: 2 });
    render(<CatalogDetail id={ID} onClose={() => {}} onChanged={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: S.detail.del }));
    expect(screen.getByText(S.confirm.deleteBody(2))).toBeInTheDocument();
  });

  it("offers translate-missing when some sentences lack a translation", async () => {
    vi.mocked(api.translateMissing).mockResolvedValue({ ...ITEM, status: "queued" });
    render(<CatalogDetail id={ID} onClose={() => {}} onChanged={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: S.detail.translate }));
    await waitFor(() => expect(api.translateMissing).toHaveBeenCalledWith(ID));
  });
});
```

- [ ] **Step 2:** 跑 → 失败。
- [ ] **Step 3: 实现** `catalog-detail.tsx`(`Dialog width={880}` 作为抽屉):
  - 头部:标题、徽标、`<audio controls preload="none" src={mediaUrl(id)} />`(`mediaMissing` 时不渲染,改显示 `S.badges.mediaMissing`);有封面时 `<img src={posterUrl(id)} alt="" />`。
  - 元数据表单(operator):标题、级别、标签、许可说明 → `patchMeta`(只发改了的键)。
  - 动作行(operator):`failed` → `retry`;`ACTIVE` → `cancel`;`ready ∧ !published ∧ translated < segCount` → `translateMissing`(译文服务不可用时服务端回 503,框内显示 `errorText`)(按钮文案 `S.detail.translate`);发布 / 下架;删除(`ConfirmDialog`:`requireTyping={deletePhrase(id)}`、`reasonRequired`、`body={S.confirm.deleteBody(item.refs)}`、`danger`);强制删除包在 `RoleGate min="superadmin"`(`requireTyping={purgePhrase(id)}`、`body={S.confirm.purgeBody(item.refs)}`)。删除后 `onChanged()` + `onClose()`;退役时不关闭,刷新显示「已退役」。
  - 句子表:序号、`mm:ss.s` 起止、原文、译文(`zhLang !== item.aiLang` 时视为没有)、`flags` 小徽标;`published` 时整表只读并显示 `S.detail.editLocked`;否则每行「编辑」展开:原文 `textarea`、译文 `textarea`(`aria-label="译文"`)、起止毫秒两个数字框 → `patchSegment`(只发改了的键);服务端错误 `errorText`。
- [ ] **Step 4:** `catalog-page.tsx` 点标题 `setOpenId(row.id)` 渲染 `<CatalogDetail id onClose onChanged={refresh} />`。
- [ ] **Step 5:** `yarn vitest run src/features/catalog` → 绿。**提交** `feat(admin): catalog detail drawer (listen, edit, publish, delete)`。

---

## Task 5: 导航、路由、文档(誊写)

**Files:** Modify `admin/src/components/layout.tsx`、`admin/src/components/layout.test.tsx`(若它枚举导航项)、`admin/src/app.tsx`、`admin/README.md`、`admin/src/features/library/api.ts`;Create `admin/src/features/catalog/CLAUDE.md`

- [ ] **Step 1:** `layout.tsx`:`import { CatalogIcon } from "../features/catalog/catalog-icon"; import { S as CATALOG_STRINGS } from "../features/catalog/strings";`;「内容」组在 `/library` 之后加 `{ to: "/catalog", label: CATALOG_STRINGS.title, icon: CatalogIcon, min: "viewer" }`(R-AU1)。若 `layout.test.tsx` 断言导航项列表,同步加一项。
- [ ] **Step 2:** `app.tsx`:`import { CatalogPage } from "./features/catalog";`,在 `library` 路由旁加 `<Route path="catalog" element={<CatalogPage />} />`。
- [ ] **Step 3:** `features/library/api.ts`:`LibraryRow.source` 改为 `"upload" | "link" | "catalog"`(用户的精选副本也会出现在「跟读库」页,大小为 0)。
- [ ] **Step 4:** `features/catalog/CLAUDE.md`:

```markdown
# admin/src/features/catalog/

## What lives here
管理后台「精选库」页 `/admin/catalog`(spec `docs/superpowers/specs/2026-10-14-curated-library-design.md` §11;plan
`docs/superpowers/plans/2026-10-14-curated-library-admin-ui.md`;桌面 ≥ 1024px):`api.ts`(`/api/admin/library/catalog*`,snake → camel,
`deletePhrase` / `purgePhrase` / `mediaUrl`)、`upload.ts`(8 MiB 分片串行、每片重试 2 次、可中止)、`strings.ts`(zh-CN,含备份提示;
导航用 `S.title`)、`catalog-page.tsx`(状态条、表格、发布开关、3 秒轮询)、`import-dialog.tsx`、`upload-dialog.tsx`、`catalog-detail.tsx`
(试听、句子编辑、元数据、动作、删除 / 强制删除)、`catalog-icon.tsx`、`index.ts`。

## Allowed dependencies
`../../api/*`、`../../components/*`、`../../hooks/*`、`../../lib/*`。不导入其他 feature(`camel` 复制了一份)。

## Test
`cd admin && yarn vitest run src/features/catalog`(mock `./api`)。

## Pitfalls
- 目录是系统内容:这里可以显示标题与句子(spec R5);但不要把它们写进 `console` 或错误上报。
- 已发布的条目不能改句子(服务端 409 `Item is published`);改元数据不受限。已加入的学习者副本不随目录更新。
- 删除:无副本即删;有副本则退役(`retired`)。强制删除会删掉学习者的副本,只给超级管理员,服务端要求二次验证。
- 试听直接用 `<audio src>`(同源 Cookie);不要改成 blob 下载整段。
```

- [ ] **Step 5:** `admin/README.md` 的功能表加一行 `| catalog | 精选库:按链接 / 上传导入内置素材、审核与发布、逐句编辑、删除(退役)/ 强制删除 | viewer / operator / superadmin |`。
- [ ] **Step 6:** `yarn vitest run src/features/catalog src/components/layout.test.tsx src/features/library` → 绿;`yarn workspace admin typecheck` → 绿。**提交** `feat(admin): catalog navigation and route`。

## 未验证

真实浏览器上传数百 MB 文件的耗时与稳定性;`<audio>` 在各桌面浏览器对 m4a 的 Range 播放;管理端与 SI 的联调(合并后手动走一遍:导入 → 处理 → 审核 → 发布 → 学习端可见 → 删除 / 退役)。
