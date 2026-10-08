import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "ADMIN_");
  return {
    base: "/admin/",
    // vitest 自带一份嵌套的 vite,插件类型不互通
    plugins: [react() as never],
    server: {
      port: 5174,
      proxy: { "/api": { target: process.env.ADMIN_DEV_API_TARGET || env.ADMIN_DEV_API_TARGET || "http://127.0.0.1:8000" } },
    },
    build: { outDir: "dist", emptyOutDir: true, target: ["es2020", "safari15"] },
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
      css: false,
    },
  };
});
