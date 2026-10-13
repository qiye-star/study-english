import { ClapperboardIcon, FileIcon, MusicIcon, UploadIcon, XIcon } from "lucide-react";
import { type DragEvent, type ReactNode, useId, useRef, useState } from "react";
import { fileKind, formatFileSize } from "./add-sheet-helpers";
import { SpotlightCard } from "./fx/spotlight-card";
import "./library.css";

const KIND_ICON = { video: ClapperboardIcon, audio: MusicIcon, other: FileIcon } as const;

/** 只接「文件」拖动:拖文字 / 链接进来不亮落点,也不吃掉 drop。 */
function dragHasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

export interface FilePickTileProps {
  file: File | null;
  /** 选中 / 拖入一个文件时给文件;点 ✕ 时给 null。取消选择器不会调用。 */
  onFile: (file: File | null) => void;
  accept: string;
  /** 真实 `<input type=file>` 的 data-testid;同时派生 `${id}-drop`(拖放容器)、`${id}-tile`(空态)、`${id}-card`(选中态)。 */
  inputTestId?: string;
  /** 真实输入的可访问名称(磁贴里的可见文字很长,不拿它当名称)。 */
  label: string;
  title: string;
  /** 拖着文件悬停时代替标题的文字。 */
  dropLabel: string;
  /** 「也可以把文件拖到这里」:触屏设备上由 CSS 隐藏。 */
  dragHint?: string;
  replaceLabel: string;
  removeLabel: string;
  /** 已本地化的问题文案;有值时文件卡变红色调并 role="alert"。 */
  problem?: string | null;
  disabled?: boolean;
  /** 空态磁贴里标题下面的提示行(格式、大小 / 时长限制)。 */
  children?: ReactNode;
}

/**
 * 选文件磁贴(R-A3):真实的 `<input type=file>` 始终在 DOM 里,视觉隐藏但可聚焦(`.lib-pick-input`);
 * 空态是 SpotlightCard 虚线磁贴,里面的 `<label htmlFor>` 触发选择器(点按手势里的原生激活,iOS 也能开);
 * 选中后变文件卡(类型图标、文件名省略、大小、更换、✕)。纯展示:文字都由调用方传入,状态在调用方。
 */
export function FilePickTile({
  file, onFile, accept, inputTestId, label, title, dropLabel, dragHint, replaceLabel, removeLabel, problem, disabled = false, children,
}: FilePickTileProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const tid = (suffix: string) => (inputTestId ? `${inputTestId}-${suffix}` : undefined);

  const over = (e: DragEvent<HTMLDivElement>) => {
    if (disabled || !dragHasFiles(e)) return;
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = "copy";
    } catch { /* 个别浏览器 / 测试垫片的 dataTransfer 只读 */ }
    setDragging(true);
  };
  const leave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
  };
  const drop = (e: DragEvent<HTMLDivElement>) => {
    if (disabled || !dragHasFiles(e)) return;
    e.preventDefault();
    setDragging(false);
    const first = e.dataTransfer.files?.[0];
    if (first) onFile(first); // 拖入的文件绕过 accept:类型不对由 checkUpload 提示(R-A5)
  };
  const remove = () => {
    onFile(null);
    input.current?.focus();
  };

  const Icon = file ? KIND_ICON[fileKind(file)] : UploadIcon;

  return (
    <div className="lib-pick-wrap" data-testid={tid("drop")} data-drag={dragging ? "" : undefined}
      onDragEnter={over} onDragOver={over} onDragLeave={leave} onDrop={drop}>
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
          e.target.value = ""; // 再选同一个文件也触发 change;「更换」里取消不会清掉已选(R-A4)
          if (picked) onFile(picked);
        }}
      />
      {file ? (
        <div className="lib-pick-card lib-tint lib-pick-surface" data-testid={tid("card")} data-kind={fileKind(file)} data-invalid={problem ? "" : undefined}>
          <span className="lib-pick-ico" aria-hidden><Icon /></span>
          <span className="lib-pick-meta">
            <span className="lib-pick-name text-body font-semibold text-ink" title={file.name}>{file.name}</span>
            <span className="num text-meta text-ink-2">{formatFileSize(file.size)}</span>
          </span>
          <label htmlFor={id} className="lib-pick-act">{replaceLabel}</label>
          <button type="button" className="lib-pick-act lib-pick-x" aria-label={removeLabel} disabled={disabled} onClick={remove}>
            <XIcon aria-hidden />
          </button>
        </div>
      ) : (
        <SpotlightCard className="lib-pick lib-pick-surface" data-testid={tid("tile")}>
          <label htmlFor={id} className="lib-pick-face">
            <span className="lib-pick-ico" aria-hidden><Icon /></span>
            <span className="text-body font-semibold text-ink">{dragging ? dropLabel : title}</span>
            {children}
            {dragHint ? <span className="lib-pick-drag text-meta text-ink-3">{dragHint}</span> : null}
          </label>
        </SpotlightCard>
      )}
      {problem ? <p id={errorId} role="alert" className="mt-1.5 text-meta text-red">{problem}</p> : null}
    </div>
  );
}
