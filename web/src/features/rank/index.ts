// rank 的公共接口:其他目录只能从这里引入 rank(由 src/architecture.test.ts 约束)。
export { RankHomePage } from "./rank-home-page";
export { MatchPage } from "./lazy-pages";
export { AchievementsPage } from "./achievements-page";
export { fetchRankConfig, type RankConfig } from "./rank-api";
export { RankCard } from "./rank-card";
export { RankMiniCard } from "./rank-mini-card";
export { NewAchievements } from "./new-achievements";
