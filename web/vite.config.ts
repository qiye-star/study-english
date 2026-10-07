import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webRoot, "..");
const enjoySrc = path.join(repoRoot, "enjoy", "src");
const posix = (p: string) => p.split(path.sep).join("/");
const pkg = JSON.parse(readFileSync(path.join(webRoot, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
};
const runtimeDeps = Object.keys(pkg.dependencies ?? {});
const shim = (name: string) => posix(path.join(webRoot, "src", "shims", name));

/** enjoy/src 里引入的裸模块必须由 web/package.json 提供(裁定 R15)。 */
function guardEnjoyDeps(): Plugin {
  return {
    name: "guard-enjoy-deps",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || !posix(importer).includes("/enjoy/src/")) return null;
      const bare = /^(@[\w.-]+\/)?[\w.-]/.test(source) && !path.isAbsolute(source);
      if (!bare || source.startsWith("@/") || source.startsWith("@renderer/") || source.startsWith("~/")) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (resolved && posix(resolved.id).includes("/enjoy/node_modules/")) {
        this.error(`"${source}" (imported by ${posix(path.relative(repoRoot, importer))}) must be a dependency of web/package.json`);
      }
      return resolved;
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, webRoot, "WEB_");
  return {
    plugins: [guardEnjoyDeps(), react()],
    define: { __VAD_ASSET_BASE__: JSON.stringify(`/vad/${pkg.dependencies?.["@ricky0123/vad-web"] ?? "0"}/`) },
    resolve: {
      alias: [
        { find: /^@renderer\/components$/, replacement: shim("enjoy-components.ts") },
        { find: /^@renderer\/components\/ui$/, replacement: shim("enjoy-ui.ts") },
        { find: /^@\/renderer\/components\/ui$/, replacement: shim("enjoy-ui.ts") },
        { find: /^@bugsnag\/electron$/, replacement: shim("empty-module.ts") },
        { find: /^electron-log\/renderer$/, replacement: shim("empty-module.ts") },
        { find: /^@renderer\//, replacement: `${posix(enjoySrc)}/renderer/` },
        { find: /^@\//, replacement: `${posix(enjoySrc)}/` },
        { find: /^~\//, replacement: `${posix(path.join(webRoot, "src"))}/` },
      ],
      dedupe: runtimeDeps,
    },
    server: {
      fs: { allow: [repoRoot] },
      proxy: { "/api": { target: env.WEB_DEV_API_TARGET || "http://127.0.0.1:8000" } },
    },
    build: { outDir: "dist", emptyOutDir: true, target: ["es2020", "safari15"], chunkSizeWarningLimit: 1500 },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
      css: false,
      restoreMocks: true,
    },
  };
});
