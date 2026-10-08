// progress 的公共接口:其他目录只能从这里引入 progress(由 src/architecture.test.ts 约束)。
export { ProgressPage } from "./progress-page";
export { getStats, type Stats } from "./stats-api";
