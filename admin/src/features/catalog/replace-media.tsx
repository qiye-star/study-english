/** 替换媒体(plan 2026-10-15-catalog-keep-video R-KV5):同一条目重新上传(分片),服务端转码后句子与译文保留,
 *  学习者副本自动改用新文件。真实 <input type=file> 留在 DOM 里(sr-only),由 <label htmlFor> 打开。 */
import { useId, useRef, useState } from "react";
import { completeUpload, startReplace } from "./api";
import { S } from "./strings";
import { uploadChunks } from "./upload";

export function ReplaceMedia({ id, disabled, onDone, onError }: {
  id: string; disabled: boolean; onDone: () => void; onError: (e: unknown) => void;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const pick = async (file: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!file) return;
    setPercent(0);
    try {
      const { chunkBytes } = await startReplace(id, file.name, file.size);
      await uploadChunks(id, file, chunkBytes, (p) => setPercent(Math.floor((p.sent * 100) / Math.max(1, p.total))));
      await completeUpload(id);
      onDone();
    } catch (e) {
      onError(e);
    } finally {
      setPercent(null);
    }
  };
  const busy = disabled || percent !== null;
  return (
    <span className="inline-flex items-center gap-2" title={S.detail.replaceHint}>
      <label htmlFor={inputId} className={`btn-ghost btn-sm ${busy ? "pointer-events-none opacity-60" : "cursor-pointer"}`}>
        {percent === null ? S.detail.replace : S.detail.replacing(`${percent}%`)}
      </label>
      <input id={inputId} ref={input} type="file" accept="video/*,audio/*" className="sr-only" disabled={busy}
        aria-label={S.detail.replace} onChange={(e) => void pick(e.target.files?.[0])} />
    </span>
  );
}
