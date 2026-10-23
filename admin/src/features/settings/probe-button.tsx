import { useState } from "react";
import { ApiError } from "../../api/client";
import { SpinnerIcon } from "../../components/icons";
import { StatusDot } from "../../components/status-dot";
import { errorText } from "../../hooks/use-async";
import { runProbe, type ProbeResult, type Scalar } from "./api";
import { S } from "./strings";

/** 设置键 → 测试连接的上游名(probes.UPSTREAMS) */
export const PROBE_FOR: Record<string, string> = {
  upstream_llm_base_url: "llm",
  upstream_grammar_base_url: "grammar",
  upstream_tts_base_url: "tts",
  upstream_whisper_base_url: "whisper",
  volcengine_tts_url: "volc_tts",
  asr_stream_url: "asr_stream",
  azure_speech_region: "azure",
  xfyun_ws_url: "xfyun",
  smtp_host: "smtp",
};

const COSTLY = new Set(["llm", "grammar"]);

/** 测试连接(超级管理员):只显示结果码、状态码与耗时;values = 表单里尚未保存的值(密钥留空 = 用已保存的)。 */
export function ProbeButton({ upstream, values }: { upstream: string; values: Record<string, Scalar> }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allowCost, setAllowCost] = useState(false);
  const [pair, setPair] = useState<{ keys: string[]; host: string } | null>(null);
  const usesDraft = Object.keys(values).length > 0;

  const run = async (confirmPairs: string[] = []) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await runProbe(upstream, { values, allowCost, confirmPairs }));
      setPair(null);
    } catch (e) {
      const details = e instanceof ApiError ? e.details : undefined;
      if (e instanceof ApiError && e.status === 409 && details && Array.isArray(details.pairs)) {
        const hosts = (details.hosts ?? {}) as Record<string, string>;
        const keys = details.pairs as string[];
        setPair({ keys, host: Object.values(hosts).join("、") });
      } else {
        setError(errorText(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <button type="button" className="btn-ghost btn-sm" onClick={() => run()} disabled={busy}>
        {busy && <SpinnerIcon width={13} height={13} />}
        {busy ? S.probing : S.probe}
      </button>
      {COSTLY.has(upstream) && (
        <label className="inline-flex items-center gap-1 text-fg-2">
          <input type="checkbox" checked={allowCost} onChange={(e) => setAllowCost(e.target.checked)} />
          {S.allowCost}
        </label>
      )}
      {result && (
        <span role="status" className="inline-flex items-center gap-1.5">
          <StatusDot tone={result.ok ? "good" : result.code === "not_configured" ? "neutral" : "bad"} label={S.probeCodes[result.code] ?? result.code} />
          {result.status > 0 && <span className="num text-fg-2">{result.status} · {result.ms} ms</span>}
          {usesDraft && <span className="text-fg-2">{S.probeUsesDraft}</span>}
        </span>
      )}
      {pair && (
        <span className="inline-flex items-center gap-2 text-warn">
          {S.probePair(pair.host)}
          <button type="button" className="btn-ghost btn-sm" onClick={() => run(pair.keys)} disabled={busy}>
            {S.probeConfirmPair}
          </button>
        </span>
      )}
      {error && (
        <span role="alert" className="text-bad">
          {error}
        </span>
      )}
    </div>
  );
}
