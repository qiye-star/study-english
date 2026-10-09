# web/src/features/rank/

段位赛:段位首页、阶段练习、晋级赛(语音,服务端评分)、结果、成就墙;练习首页与「我的」用的 `RankCard`。
Spec: `docs/superpowers/specs/2026-10-09-rank-and-rooms-design.md` §2–4, §10.

## What lives here
- `rank-api.ts`(契约见 `server/tests/fixtures/rank_contract.json`)、`tiers.ts`、`tier-badge.tsx`、`rank-card.tsx`
- `rank-home-page.tsx`、`stage-tasks.tsx`、`promotion-card.tsx`
- `match-machine.ts`(纯状态机)、`use-match.ts`、`match-page.tsx`、`match-result.tsx`
- `achievements-page.tsx`、`i18n/{en,zh-CN}.json`

## Public surface
`RankHomePage`、`MatchPage`、`AchievementsPage`、`RankCard`、`fetchRankConfig`。

## Allowed dependencies
`lib/`、`api/`、`audio/`、`components/`、`layout/`、`auth/`、`settings/`、`@renderer/*`、其他 feature 的 `index.ts`(只在调用时使用)。

## Test
`cd web && yarn vitest run src/features/rank`

## Pitfalls
- 晋级赛只收语音;不要加文字输入通道(防作弊,spec §3.5)。
- 段位不引入新色相:通过 = green,未通过 = ink-2,进度 = blue。
- iOS:在按下手势里预热播放(`primeAudioElement`)。
