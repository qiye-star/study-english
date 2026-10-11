// 只被 web/src/plugins/word-actions 导入(architecture.test.ts):「单词操作」面板里的「加入词汇本」一行(spec §6.1)。
import { BookCheckIcon, BookPlusIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconChip } from "~/components/icon-chip";
import { ListRow } from "~/components/section-group";
import { useAuth } from "~/auth/auth-context";
import { contribute, type PointProps } from "~/lib/extension-points";
import { saveVocabularyItem } from "./save-vocabulary-item";

/** 与主按钮同一条保存路径(去重 / toast / 错误翻译);成功后整行变为「已在词汇本中」且不可再点。 */
export function AddRow({ target }: PointProps["wordActionsMenu"]) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const save = async () => {
    if (busy.current) return;
    busy.current = true;
    setState("saving");
    const ok = await saveVocabularyItem(api, t, target);
    busy.current = false;
    if (mounted.current) setState(ok ? "saved" : "idle");
  };
  const saved = state === "saved";
  return (
    <ListRow testId="word-actions-add" icon={<IconChip tone="teal" icon={saved ? BookCheckIcon : BookPlusIcon} />}
      title={t("web.links.wordActions.add")} subtitle={t("web.links.wordActions.addHint")}
      {...(saved ? { value: t("web.links.wordActions.inVocabulary"), chevron: false } : { onClick: () => void save() })}
      className={state === "saving" ? "opacity-60" : undefined} />
  );
}

contribute({ point: "wordActionsMenu", id: "vocabulary.add", order: 0, link: "word_actions", component: AddRow });
