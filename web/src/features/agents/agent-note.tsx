import "./locales";
import { useTranslation } from "react-i18next";
import { ZhNoteFold } from "~/components/zh-note-fold";

export interface AgentNoteProps {
  text: string;
  testId?: string;
}

/** 对话气泡里的「中文」折叠(done.note_zh / agent_trace.note_zh,R-AW10):文案随 agents 的懒加载块并入。 */
export function AgentNote({ text, testId = "agent-note" }: AgentNoteProps) {
  const { t } = useTranslation();
  return <ZhNoteFold text={text} showLabel={t("web.agents.note.show")} hideLabel={t("web.agents.note.hide")} testId={testId} className="mt-1" />;
}
