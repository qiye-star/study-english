import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { cn } from "~/lib/cn";
import type { StageTask, StageTaskKind } from "./rank-api";
import { CARD } from "./ui";

/** 未完成的任务点按跳到对应练习页(spec §10.2)。 */
const ROUTES: Record<StageTaskKind, string> = {
  assess: "/practice", chat_turns: "/chat", voice_turns: "/chat", vocab_reviews: "/vocabulary", active_days: "/practice",
};

export function StageTasks({ tasks }: { tasks: StageTask[] }) {
  const { t } = useTranslation();
  return (
    <ul className={cn("divide-y-[0.5px] divide-hair-2 overflow-hidden", CARD)}>
      {tasks.map((task) => {
        const label = task.kind === "assess" && task.minScore !== null
          ? t("web.rank.tasks.assessMin", { target: task.target, minScore: task.minScore })
          : t(`web.rank.tasks.${task.kind}`, { target: task.target });
        const body = (
          <>
            <span aria-hidden className={cn("flex size-6 flex-none items-center justify-center rounded-full", task.complete ? "bg-blue text-on-blue" : "bg-surface-2")}>
              {task.complete && <CheckIcon className="size-[15px]" strokeWidth={2.5} />}
            </span>
            <span className="min-w-0 flex-1 text-body">{label}</span>
            <span className="text-meta tabular-nums text-ink-2">{t("web.rank.tasks.progress", { done: task.done, target: task.target })}</span>
            {!task.complete && <ChevronRightIcon aria-hidden className="size-[18px] flex-none text-ink-3" />}
          </>
        );
        return (
          <li key={task.key} data-testid="stage-task" data-complete={String(task.complete)}>
            {task.complete ? (
              <div className="flex min-h-[52px] items-center gap-3 px-3.5 py-2">{body}</div>
            ) : (
              <Link to={ROUTES[task.kind] ?? "/practice"}
                className="flex min-h-row items-center gap-3 py-2 pl-3.5 pr-3 transition-colors duration-fast active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                {body}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
