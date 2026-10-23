/**
 * 架构约束(计划 2026-10-08 Addendum Task 9):扫描 src 下每个模块的 import,守住分层。
 *
 * 1. audio/、api/、lib/、components/ 是底层:不引入 features/、pages/、layout/、auth/、settings/(React 业务代码)。
 * 2. features/<x> 之外的代码只能经由 features/<x>/index.ts 引入它(`~/features/<x>`),不得触达内部文件。
 * 3. pages/ 只组合 features 与共享层:不直接引入 audio/;除 app.tsx / main.tsx 外无人引入 pages/。
 * 5. 组合层(spec 2026-10-11-learning-links §8.4):plugins/ 只被 main.tsx 导入(test/setup.ts 可导入 plugins/core);
 *    features/<x>/register*.ts(x) 只被 plugins/ 导入,且不导入别的 feature;feature→feature 的导入边冻结在基线。
 * 4. enjoy/ 只能经由 src/shims 触达(`@/…` 或指向 enjoy/ 的相对路径只许出现在 shims/);
 *    `@renderer/…` 别名(vite.config.ts / tsconfig.json)例外。
 *
 * 规则 1–3 只检查产品代码;测试文件可以为 vi.mock 引入其他 feature 的内部模块。规则 4 也检查测试文件。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { POINT_NAMES } from "~/lib/extension-points";

const srcRoot = path.dirname(fileURLToPath(import.meta.url));
const enjoyRoot = path.resolve(srcRoot, "..", "..", "enjoy");
const posix = (p: string) => p.split(path.sep).join("/");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts") ? [full] : [];
  });
}

const IMPORT_PATTERNS = [
  /(?:^|\n)\s*(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']/g, // import x from "…" / export { x } from "…"
  /(?:^|\n)\s*import\s*["']([^"']+)["']/g, // import "…"
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, // import("…")
];

function importsOf(source: string): string[] {
  const specs = new Set<string>();
  for (const re of IMPORT_PATTERNS) for (const m of source.matchAll(re)) specs.add(m[1]);
  return [...specs];
}

type Target = { kind: "src"; rel: string } | { kind: "enjoy" } | { kind: "renderer-alias" } | { kind: "package" };

/** 把 import 说明符解析成目标位置(不触盘,只按别名与相对路径计算)。 */
function resolveSpec(spec: string, fromFile: string): Target {
  const clean = spec.split("?")[0];
  if (clean.startsWith("@renderer/")) return { kind: "renderer-alias" };
  if (clean === "@/renderer/components/ui") return { kind: "renderer-alias" };
  if (clean.startsWith("@/")) return { kind: "enjoy" };
  let abs: string;
  if (clean.startsWith("~/")) abs = path.join(srcRoot, clean.slice(2));
  else if (clean.startsWith(".")) abs = path.resolve(path.dirname(fromFile), clean);
  else return { kind: "package" };
  const fromEnjoy = path.relative(enjoyRoot, abs);
  if (!fromEnjoy.startsWith("..") && !path.isAbsolute(fromEnjoy)) return { kind: "enjoy" };
  const rel = posix(path.relative(srcRoot, abs));
  return rel.startsWith("..") ? { kind: "package" } : { kind: "src", rel };
}

const LOW_LAYERS = ["audio", "api", "lib", "components"];
const UPPER_LAYERS = ["features", "pages", "layout", "auth", "settings"];
const topOf = (rel: string) => rel.split("/")[0];
const featureOf = (rel: string) => (rel.startsWith("features/") ? rel.split("/")[1] : null);
const isTest = (rel: string) => /\.test\.tsx?$/.test(rel);
const CROSS_FEATURE_BASELINE = new Set([
  "chat->agents", "chat->grammar", "chat->lookup", "chat->practice", "chat->realtime", "library->practice", "lookup->practice",
  "practice->chat", "practice->rank", "practice->wordbook", "progress->practice",
  "rank->chat", "rank->practice", "realtime->chat", "rooms->agents", "rooms->chat",
  "vocabulary->chat", "wordbook->chat", "wordbook->rank", "dubbing->library", "dubbing->practice",
]); // L1 删去了五条 ->vocabulary / vocabulary->lookup 边(四处改用 <WordActions> 插槽);新增任何一条即失败
// L5 W2(plan 2026-10-21-l5-dubbing R17):dubbing->library —— 配音只经 library 的懒加载工具包 loadDubbingKit() 与 DubbingKit 类型(只做再导出);library 不导入 dubbing。
// A4(agents-web R-W4):chat->agents —— 对话页用 agents 的过程胶囊、角色切换与回合客户端(spec 2026-10-12-agents §3.4、§9.3);
// agents 是产品本身(不受 LINKS_ENABLED 控制),不能挂在扩展点上;agents 不导入任何 feature,所以没有桶循环。
// A5(agents-rooms W3,INDEX X13):rooms->agents —— 房间设置里的「智能体」区用 agents 的 PersonaPicker 选角色,消息列表用 ProcessCapsule 显示只给提问者的过程
// (spec 2026-10-12-agents §9.2);两者都是 lazy-parts 的懒包装,是产品本身而不是学习联动,不能挂在扩展点上;agents 不导入任何 feature,没有桶循环。
// W2(video-import-web-shadow R-SH06):library->practice —— 跟读库的跟读用 practice 的评测 API、savePracticeItem 与 AssessmentScores 类型
// (spec 2026-10-13-video-import §2.2、§11.4),与 chat->practice 同理;practice 不导入 library,没有桶循环。别的 library 边一律不加。
/** `to` 已去掉扩展名;`rel` 带扩展名。 */
const isRegister = (rel: string) => /^features\/[^/]+\/register(-[a-z-]+)?(\.tsx?)?$/.test(rel);

