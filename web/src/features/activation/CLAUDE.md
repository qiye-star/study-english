# web/src/features/activation/

词汇激活(plan `docs/superpowers/plans/10.21-plans/2026-10-21-l4-activation-context.md`,Task 15/16)。服务端 `ACTIVATION_ENABLED` 默认关;
关时 `/api/activation/config` 返回 `enabled: false`,「我的」一行与 `/me/activation` 页都不出现(页面直达时跳回 `/practice`)。

## What lives here
- `activation-api.ts` – 接口(`fetchActivationConfig`、`fetchWords(state, page)`、`fetchPromptHint(offset)`)与防御性解析;失败由调用方处理,不弹 toast。
- `use-activation-config.ts` – `useActivationConfig` / `useActivationEnabled`(每个 `ApiClient` 缓存一次成功结果,失败下次挂载重试)。
- `dormant-page.tsx` – `/me/activation`:三段切换(沉睡 / 萌芽 / 激活,带计数)、分页列表、空态、加载更多;配置关 → 跳回练习页。
- `me-row.tsx` – 「我的 → 沉睡词 n」一行(只在开启时显示)。
- `register.ts` – 扩展点登记:`meRows/activation.row`(核心贡献,不是联动)与 `/me/activation` 路由(懒加载页面)。只被 `src/plugins/activation` 导入。
- `index.ts` – 公共接口(目前为空,别的目录要用时再加)。
- `i18n/{en,zh-CN}.json` – `web.activation.*` 与 `web.agents.step.dormant_words`(智能体步骤名);中英键一致(`i18n.test.ts`)。西语不做。
- 契约:`activation-contract.test.ts` 逐键核对 `server/tests/fixtures/activation_contract.json`。

## Pitfalls
- 词只出现在响应体与页面上;不进 URL、不进日志、不进 `localStorage`。
- 列表与计数只来自服务端;网页不推断状态,不改服务端的阈值(阈值是占位,未校准)。
- 每个沉睡词一行带 `<WordActions>`(扩展点 `wordActions`,`lib/extension-points-react`):「更多」面板里的「查看词卡」由 wordbook 的登记处贡献,
  本 feature 不导入 `features/wordbook`(L4 Task 15)。词卡没开或联动关闭时只剩核心的「加入生词本」。
- 液态玻璃:页面文字在普通面板上,不新增常驻模糊层。
- 「我的」一行是核心贡献:链接联动的矩阵测试(`src/plugins/links-matrix.test.tsx`)把它列在核心清单里。
