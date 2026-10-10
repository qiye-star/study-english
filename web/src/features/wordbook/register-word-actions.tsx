// 只被 web/src/plugins/word-actions 导入(architecture.test.ts):「单词操作」面板里词书的两行(spec §6.1)。
// 背单词关闭(或配置还没拿到)时两行都不出现。
import { contribute, type PointProps } from "~/lib/extension-points";
import { AdoptRow, CardRow } from "./link-actions";
import { useWordbookEnabled } from "./use-wordbook-config";

function WordbookAdoptRow(props: PointProps["wordActionsMenu"]) {
  return useWordbookEnabled() ? <AdoptRow {...props} /> : null;
}

function WordbookCardRow(props: PointProps["wordActionsMenu"]) {
  return useWordbookEnabled() ? <CardRow {...props} /> : null;
}

contribute({ point: "wordActionsMenu", id: "wordbook.adopt", order: 10, link: "word_actions", component: WordbookAdoptRow });
contribute({ point: "wordActionsMenu", id: "wordbook.card", order: 30, link: "word_actions", component: WordbookCardRow });
