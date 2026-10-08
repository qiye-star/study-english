/**
 * 架构约束(计划 2026-10-08 Addendum Task 9):扫描 src 下每个模块的 import,守住分层。
 *
 * 1. audio/、api/、lib/、components/ 是底层:不引入 features/、pages/、layout/、auth/、settings/(React 业务代码)。
 * 2. features/<x> 之外的代码只能经由 features/<x>/index.ts 引入它(`~/features/<x>`),不得触达内部文件。
 * 3. pages/ 只组合 features 与共享层:不直接引入 audio/;除 app.tsx / main.tsx 外无人引入 pages/。
 * 4. enjoy/ 只能经由 src/shims 触达(`@/…` 或指向 enjoy/ 的相对路径只许出现在 shims/);
 *    `@renderer/…` 别名(vite.config.ts / tsconfig.json)例外。
 *
 * 规则 1–3 只检查产品代码;测试文件可以为 vi.mock 引入其他 feature 的内部模块。规则 4 也检查测试文件。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
    if (feature && featureOf(rel) !== feature && to !== `features/${feature}` && to !== `features/${feature}/index`) {
      out.push(`${rel}: "${spec}" — import features/${feature} only via its index ("~/features/${feature}")`);
    }
    if (topOf(rel) === "pages" && topOf(to) === "audio") {
      out.push(`${rel}: "${spec}" — pages/ compose features; audio belongs inside a feature`);
    }
    if (topOf(to) === "pages" && topOf(rel) !== "pages" && rel !== "app.tsx" && rel !== "main.tsx") {
      out.push(`${rel}: "${spec}" — only app.tsx/main.tsx compose pages/`);
    }
  }
  return out;
}

const files = walk(srcRoot).map((f) => posix(path.relative(srcRoot, f)));

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
    const violations = files.flatMap((rel) => violationsOf(rel, readFileSync(path.join(srcRoot, rel), "utf8")));
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
});
