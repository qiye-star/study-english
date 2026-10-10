// 只被 web/src/plugins/ 导入(architecture.test.ts):登记 vocabulary 的扩展点贡献。
import { contribute } from "~/lib/extension-points";
import { AddVocabularyAction } from "./word-action";

contribute({ point: "wordActions", id: "vocabulary.add", order: 0, component: AddVocabularyAction });
