import "./locales";
import { useTranslation } from "react-i18next";
import type { RoleKey } from "./dubbing-api";
import { HeadphoneHint } from "./headphone-hint";
import { RoleDot } from "./role-identity";

export interface RehearsalLine {
  idx: number;
  text: string;
  /** 用户要说的句子 */
  mine: boolean;
}

/**
 * 彩排页(计划 L5 W9):按片段播放(不静音、1.0 倍速),自己的句子加强显示。
 * roleName 是调用方已经算好的显示名(「红·Alex」);role 可选,有就在名字前画色点。
 * 「开始录制」在点按的同一个事件里调用 onStart(手势保留,iOS 需要)。
 */
export function RehearsalView({
  role, roleName, lines, onRehearse, onStart, onBack,
}: {
  role?: RoleKey;
  roleName: string;
  lines: readonly RehearsalLine[];
  onRehearse(): void;
  onStart(): void;
  onBack(): void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button type="button" onClick={onBack} className="text-[13px] opacity-80">{t("web.dubbing.rehearsal.back")}</button>
        <p className="flex items-center gap-2 text-[14px] font-semibold">
          {role ? <RoleDot role={role} /> : null}
          {t("web.dubbing.rehearsal.youAre", { role: roleName })}
        </p>
        <span className="w-10" />
      </div>
      <HeadphoneHint />
      <ol className="space-y-1.5">
        {lines.map((line) => (
          <li
            key={line.idx}
            data-mine={line.mine ? "true" : "false"}
            className={`rounded-xl px-3 py-2 text-[14px] ${line.mine ? "bg-white/25 font-semibold" : "bg-white/10 opacity-80"}`}
          >
            {line.text}
          </li>
        ))}
      </ol>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onRehearse} className="rounded-2xl bg-white/15 py-3 text-[14px]">
          {t("web.dubbing.rehearsal.play")}
        </button>
        <button type="button" onClick={onStart} className="rounded-2xl bg-white/35 py-3 text-[15px] font-semibold">
          {t("web.dubbing.rehearsal.record")}
        </button>
      </div>
    </div>
  );
}
