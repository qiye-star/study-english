import { KeyboardIcon, GalleryVerticalEndIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconChip } from "~/components/icon-chip";
import { ListRow, SectionGroup } from "~/components/section-group";
import { PageHeader } from "~/layout/page-header";

/** 拼写入口页(计划 2026-10-27 R-W1 / R-W2):两项,分别是例句拼写与单词拼写。 */
export function WordbookSpellHubPage() {
  const { t } = useTranslation();
  return (
    <div data-testid="wordbook-spell-hub" className="flex flex-1 flex-col">
      <PageHeader title={t("web.wordbook.home.spell")} back="/wordbook" />
      <div className="px-4 pb-8">
        <SectionGroup title={t("web.wordbook.home.spell")} bare>
          <ListRow icon={<IconChip tone="amber" icon={KeyboardIcon} />} title={t("web.wordbook.spellHub.sentences")}
            testId="wordbook-spell-sentences" subtitle={t("web.wordbook.spellHub.sentencesHint")} to="/wordbook/spell/sentences" />
          <ListRow icon={<IconChip tone="teal" icon={GalleryVerticalEndIcon} />} title={t("web.wordbook.spellHub.words")}
            testId="wordbook-spell-words" subtitle={t("web.wordbook.spellHub.wordsHint")} to="/wordbook/spell/words" />
        </SectionGroup>
      </div>
    </div>
  );
}
