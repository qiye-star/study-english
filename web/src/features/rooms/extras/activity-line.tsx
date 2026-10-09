import { MicIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RoomMemberInfo } from "../protocol";
import type { RoomState } from "../room-state";

type Active = { name: string; state: "typing" | "recording" };

/**
 * 输入条之上一行 12px 次要色「lily 正在输入…」/「bob 正在说话…」(spec §6.5,视觉稿 V12 .act):不含自己、按收到时间新到旧;
 * 两人同状态「lily、bob 正在输入…」,状态不同时分别列出;三人及以上「lily、bob 等 3 人正在输入…」(最多两个名字)。
 * 过期(6 秒)由 reducer 的 activity_expire 处理。不是 live 区域:这是环境信息,读屏只播报消息(review m5)。说话时前面是蓝色话筒,输入时是三个点。
 */
export function ActivityLine({ activity, members, meId }: {
  activity: RoomState["activity"]; members: RoomMemberInfo[]; meId: number | null;
}): JSX.Element | null {
  const { t } = useTranslation();
  const names = new Map(members.map((m) => [m.userId, m.name]));
  const active: Active[] = Object.entries(activity)
    .map(([id, a]) => ({ id: Number(id), ...a }))
    .filter((a) => a.id !== meId && (a.state === "typing" || a.state === "recording"))
    .sort((a, b) => b.at - a.at)
    .map((a) => ({ name: names.get(a.id) ?? t("web.rooms.extras.activity.someone"), state: a.state as Active["state"] }));
  if (!active.length) return null;

  const verb = (s: Active["state"]) => (s === "recording" ? "speaking" : "typing");
  const k = (key: string) => `web.rooms.extras.activity.${key}`;
  let text: string;
  const [a, b] = active;
  if (active.length === 1) text = t(k(`${verb(a.state)}One`), { name: a.name });
  else if (active.length === 2 && a.state !== b.state) {
    text = [t(k(`${verb(a.state)}One`), { name: a.name }), t(k(`${verb(b.state)}One`), { name: b.name })].join(t(k("sep")));
  } else {
    const same = active.every((x) => x.state === a.state);
    const v = same ? verb(a.state) : "mixed";
    text = active.length === 2
      ? t(k(`${v}Two`), { a: a.name, b: b.name })
      : t(k(`${v}Many`), { a: a.name, b: b.name, count: active.length, others: active.length - 2 });
  }
  const speaking = active.some((x) => x.state === "recording");
  return (
    <div data-testid="room-activity" className="flex min-w-0 items-center gap-1.5 px-1.5 pb-[7px] text-meta text-ink-2">
      {speaking ? (
        <MicIcon aria-hidden className="size-3.5 flex-none text-blue" />
      ) : (
        <span aria-hidden className="inline-flex flex-none gap-0.5">
          <i className="block size-1 rounded-full bg-ink-3" /><i className="block size-1 rounded-full bg-ink-3" /><i className="block size-1 rounded-full bg-ink-3" />
        </span>
      )}
      <span className="min-w-0 truncate">{text}</span>
    </div>
  );
}
