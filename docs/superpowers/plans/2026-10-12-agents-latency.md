# 智能体回合延迟(Agents latency)

- 日期:2026-10-11 · 计划:`docs/superpowers/plans/2026-10-12-agents-core.md`(Z2、Z3)· spec §6
- 结论先行:这里只有「本机 + 假上游」的服务端开销;**真实上游(DeepSeek / 方舟)的首字时间未验证**(见「真实上游」一节)。
- 机器负载说明:数字来自一台开发用 Windows 机器上的单次连续运行(同时可能有其他进程),没有隔离 CPU,也没有重复多轮取平均;只在同一数量级上有意义。

## 测什么
- `ctx_ms`:并行预取(已学词 / 易错词 / 到期词 / 查词 / 记忆)的墙钟时间;spec §4.6 的硬上限是总预算 250 ms(超时记 skip)。
- `ttft_ms`:编排开始(扣额度之后)到第一个可见字;减去假上游的首字延迟 = 服务端自己的开销估计。
- `total_ms`:整回合。数据来自 `timing event=agent_turn` 日志行(只有数字)。

## 方法
`cd server && uv run python scripts/agents_latency.py …`(进程内应用、临时 SQLite 文件库、`httpx.MockTransport` 假上游、
一个有 200 个词条 / 300 条学新词事件 / 20 个易错词的用户、20 条历史);预热回合不计入。每回合结束后等待后台的
回合后任务(记忆整理;假上游对非流式请求返回空操作 JSON)完成,再发下一回合,避免互相干扰。

## 结果 A:不开查词
`uv run python scripts/agents_latency.py --turns 30 --first-token-ms 400 --chunk-ms 30 --chunks 12`(原样输出)

- 环境:Python 3.12.14 · Windows 11 · SQLite 3.53.1 · 假上游(httpx.MockTransport)
- 参数:turns=30 warmup=3 first_token_ms=400 chunk_ms=30 chunks=12 wordbook=False history=20 条
- 来源:每回合 5 个;跳过合计 0,失败合计 0

| 指标(毫秒) | 中位数 | p90 | 最大 |
|---|---|---|---|
| ctx_ms(并行预取) | 8 | 31 | 54 |
| ttft_ms(请求进入编排 → 第一个可见字) | 427 | 449 | 476 |
| ttft_ms − 假上游首字延迟(服务端开销估计) | 27 | 49 | 76 |
| total_ms | 887 | 909 | 945 |

## 结果 B:打开查词(仓库词典,当前书 junior)
`uv run python scripts/agents_latency.py --turns 30 --first-token-ms 400 --chunk-ms 30 --chunks 12 --wordbook`(原样输出)

- 环境:Python 3.12.14 · Windows 11 · SQLite 3.53.1 · 假上游(httpx.MockTransport)
- 参数:turns=30 warmup=3 first_token_ms=400 chunk_ms=30 chunks=12 wordbook=True history=20 条
- 来源:每回合 5 个;跳过合计 0,失败合计 0

| 指标(毫秒) | 中位数 | p90 | 最大 |
|---|---|---|---|
| ctx_ms(并行预取) | 10 | 24 | 126 |
| ttft_ms(请求进入编排 → 第一个可见字) | 428 | 441 | 539 |
| ttft_ms − 假上游首字延迟(服务端开销估计) | 28 | 41 | 139 |
| total_ms | 884 | 937 | 1015 |

### 补充运行 C:查词 + 更长预热
`uv run python scripts/agents_latency.py --turns 30 --warmup 12 --first-token-ms 400 --chunk-ms 30 --chunks 12 --wordbook`(原样输出)

- 环境:Python 3.12.14 · Windows 11 · SQLite 3.53.1 · 假上游(httpx.MockTransport)
- 参数:turns=30 warmup=12 first_token_ms=400 chunk_ms=30 chunks=12 wordbook=True history=20 条
- 来源:每回合 5 个;跳过合计 0,失败合计 0

| 指标(毫秒) | 中位数 | p90 | 最大 |
|---|---|---|---|
| ctx_ms(并行预取) | 11 | 33 | 56 |
| ttft_ms(请求进入编排 → 第一个可见字) | 427 | 448 | 477 |
| ttft_ms − 假上游首字延迟(服务端开销估计) | 27 | 48 | 77 |
| total_ms | 883 | 938 | 956 |

- 观察(调试时的另一次 `--wordbook` 运行,预热 3 回合;输出没有原样保存,只记大意):词典索引在后台构建,最初约 8 个回合里查词来源被
  跳过(`src_skipped` 合计 4,这些回合的 `ctx_ms` 在 130–150 左右);索引建好后回到个位数。B 里这段构建期落在预热内或影响很小,
  所以更长的预热(C)才代表稳态。部署后的第一批查词回合可能没有查词步骤,这是预期行为(来源超时即跳过,不拖慢首字)。

## 与预算对照
- 预取总预算 250 ms 是代码里的硬上限(`PREFETCH_BUDGET_MS`),表里的 `ctx_ms` 是否远低于它,以上面的数字为准。
- spec §6 除 250 ms 外没有给其他延迟数字;本文不推断真实用户的首字时间。

## 真实上游(Z3)
- **未验证。** 本次没有调用任何真实上游:本机配置的上游返回 402(余额不足),也没有可用的密钥;所有测试与上面的测量只用假上游。
- 下列每一项都标为「未验证」,等有可用的上游与密钥后在本机手动检查(步骤见计划 `2026-10-12-agents-core.md` 的 Task Z3 Step 1;不要提交 `.env`,不要把密钥或令牌写进文档):
  - 未验证:DeepSeek / 方舟流式响应的 `data:` 行格式与 `[DONE]` 结尾
  - 未验证:`reasoning_content` 字段名与出现位置(深度思考角色)
  - 未验证:`stream_options.include_usage` 的用量块(否则计量按字节)
  - 未验证:`thinking: {"type": "disabled"}` 在**流式**请求上被接受(既有结论只覆盖非流式实时通话)
  - 未验证:原生函数调用(管理端「运行函数调用探测」的结果码)
  - 未验证:真实首字时间(`ttft_ms`)
  - 未验证:0015 及之后的迁移在 Postgres 上(`TEST_DATABASE_URL=postgresql+asyncpg://… uv run pytest -q tests/test_migrations.py`)
  - 未验证:反向代理下 SSE 不被缓冲(`X-Accel-Buffering: no` 对 Nginx 有效;Caddy 需 `flush_interval -1`)
- 若上游返回 402 / 401 等失败,预期行为(由假上游测试覆盖):客户端只收到 `error{code:"llm_unavailable"}`,服务端日志只有 `llm stream http status=402` 一类的行。

## 未验证
- 真实上游的首字时间与流式格式(见上一节);反向代理(Nginx / Caddy)对 SSE 的缓冲;Postgres 下预取查询的耗时;真机网络。
