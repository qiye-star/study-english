import { SubtitlesIcon, XIcon } from "lucide-react";
import { useId, useRef } from "react";
import { formatFileSize } from "./add-sheet-helpers";
import "./library.css";

export interface SubtitlePickerProps {
  file: File | null;
  onFile: (file: File | null) => void;
  accept?: string;
  /** 真实输入的 data-testid;同时派生 `${id}-row`。 */
  inputTestId?: string;
  /** 「字幕(可选,.srt / .vtt)」:既是可见文字,也是输入的可访问名称。 */
  label: string;
  addLabel: string;
  removeLabel: string;
  problem?: string | null;
  disabled?: boolean;
}

/**
 * 可选字幕的次级行(R-A3 同一套「label + 视觉隐藏的真实输入」):空态是「标题 + 添加胶囊」,选中后是文件名 + 大小 + ✕。
 * 纯展示;不做拖放(需求只要求主文件)。
 */
export function SubtitlePicker({
  file, onFile, accept = ".srt,.vtt", inputTestId, label, addLabel, removeLabel, problem, disabled = false,
}: SubtitlePickerProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const input = useRef<HTMLInputElement>(null);
  const remove = () => {
    onFile(null);
    input.current?.focus();
  };
  return (
    <div className="lib-pick-wrap">
      <input
        ref={input}
        id={id}
        type="file"
        accept={accept}
        disabled={disabled}
        data-testid={inputTestId}
        className="lib-pick-input"
        aria-label={label}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? errorId : undefined}
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = "";
          if (picked) onFile(picked);
        }}
      />
      <div className="lib-subrow lib-pick-surface" data-testid={inputTestId ? `${inputTestId}-row` : undefined} data-invalid={problem ? "" : undefined}>
        <span className="lib-pick-ico" aria-hidden><SubtitlesIcon /></span>
        <span className="lib-pick-meta">
          {file ? (
            <>
              <span className="lib-pick-name text-sub font-semibold text-ink" title={file.name}>{file.name}</span>
              <span className="num text-meta text-ink-2">{formatFileSize(file.size)}</span>
            </>
          ) : (
            <span className="text-sub font-medium text-ink">{label}</span>
          )}
        </span>
        {file ? (
          <button type="button" className="lib-pick-act lib-pick-x" aria-label={removeLabel} disabled={disabled} onClick={remove}>
            <XIcon aria-hidden />
          </button>
        ) : (
          <label htmlFor={id} className="lib-chip lib-sub-add">{addLabel}</label>
        )}
      </div>
      {problem ? <p id={errorId} role="alert" className="mt-1.5 text-meta text-red">{problem}</p> : null}
    </div>
  );
}
