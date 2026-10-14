// changelog 的公共接口(计划 2026-10-14-changelog):其他目录只能从这里引入(src/architecture.test.ts 约束)。
// 页面按路由懒加载(lazy-pages.tsx);练习页顶栏的入口经扩展点 `practiceHeaderActions` 贡献(register.tsx,只被 plugins/core.ts 导入),
// 不在这里导出。不要在这里静态导出页面模块、api、store、文案或样式。
export { ChangelogPage } from "./lazy-pages";