/** 返回一个文件违反的规则(空数组表示合规)。 */
function violationsOf(rel: string, source: string): string[] {
  const file = path.join(srcRoot, rel);
  const out: string[] = [];
  for (const spec of importsOf(source)) {
    const target = resolveSpec(spec, file);
    if (target.kind === "enjoy" && topOf(rel) !== "shims") {
      out.push(`${rel}: "${spec}" reaches enjoy/ outside src/shims`);
    }
    if (target.kind !== "src" || isTest(rel)) continue;
    const to = target.rel.replace(/\.(ts|tsx)$/, "");
    if (LOW_LAYERS.includes(topOf(rel)) && UPPER_LAYERS.includes(topOf(to))) {
      out.push(`${rel}: "${spec}" — ${topOf(rel)}/ must not import ${topOf(to)}/`);
    }
    const feature = featureOf(to);
    if (feature && featureOf(rel) !== feature && to !== `features/${feature}` && to !== `features/${feature}/index` &&
        !(rel.startsWith("plugins/") && isRegister(to))) {
      out.push(`${rel}: "${spec}" — import features/${feature} only via its index ("~/features/${feature}")`);
    }
    if (topOf(rel) === "pages" && topOf(to) === "audio") {
      out.push(`${rel}: "${spec}" — pages/ compose features; audio belongs inside a feature`);
    }
    if (topOf(to) === "pages" && topOf(rel) !== "pages" && rel !== "app.tsx" && rel !== "main.tsx") {
      out.push(`${rel}: "${spec}" — only app.tsx/main.tsx compose pages/`);
    }
    if (topOf(to) === "plugins" && rel !== "main.tsx" && !rel.startsWith("plugins/")) {
      if (!(rel === "test/setup.ts" && to === "plugins/core")) out.push(`${rel}: "${spec}" — only main.tsx composes plugins/`);
    }
    if (isRegister(to) && !rel.startsWith("plugins/")) {
      out.push(`${rel}: "${spec}" — features/*/register* is imported only by plugins/`);
    }
    if (isRegister(rel) && feature && featureOf(rel) !== feature) {
      out.push(`${rel}: "${spec}" — a register file must not import another feature`);
    }
    if (feature && featureOf(rel) && featureOf(rel) !== feature && !CROSS_FEATURE_BASELINE.has(`${featureOf(rel)}->${feature}`)) {
      out.push(`${rel}: "${spec}" — new cross-feature edge ${featureOf(rel)}->${feature}; use an extension point`);
    }
  }
  return out;
}

const files = walk(srcRoot).map((f) => posix(path.relative(srcRoot, f)));
// 整棵源码树在收集阶段读一次(不计入用例超时):用例只做正则检查。原先每个扫描用例在自己的 5 秒里同步读几百个文件,
// 全量并行运行时会超时(L1-3 曾给它们 30 秒;Z1 改成在收集阶段读)。
const sources = new Map(files.map((rel) => [rel, readFileSync(path.join(srcRoot, rel), "utf8")]));
const sourceOf = (rel: string): string => sources.get(rel) ?? "";

