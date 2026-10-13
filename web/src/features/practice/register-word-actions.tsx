// 只被 web/src/plugins/word-actions 导入(architecture.test.ts):「单词操作」面板里的「跟读这个词」一行(spec §6.1)。
import { MicIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconChip } from "~/components/icon-chip";
import { ListRow } from "~/components/section-group";
import { contribute, type PointProps } from "~/lib/extension-points";
import { useShadowSheet } from "./shadow/shadow-context";

/** 有例句时跟读例句,否则跟读词本身;先关面板(查词抽屉由 LookupLayer 在弹窗打开时收起),再在原地打开跟读弹窗(R-S21)。 */
export function ShadowRow({ target, close }: PointProps["wordActionsMenu"]) {
  const { t } = useTranslation();
  const { open } = useShadowSheet();
  return (
    <ListRow testId="word-actions-shadow" icon={<IconChip tone="blue" icon={MicIcon} />}
      title={t("web.links.wordActions.shadow")} subtitle={t("web.links.wordActions.shadowHint")}
      onClick={() => { close(); open({ text: target.example ?? target.word, source: target.source === "lookup" ? "lookup" : "manual" }); }} />
  );
}

contribute({ point: "wordActionsMenu", id: "practice.shadow", order: 20, link: "word_actions", component: ShadowRow });
