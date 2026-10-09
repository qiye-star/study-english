import { S } from "../strings";
import { LockIcon } from "./icons";

export interface SecretFieldState {
  set: boolean;
  source: "env" | "override" | "none";
  fp: string;
}

/**
 * 密钥输入(spec §3.5):type=password、autocomplete=off;留空 = 不修改。
 * 只显示"已设置/未设置 + 来源 + 指纹",从不回显值。
 */
export function SecretField({
  state,
  value,
  onChange,
  disabled = false,
  label,
}: {
  state: SecretFieldState;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const status = state.set ? `${S.diff.set} · ${state.fp}` : S.diff.unset;
  return (
    <div className="space-y-1">
      <div className="relative">
        <LockIcon width={15} height={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-2" />
        <input
          className="field-sm pl-8 font-mono"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-label={label}
          placeholder={disabled ? status : S.secret.keep}
        />
      </div>
      <p className="text-2xs text-fg-2">
        <span className="num">{status}</span> · {S.secret[state.source]}
      </p>
    </div>
  );
}
