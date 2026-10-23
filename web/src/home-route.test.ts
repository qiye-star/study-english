/**
 * 「首页」只在 lib/home-route.ts 里表达一次(计划 2026-10-23 车道 C):回首页的跳转都用 HOME_PATH,
 * 不再写死路径;PWA 的 start_url 与它一致。返回键、底栏标签等「指向练习页」的 "/practice" 不属于这里。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOME_PATH } from "~/lib/home-route";

const srcRoot = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(srcRoot, rel), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts") ? [full] : [];
  });
}

describe("home route", () => {
  it("product code has no hard-coded go-home redirect to /practice", () => {
    const banned = [/Navigate to="\/practice"/, /navigate\("\/practice"/, /\?\? "\/practice"/, /fallback = "\/practice"/];
    const hits = walk(srcRoot).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return banned.filter((re) => re.test(text)).map((re) => `${path.relative(srcRoot, file)}: ${re}`);
    });
    // rank/stage-tasks.tsx 的 `?? "/practice"` 指「练习这个页面」(段位任务跳转),不是回首页。
    expect(hits.filter((h) => !h.startsWith(path.join("features", "rank", "stage-tasks.tsx")))).toEqual([]);
  });

  it("the catch-all route and the sign-in pages use HOME_PATH", () => {
    expect(read("app.tsx")).toContain("<Navigate to={HOME_PATH} replace />");
    for (const file of ["pages/login-page.tsx", "features/account/signup-page.tsx", "features/account/forgot-password-page.tsx", "lib/extension-points-react.tsx"]) {
      expect(read(file), file).toContain("HOME_PATH");
    }
  });

  it("the PWA start_url is the home path", () => {
    const manifest = JSON.parse(readFileSync(path.join(srcRoot, "..", "public", "manifest.webmanifest"), "utf8")) as { start_url: string };
    expect(manifest.start_url).toBe(HOME_PATH);
  });
});
