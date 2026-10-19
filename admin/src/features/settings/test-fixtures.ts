/** 测试数据(P-7:组件测试 mock ./api,不打网络)。 */
import type { SettingItem, SettingsList } from "./api";

function item(partial: Partial<SettingItem> & Pick<SettingItem, "key" | "group" | "kind" | "label">): SettingItem {
  return {
    env: partial.key.toUpperCase(),
    help: "",
    apply: "hot",
    danger: null,
    envOnly: false,
    secret: false,
    managed: false,
    pair: null,
    min: null,
    max: null,
    choices: null,
    source: "env",
    pending: null,
    restartPending: false,
    invalid: null,
    drift: false,
    ...partial,
  };
}

const secret = (set: boolean, source: "env" | "override" | "none", fp: string) => ({ set, source, fp });

export function fixtureList(): SettingsList {
  return {
    groups: [
      ["features", "功能开关"],
      ["limits", "限流与配额"],
      ["llm", "大模型"],
      ["asr", "语音识别"],
      ["rank", "段位赛"],
      ["system", "系统(只读)"],
    ],
    items: [
      item({ key: "realtime_enabled", group: "features", kind: "bool", label: "实时通话", apply: "new_sessions", danger: "打开后会产生上游费用", envValue: true, effective: true, default: false }),
      item({ key: "rank_enabled", group: "features", kind: "bool", label: "段位赛", danger: "关闭后段位接口返回 404", envValue: false, effective: false, default: false }),
      item({ key: "rooms_enabled", group: "features", kind: "bool", label: "联机练习", danger: "关闭会断开所有在线房间连接", envValue: true, effective: true, default: false }),
      item({ key: "rate_limit_per_minute", group: "limits", kind: "int", label: "登录/注册每分钟次数(按 IP)", min: 1, max: 10000, envValue: 10, effective: 10, default: 10, override: null }),
      item({
        key: "upstream_llm_base_url", group: "llm", kind: "url", label: "LLM 地址", danger: "改主机会把配对的密钥发送到新地址",
        pair: "upstream_llm_key", envValue: "https://api.old.example/v1", effective: "https://api.old.example/v1", default: "", override: null,
      }),
      item({
        key: "upstream_llm_key", group: "llm", kind: "secret", label: "LLM 密钥", secret: true, source: "override",
        envState: secret(true, "env", "7e5d0c11"), overrideState: secret(true, "override", "a1b2c3d4"), effectiveState: secret(true, "override", "a1b2c3d4"),
      }),
      item({ key: "asr_stream_max_concurrency", group: "asr", kind: "int", label: "流式识别并发", apply: "restart", min: 1, max: 32, envValue: 3, effective: 3, pending: 6, restartPending: true, source: "override", override: 6 }),
      item({ key: "database_url", group: "system", kind: "secret", label: "数据库连接", envOnly: true, secret: true, apply: "restart", envState: secret(true, "env", "3c90aa21"), effectiveState: secret(true, "env", "3c90aa21") }),
      item({ key: "rank_daily_rp_cap", group: "rank", kind: "int", label: "每日段位点上限", managed: true, envValue: 60, effective: 60, default: 60 }),
    ],
    safeMode: false,
    encryption: true,
    revision: 48,
    pendingRestart: ["asr_stream_max_concurrency"],
    applyErrors: [],
    invalid: {},
    rankRulesManaged: true,
  };
}

/** SMTP 主机:kind str,服务端 pair = smtp_password(改主机未带新授权码 → 409 pairs)。 */
export function smtpHostItem(): SettingItem {
  return item({
    key: "smtp_host", group: "accounts", kind: "str", label: "SMTP 主机", pair: "smtp_password",
    danger: "改主机会把 SMTP 密码发送到新地址", envValue: "smtp.qq.com", effective: "smtp.qq.com", default: "",
  });
}
