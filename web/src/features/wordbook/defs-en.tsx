import { useTranslation } from "react-i18next";
import { cn } from "@renderer/lib/utils";
import { lookupContext } from "~/lib/lookup-context";
import type { DefGroup } from "./def-lang";
import "./locales";

/**
 * 英文释义行(spec 2026-10-12-wordbook-definitions §5):每个词性一行,小号 `text-ink-2`,整行 `lang="en"`
 * (词性标签与释义同属英文,读屏换英文声音)。同一词性的两条用「; 」连成一段。参考释义:列表带无障碍名称「英文释义(参考)」。
 */
export function DefinitionsEn({ groups, className }: { groups: readonly DefGroup[]; className?: string }) {
  const { t } = useTranslation();
  return (
    <ul data-testid="word-defs-en" aria-label={t("web.wordbookDefs.label")} className={cn("flex flex-col gap-1", className)}>
      {groups.map((g) => (
        <li key={g.pos} lang="en" {...lookupContext} className="text-sub leading-dialogue text-ink-2">
          <em className="mr-1 font-mono text-meta font-semibold not-italic">{g.label}</em>{" "}
          <span className="break-words">{g.texts.join("; ")}</span>
        </li>
      ))}
    </ul>
  );
}
