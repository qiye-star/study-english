# web/src/features/rank/

段位赛:段位首页、阶段练习、晋级赛(语音,服务端评分)、结果、成就墙;练习首页与「我的」用的 `RankCard`。
Spec: `docs/superpowers/specs/2026-10-09-rank-and-rooms-design.md` §2–4, §10.

## What lives here
- `rank-api.ts`(契约见 `server/tests/fixtures/rank_contract.json`)、`tiers.ts`、`tier-badge.tsx`、`rank-card.tsx`
- `rank-home-page.tsx`、`stage-tasks.tsx`、`promotion-card.tsx`
- `match-machine.ts`(纯状态机)、`use-match.ts`、`match-page.tsx`、`match-result.tsx`
- `achievements-page.tsx`、`i18n/{en,zh-CN}.json`
- `ui.ts`(本目录的按钮/卡片类名);`test-contract.ts`(仅测试:读契约样例 + `inChinese()` 切中文)

## Public surface
`RankHomePage`、`MatchPage`、`AchievementsPage`、`RankCard`、`fetchRankConfig`。

## Allowed dependencies
`lib/`、`api/`、`audio/`、`components/`、`layout/`、`auth/`、`settings/`、`@renderer/*`、其他 feature 的 `index.ts`(只在调用时使用)。

## Test
`cd web && yarn vitest run src/features/rank`

## Pitfalls
- 晋级赛只收语音;不要加文字输入通道(防作弊,spec §3.5)。按住说话长条必须传 `allowToText={false}`(没有「转文字」落点;`match-page.voice-only.test.tsx` 断言)。
- 评分失败(`grading_failed`)的场次服务端仍算进行中:错误卡要同时给「重新打分」与「放弃本场」。
- 契约:`rank-contract.test.ts` 把类型逐键绑定到 `rank_contract.json`;改服务端字段时两边一起改。
- 段位不引入新色相:通过 = green,未通过 = ink-2,进度 = blue。
- iOS:`useMatch` 在「开始」点击与松手的同步阶段调用 `tts.prime()` 预热播放。
- 测试默认语言是英文;断言中文文案的测试在 describe 里调用 `inChinese()`(写设置 + 切语言,SettingsProvider 才不会切回去)。
- 不要从一个 `*.test.tsx` 引入另一个测试文件(会把它的用例再跑一遍);共享样例放 `test-contract.ts`。
