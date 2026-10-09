import { ArrowRightIcon, LoaderIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "~/auth/auth-context";
import { AddVocabularyButton } from "~/features/vocabulary";
import { PageHeader } from "~/layout/page-header";
import { cn } from "~/lib/cn";
import type { RoomInfo } from "../protocol";
import { fetchRoomsConfig, getRoom, type RoomsConfig } from "../rooms-api";
import { ghostButton } from "../ui";
import type { RoomSummaryView } from "./summary-api";
import { useRoomSummary } from "./use-room-summary";

const list = "overflow-hidden rounded-card bg-surface shadow-hair";
const badge = "inline-flex h-5 items-center rounded-[7px] px-[7px] text-label font-semibold whitespace-nowrap";
const REASONS = new Set(["few_messages", "disabled", "quota"]);

function SectionTitle({ children, extra }: { children: string; extra?: ReactNode }) {
  return (
    <h2 className="mx-0.5 mb-2 mt-section flex items-center justify-between text-sub font-semibold tracking-[0.01em] text-ink-2">
      <span>{children}</span>{extra}
    </h2>
  );
}

function Done({ summary, room, config }: { summary: RoomSummaryView; room: RoomInfo | null; config: RoomsConfig | null }) {
  const { t, i18n } = useTranslation();
  const scenario = room ? config?.scenarios?.find((s) => s.key === room.scenario) : undefined;
  const scenarioName = scenario ? (i18n.language.startsWith("zh") ? scenario.titleZh : scenario.titleEn) : null;
  return (
    <>
      <section className={cn(list, "p-3.5")}>
        {room && (scenarioName || room.level) && (
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {room.memberCount > 0 && <span className={cn(badge, "bg-surface-2 tabular-nums text-ink-2")}>{t("web.rooms.extras.summary.people", { count: room.memberCount })}</span>}
            <span className={cn(badge, "bg-blue-tint text-blue")}>{[scenarioName, room.level].filter(Boolean).join(" · ")}</span>
          </div>
        )}
        <p className="whitespace-pre-wrap text-body leading-[1.55] text-ink">{summary.overviewZh}</p>
      </section>
      {summary.myFixes.length > 0 && (
        <>
          <SectionTitle extra={<span className={cn(badge, "bg-surface-2 text-ink-2")}>{t("web.rooms.extras.summary.onlyYou")}</span>}>
            {t("web.rooms.extras.summary.fixesTitle")}
          </SectionTitle>
          <ul className={list}>
            {summary.myFixes.map((f) => (
              <li key={f.seq} className="px-3.5 py-3 [&+&]:border-t-[0.5px] [&+&]:border-hair-2">
                <p className="text-sub leading-[1.45] text-ink-2">{f.original}</p>
                <p className="mt-[3px] flex gap-1.5 text-body font-medium leading-[1.45] text-ink">
                  <ArrowRightIcon aria-hidden className="mt-[3px] size-4 flex-none text-blue" />
                  <span className="min-w-0">{f.better}</span>
                </p>
                {f.noteZh && <p className="mt-[3px] text-meta text-ink-2">{f.noteZh}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
      {summary.words.length > 0 && (
        <>
          <SectionTitle extra={<span className="font-medium tabular-nums">{summary.words.length}</span>}>{t("web.rooms.extras.summary.wordsTitle")}</SectionTitle>
          <ul className={list}>
            {summary.words.map((w, i) => (
              <li key={`${w.en}-${i}`} data-testid={`summary-word-${i}`} className="flex items-center gap-2.5 py-2.5 pl-3.5 pr-2 [&+&]:border-t-[0.5px] [&+&]:border-hair-2">
                <div className="min-w-0 flex-1">
                  <p className="text-body font-semibold text-ink">{w.en}<small className="ml-1.5 text-sub font-medium text-ink-2">{w.zh}</small></p>
                  {w.example && <p className="mt-0.5 text-meta text-ink-2">{w.example}</p>}
                </div>
                {/* 青色 = 词汇(redesign-v3 一色一义);已加入后按钮自己变灰勾 */}
                <span className="flex-none [&_button:not(:disabled)]:text-teal">
                  <AddVocabularyButton testId={`summary-word-add-${i}`} input={{ word: w.en, meaning: w.zh, example: w.example, source: "recap" }} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/**
 * 房间学习小结 /rooms/r/:roomId/summary(spec §6.1,视觉稿 V10):顶栏「学习小结」+ 房间名;概述卡;「可以说得更好」(仅本人,
 * 原句次要色 → 更好的说法墨色 500 + 中文说明;不用红/绿批改色);「新词」每行英文 + 中文 + 例句,右侧青色「加入词汇本」;
 * 生成中 / 失败(重试)/ 跳过 / 房间未结束 各有状态。
 */
export function RoomSummaryPage() {
  const { roomId = "" } = useParams();
  const { api } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { summary, error, timedOut, retrying, retry } = useRoomSummary(roomId);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [config, setConfig] = useState<RoomsConfig | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    getRoom(api, roomId, ctrl.signal).then((r) => setRoom(r.room), (): void => undefined);
    fetchRoomsConfig(api, ctrl.signal).then(setConfig, (): void => undefined);
    return () => ctrl.abort();
  }, [api, roomId]);

  const name = room?.name || room?.topic;
  const subtitle = name ? t("web.rooms.extras.summary.subtitle", { name }) : undefined;
  const status = (text: string, spin = false) => (
    <p role="status" className="flex items-center justify-center gap-2 py-16 text-center text-sub text-ink-2">
      {spin && <LoaderIcon aria-hidden className="size-4 flex-none animate-spin" />}{text}
    </p>
  );
  let body: ReactNode;
  if (error) body = status(error);
  else if (!summary) body = status(t("web.common.loading"), true);
  else if (summary.status === "done") body = <Done summary={summary} room={room} config={config} />;
  else if (summary.status === "pending") body = status(timedOut ? t("web.rooms.extras.summary.later") : t("web.rooms.extras.summary.pending"), !timedOut);
  else if (summary.status === "failed") {
    body = (
      <div className="py-12 text-center">
        <p className="text-sub text-ink-2">{t("web.rooms.extras.summary.failed")}</p>
        <button type="button" disabled={retrying} className={cn(ghostButton, "mt-4")} onClick={retry}>{t("web.common.retry")}</button>
      </div>
    );
  } else {
    const reason = summary.reason && REASONS.has(summary.reason) ? summary.reason : "none";
    body = status(t(`web.rooms.extras.summary.skipped.${reason}`));
  }

  return (
    <>
      <PageHeader title={t("web.rooms.extras.summary.title")} subtitle={subtitle} back={`/rooms/r/${encodeURIComponent(roomId)}`} />
      <div className="px-gutter pb-10 pt-1">
        {body}
        <button type="button" className={cn(ghostButton, "mt-[18px]")} onClick={() => navigate(`/rooms/r/${encodeURIComponent(roomId)}`)}>
          {t("web.rooms.extras.summary.backToChat")}
        </button>
      </div>
    </>
  );
}
