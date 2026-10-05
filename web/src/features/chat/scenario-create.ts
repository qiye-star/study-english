import type { ApiClient } from "~/api/client";
import {
  createConversation, createMessages, deleteConversation, isAmbiguousSaveError, listMessages,
  type Conversation, type ScenarioRef,
} from "./chat-api";
import type { Level } from "./levels";
import { scenarioOpening } from "./scenarios";

export interface ScenarioChoice {
  scenario: ScenarioRef;
  level: Level;
  name: string;
}

/** 一次创建的进度:重试时跳过已完成的步骤(R10)。 */
export interface CreationProgress {
  conversation?: Conversation;
  /** 上次保存开场白的失败"可能已保存":重试前先核对服务端 */
  ambiguous?: boolean;
  /** 会话已建好但开场白还没保存 */
  openingPending?: boolean;
}

export class OpeningNotSavedError extends Error {
  constructor(readonly cause: unknown) {
    super("Opening line not saved");
  }
}

export async function runScenarioCreation(
  api: ApiClient, choice: ScenarioChoice, progress: CreationProgress,
): Promise<{ conversation: Conversation; openingId: string | null }> {
  // R2:只写场景与难度;模型、音色、系统提示词在运行时取服务端默认值
  progress.conversation ??= await createConversation(api, { name: choice.name, config: { scenario: choice.scenario, level: choice.level } });
  const conversation = progress.conversation;
  const opening = scenarioOpening(choice.scenario);
  if (!opening) return { conversation, openingId: null };
  progress.openingPending = true;
  try {
    if (progress.ambiguous) {
      const { messages } = await listMessages(api, conversation.id);
      const stored = messages.find((m) => m.role === "assistant");
      if (stored) {
        progress.openingPending = false;
        return { conversation, openingId: stored.id };
      }
    }
    const { messages } = await createMessages(api, conversation.id, [{ role: "assistant", content: opening }]);
    progress.openingPending = false;
    return { conversation, openingId: messages[0]?.id ?? null };
  } catch (err) {
    progress.ambiguous = !!progress.ambiguous || isAmbiguousSaveError(err);
    throw new OpeningNotSavedError(err);
  }
}

/** 开场白没保存成功就放弃:尽力删掉这个空会话,失败静默(R10)。 */
export async function discardUnfinished(api: ApiClient, progress: CreationProgress): Promise<void> {
  const conversation = progress.conversation;
  if (!conversation || !progress.openingPending) return;
  await deleteConversation(api, conversation.id).catch((): void => undefined);
}