describe("web architecture boundaries", () => {
  it("finds the source tree", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain("app.tsx");
  });

  it("every feature exposes an index.ts public surface", () => {
    const features = readdirSync(path.join(srcRoot, "features")).filter((n) =>
      statSync(path.join(srcRoot, "features", n)).isDirectory(),
    );
    expect(features.length).toBeGreaterThan(0);
    for (const f of features) expect(files, `features/${f}/index.ts`).toContain(`features/${f}/index.ts`);
  });

  it("no module crosses a layer boundary", () => {
    const violations = files.flatMap((rel) => violationsOf(rel, sourceOf(rel)));
    expect(violations).toEqual([]);
  });

  it("the scanner catches each kind of forbidden import", () => {
    expect(violationsOf("lib/x.ts", 'import { a } from "~/features/chat";')).toHaveLength(1);
    expect(violationsOf("audio/x.ts", 'import { a } from "../layout/app-shell";')).toHaveLength(1);
    expect(violationsOf("features/chat/x.ts", 'import { a } from "~/features/practice/assessment-api";')).toHaveLength(1);
    expect(violationsOf("features/chat/x.ts", 'import {\n  a,\n} from "../practice/assessment-api";')).toHaveLength(1);
    expect(violationsOf("features/chat/x.ts", 'import { a } from "~/features/practice";')).toEqual([]);
    expect(violationsOf("features/chat/x.ts", 'import { a } from "./tts";')).toEqual([]);
    expect(violationsOf("pages/x.tsx", 'import { a } from "~/audio/recorder";')).toHaveLength(1);
    expect(violationsOf("layout/x.tsx", 'import { a } from "~/pages/me-page";')).toHaveLength(1);
    expect(violationsOf("features/lookup/x.ts", 'import { L } from "@/constants";')).toHaveLength(1);
    expect(violationsOf("lib/x.ts", 'const m = await import("../../../enjoy/src/constants");')).toHaveLength(1);
    expect(violationsOf("shims/x.ts", 'export { L } from "@/constants";')).toEqual([]);
    expect(violationsOf("features/chat/x.tsx", 'import { Button } from "@renderer/components/ui/button";')).toEqual([]);
    expect(violationsOf("features/chat/x.test.ts", 'vi.mock("~/features/grammar/grammar-api");\nimport { a } from "~/features/grammar/grammar-api";')).toEqual([]);
  });

  it("guards plugins, register files and the cross-feature baseline", () => {
    expect(violationsOf("features/chat/x.tsx", 'import "~/plugins";')).toHaveLength(1);
    expect(violationsOf("lib/x.ts", 'import "~/plugins/core";')).toHaveLength(1);
    expect(violationsOf("main.tsx", 'import "./plugins";')).toEqual([]);
    expect(violationsOf("test/setup.ts", 'import "~/plugins/core";')).toEqual([]);
    expect(violationsOf("test/setup.ts", 'import "~/plugins";')).toHaveLength(1);
    expect(violationsOf("plugins/core.ts", 'import "~/features/vocabulary/register";')).toEqual([]);
    expect(violationsOf("plugins/x/index.ts", 'import "~/features/wordbook/register-daily-tasks";')).toEqual([]);
    expect(violationsOf("plugins/x/index.ts", 'import { a } from "~/features/wordbook/word-card";')).toHaveLength(1);
    expect(violationsOf("features/chat/x.tsx", 'import { ProcessCapsule } from "~/features/agents";')).toEqual([]);
    expect(violationsOf("features/agents/x.tsx", 'import { VoicePicker } from "~/features/chat";')).toHaveLength(1);
    expect(violationsOf("pages/x.tsx", 'import "~/features/vocabulary/register";')).toHaveLength(2);
    expect(violationsOf("features/wordbook/register-daily-tasks.tsx", 'import { goPractice } from "~/features/practice";')).toHaveLength(2);
    expect(violationsOf("features/progress/x.tsx", 'import { RankCard } from "~/features/rank";')).toHaveLength(1);
    expect(violationsOf("features/practice/x.tsx", 'import { RankCard } from "~/features/rank";')).toEqual([]);
    expect(violationsOf("features/library/x.tsx", 'import { savePracticeItem } from "~/features/practice";')).toEqual([]);
    expect(violationsOf("features/library/x.tsx", 'import { useTtsPlayer } from "~/features/chat";')).toHaveLength(1);
    expect(violationsOf("features/library/x.tsx", 'import { LookupLayer } from "~/features/lookup";')).toHaveLength(1);
  });

  it("AddVocabularyButton is used only inside features/vocabulary", () => {
    const users = files.filter((f) => !isTest(f) && !f.startsWith("features/vocabulary/")
      && sourceOf(f).includes("AddVocabularyButton"));
    expect(users).toEqual([]);
  });

  it("the cross-feature baseline lists only edges that still exist", () => {
    const edges = new Set<string>();
    for (const rel of files.filter((f) => !isTest(f) && featureOf(f))) {
      for (const spec of importsOf(sourceOf(rel))) {
        const target = resolveSpec(spec, path.join(srcRoot, rel));
        const to = target.kind === "src" ? featureOf(target.rel) : null;
        if (to && to !== featureOf(rel)) edges.add(`${featureOf(rel)}->${to}`);
      }
    }
    expect([...CROSS_FEATURE_BASELINE].filter((e) => !edges.has(e))).toEqual([]);
    expect(CROSS_FEATURE_BASELINE.size).toBe(21);
  });

  it("every extension point is rendered by product code and every contribution names a real point", () => {
    const product = files.filter((f) => !isTest(f)).map(sourceOf).join("\n");
    for (const p of POINT_NAMES) {
      const rendered = product.includes(`point="${p}"`) || (p === "wordActions" && product.includes("<WordActions"));
      expect(rendered, `point ${p} is rendered somewhere`).toBe(true);
    }
    for (const m of product.matchAll(/point:\s*"([A-Za-z]+)"/g)) expect(POINT_NAMES).toContain(m[1]);
  });

  it("agents/memory is self-contained inside features/agents (plan A2 R-M12; INDEX X11 allows locales)", () => {
    const targets = (rel: string) => importsOf(sourceOf(rel))
      .map((spec) => resolveSpec(spec, path.join(srcRoot, rel)))
      .flatMap((t) => (t.kind === "src" ? [t.rel.replace(/\.(ts|tsx)$/, "")] : []));
    const product = files.filter((f) => !isTest(f) && f.startsWith("features/agents/"));
    const memory = product.filter((f) => f.startsWith("features/agents/memory/"));
    const shell = product.filter((f) => !f.startsWith("features/agents/memory/"));
    // memory 只可借用 agents 的文案注册入口(registerAgentsLocales)。
    const leaks = memory.flatMap((rel) => targets(rel)
      .filter((to) => to.startsWith("features/agents/") && !to.startsWith("features/agents/memory/") && to !== "features/agents/locales")
      .map((to) => `${rel} -> ${to}`));
    const reach = shell.flatMap((rel) => targets(rel)
      .filter((to) => to.startsWith("features/agents/memory/") && to !== "features/agents/memory/lazy"
        && to !== "features/agents/memory/memory-api")
      .map((to) => `${rel} -> ${to}`));
    expect(memory.length).toBeGreaterThan(0);
    expect(leaks).toEqual([]);
    expect(reach).toEqual([]);
  });

  it("agents tutor UI stays lazy: the rest of agents reaches ./tutor/* only through import() (plan A3 W7)", () => {
    const shell = files.filter((f) => !isTest(f) && f.startsWith("features/agents/") && !f.startsWith("features/agents/tutor/"));
    const statics = shell.flatMap((rel) => [...sourceOf(rel).matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?\sfrom\s*["'](\.\/tutor\/[^"']+)["']/g)]
      .map((m) => `${rel} -> ${m[1]}`));
    expect(statics).toEqual([]);
    const parts = sourceOf("features/agents/chat-parts.tsx");
    expect(parts).toContain('import("./tutor/tutor-start-sheet")');
    expect(parts).toContain('import("./tutor/tutor-bar-panel")');
  });

  it("agents tutor is self-contained and never reaches wordbook or vocabulary (words are saved through <WordActions>)", () => {
    const targets = (rel: string) => importsOf(sourceOf(rel))
      .map((spec) => resolveSpec(spec, path.join(srcRoot, rel)))
      .flatMap((t) => (t.kind === "src" ? [t.rel.replace(/\.(ts|tsx)$/, "")] : []));
    const tutor = files.filter((f) => !isTest(f) && f.startsWith("features/agents/tutor/"));
    // 只可借用 agents 的文案注册入口(INDEX X11);不导入任何别的 feature 或 agents 的其他文件。
    const leaks = tutor.flatMap((rel) => targets(rel)
      .filter((to) => to.startsWith("features/") && !to.startsWith("features/agents/tutor/") && to !== "features/agents/locales")
      .map((to) => `${rel} -> ${to}`));
    expect(tutor.length).toBeGreaterThan(5);
    expect(leaks).toEqual([]);
    for (const f of tutor) expect(sourceOf(f), f).not.toMatch(/features\/(wordbook|vocabulary)/);
  });

  it("the chat hub is the only place that knows both chat and rooms (plan L6 R1/R2)", () => {
    expect(violationsOf("features/chat/x.tsx", 'import { useRoomsEnabled } from "~/features/rooms";')).toHaveLength(1);
    expect(violationsOf("pages/chat-hub.tsx", 'import { useRoomsEnabled } from "~/features/rooms";')).toEqual([]);
    expect(violationsOf("layout/x.tsx", 'import { ChatHubLayout } from "~/pages/chat-hub";')).toHaveLength(1);
    expect(sourceOf("pages/chat-hub.tsx")).not.toContain("~/features/chat");
    expect(CROSS_FEATURE_BASELINE.size).toBe(21);
  });

  it("the layout (bottom nav) no longer knows about rooms (plan L6 R8)", () => {
    const offenders = files.filter((f) => f.startsWith("layout/") && !isTest(f) && sourceOf(f).includes("~/features/rooms"));
    expect(offenders).toEqual([]);
  });
});
