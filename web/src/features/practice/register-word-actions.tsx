// 只被 web/src/plugins/word-actions 导入(architecture.test.ts):「单词操作」面板里的「跟读这个词」一行(spec §6.1)。
import { MicIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { IconChip } from "~/components/icon-chip";
import { ListRow } from "~/components/section-group";
import { contribute, type PointProps } from "~/lib/extension-points";
import { goPractice } from "./save-practice-item";

/** 有例句时跟读例句,否则跟读词本身;先关面板再跳到跟读页(预填参考文本)。 */
export function ShadowRow({ target, close }: PointProps["wordActionsMenu"]) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <ListRow testId="word-actions-shadow" icon={<IconChip tone="blue" icon={MicIcon} />}
      title={t("web.links.wordActions.shadow")} subtitle={t("web.links.wordActions.shadowHint")}
      onClick={() => { close(); goPractice(navigate, target.example ?? target.word); }} />
  );
}

contribute({ point: "wordActionsMenu", id: "practice.shadow", order: 20, link: "word_actions", component: ShadowRow });
