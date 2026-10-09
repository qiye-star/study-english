import { useId, useRef, useState } from "react";
import { MAX_TEMPLATES, TEMPLATE_LIMITS, templateRowProblems, type ChatTemplate } from "./placeholders";
import { S } from "./strings";

function parseRows(body: string): ChatTemplate[] | null {
  try {
    const value: unknown = JSON.parse(body);
    if (!Array.isArray(value)) return null;
    return value.map((item) => {
      const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
      return { key: s("key"), name: s("name"), description: s("description"), prompt: s("prompt") };
    });
  } catch {
    return null;
  }
}

function readText(file: Blob): Promise<string> {
  // FileReader instead of Blob.text(): older Safari and jsdom lack the latter
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

const serialise = (rows: ChatTemplate[]) => JSON.stringify(rows, null, 2);

/** `config.chat_agent_templates` 专用:表格编辑 key / 名称 / 说明 / 提示词,增删行,导入/导出 JSON。正文始终是 JSON 数组。 */
export function TemplatesEditor({ body, onChange, readOnly = false }: { body: string; onChange: (body: string) => void; readOnly?: boolean }) {
  const fileId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const rows = parseRows(body);

  const emit = (next: ChatTemplate[]) => onChange(serialise(next));
  const setCell = (index: number, field: keyof ChatTemplate, value: string) =>
    rows && emit(rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));

  const exportJson = () => {
    const blob = new Blob([serialise(rows ?? [])], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "chat_agent_templates.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const importJson = async (file: File | undefined) => {
    if (!file) return;
    const next = parseRows(await readText(file));
    if (!next) {
      setImportError(S.importFailed);
    } else {
      setImportError(null);
      emit(next);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const problems = rows ? templateRowProblems(rows) : {};

  return (
    <section className="panel" aria-label={S.templatesTitle}>
      <div className="panel-head">
        <h2 className="text-sm font-semibold">
          {S.templatesTitle}
          {rows && <span className="num ml-2 text-xs font-normal text-fg-2">{S.templatesCount(rows.length)}</span>}
        </h2>
        <div className="flex items-center gap-2">
          {!readOnly && (
            <>
              <label htmlFor={fileId} className="btn-ghost btn-sm cursor-pointer">{S.importJson}</label>
              <input id={fileId} ref={fileRef} type="file" accept="application/json,.json" className="sr-only"
                aria-label={S.importJson} onChange={(e) => importJson(e.target.files?.[0])} />
            </>
          )}
          <button type="button" className="btn-ghost btn-sm" onClick={exportJson} disabled={!rows}>{S.exportJson}</button>
        </div>
      </div>
      {importError && <p role="alert" className="px-4 pb-2 text-sm text-bad">{importError}</p>}
      {!rows ? (
        <p className="px-4 pb-4 text-sm text-bad">{S.invalidJson}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col" className="num w-10 border-b border-line px-3 py-2 text-left text-2xs font-medium text-fg-2">#</th>
                <th scope="col" className="w-44 border-b border-line px-3 py-2 text-left text-2xs font-medium text-fg-2">{S.colKey}</th>
                <th scope="col" className="w-40 border-b border-line px-3 py-2 text-left text-2xs font-medium text-fg-2">{S.colName}</th>
                <th scope="col" className="w-56 border-b border-line px-3 py-2 text-left text-2xs font-medium text-fg-2">{S.colDescription}</th>
                <th scope="col" className="border-b border-line px-3 py-2 text-left text-2xs font-medium text-fg-2">{S.colPrompt}</th>
                {!readOnly && <th scope="col" className="w-16 border-b border-line" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const n = i + 1;
                return (
                  <tr key={i} className="align-top">
                    <td className="num border-b border-line px-3 py-2 text-fg-2">{n}</td>
                    <td className="border-b border-line px-3 py-2">
                      <input className="field-sm font-mono" aria-label={`${S.colKey}(第 ${n} 行)`} value={row.key} readOnly={readOnly}
                        maxLength={TEMPLATE_LIMITS.key} onChange={(e) => setCell(i, "key", e.target.value)} spellCheck={false} />
                    </td>
                    <td className="border-b border-line px-3 py-2">
                      <input className="field-sm" aria-label={`${S.colName}(第 ${n} 行)`} value={row.name} readOnly={readOnly}
                        onChange={(e) => setCell(i, "name", e.target.value)} />
                    </td>
                    <td className="border-b border-line px-3 py-2">
                      <textarea className="field-sm h-auto min-h-[36px] py-1.5" rows={2} aria-label={`${S.colDescription}(第 ${n} 行)`}
                        value={row.description} readOnly={readOnly} onChange={(e) => setCell(i, "description", e.target.value)} />
                    </td>
                    <td className="border-b border-line px-3 py-2">
                      <textarea className="field-sm h-auto min-h-[36px] py-1.5 font-mono text-[13px]" rows={3}
                        aria-label={`${S.colPrompt}(第 ${n} 行)`} value={row.prompt} readOnly={readOnly}
                        onChange={(e) => setCell(i, "prompt", e.target.value)} spellCheck={false} />
                      {problems[i] && (
                        <ul className="mt-1 space-y-0.5 text-xs text-bad">
                          {problems[i].map((p) => <li key={p}>{S.rowProblems[p]}</li>)}
                        </ul>
                      )}
                    </td>
                    {!readOnly && (
                      <td className="border-b border-line px-3 py-2 text-right">
                        <button type="button" className="btn-quiet btn-sm text-bad" aria-label={`${S.removeRow}(第 ${n} 行)`}
                          onClick={() => emit(rows.filter((_, j) => j !== i))}>
                          {S.removeRow}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!readOnly && (
            <div className="px-4 py-3">
              <button type="button" className="btn-ghost btn-sm" disabled={rows.length >= MAX_TEMPLATES}
                onClick={() => emit([...rows, { key: "", name: "", description: "", prompt: "" }])}>
                {S.addRow}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
