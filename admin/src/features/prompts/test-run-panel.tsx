import { useId, useState } from "react";
import { SpinnerIcon } from "../../components/icons";
import { errorText } from "../../hooks/use-async";
import { testPrompt, type TestResult } from "./api";
import { S } from "./strings";

const MULTILINE = new Set(["chat", "draft", "text"]);

function messageFor(e: unknown): string {
  const text = errorText(e);
  return S.errors[text] ?? text;
}

/** 试运行(superadmin):用编辑器正文 + 样例输入调一次上游;样例与输出只留在本页内存里。 */
export function TestRunPanel({ promptKey, body, fields, blocked }: { promptKey: string; body: string; fields: string[]; blocked: boolean }) {
  const id = useId();
  const [sample, setSample] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await testPrompt(promptKey, body, Object.fromEntries(fields.map((f) => [f, sample[f] ?? ""]))));
    } catch (e) {
      setResult(null);
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-label={S.testTitle}>
      <div className="panel-head">
        <h2 className="text-sm font-semibold">{S.testTitle}</h2>
      </div>
      <div className="space-y-3 px-4 pb-4 pt-1">
        <p className="text-xs text-fg-2">{S.testHint}</p>
        {fields.map((f) => {
          const inputId = `${id}-${f}`;
          const label = S.sampleLabels[f] ?? f;
          return (
            <div key={f} className="space-y-1">
              <label htmlFor={inputId} className="text-xs font-medium text-fg-2">{label}</label>
              {MULTILINE.has(f) ? (
                <textarea
                  id={inputId}
                  className="field-sm h-auto min-h-[64px] py-2"
                  value={sample[f] ?? ""}
                  onChange={(e) => setSample((s) => ({ ...s, [f]: e.target.value }))}
                  maxLength={2000}
                />
              ) : (
                <input id={inputId} className="field-sm" value={sample[f] ?? ""} maxLength={2000}
                  onChange={(e) => setSample((s) => ({ ...s, [f]: e.target.value }))} />
              )}
            </div>
          );
        })}
        <div className="flex items-center gap-3">
          <button type="button" className="btn-ghost btn-sm" disabled={busy || blocked} onClick={run}>
            {busy && <SpinnerIcon width={14} height={14} />}
            {busy ? S.running : S.run}
          </button>
          {blocked && <span className="text-xs text-fg-2">{S.testBlocked}</span>}
        </div>
        {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
        {result && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <h3 className="eyebrow">{S.output}</h3>
              <span className="num text-xs text-fg-2">{S.took(result.ms)}</span>
            </div>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-sunken px-3 py-2 font-mono text-[13px]">{result.output}</pre>
          </div>
        )}
      </div>
    </section>
  );
}
