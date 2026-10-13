// 只被 web/src/plugins/ 导入(architecture.test.ts):选词操作条的「朗读」(spec 2026-10-13 §3.3)。核心贡献:无联动键,永远可见。
import { contribute } from "~/lib/extension-points";
import { ReadAloudAction } from "./read-aloud-action";

contribute({ point: "selectionActions", id: "chat.read-aloud", order: 0, component: ReadAloudAction });
