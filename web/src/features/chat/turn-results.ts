import type { ApiClient } from "~/api/client";
import { assessPronunciation, briefWords, deleteAssessment } from "~/features/practice/assessment-api";
import { patchMessage, type MessageResultFields } from "./chat-api";
import { cachedGrammar, MAX_GRAMMAR_TEXT } from "~/features/grammar/grammar-api";
import type { GrammarResult } from "~/features/grammar/grammar-types";
import { checkability, isAssessable } from "./english-check";
import type { UiMessage } from "./ui-message";

export const MAX_ASSESSMENT_REFERENCE = 2000;

export type TurnChange = Partial<Pick<UiMessage, "assessment" | "assessmentId" | "grammar">>;

/** R21:语音消息也做语法检查。Task 5.2 的实测若触发降级(Task 5.3),改为 false。 */
export const GRAMMAR_FOR_VOICE = true;

export interface TurnInput {
  text: string;
  /** 语音消息的 16 kHz WAV;文字消息不带(此时只做语法检查,不评测) */
  wav?: Blob;
  /** 会话开着"语法检查"时传 enabled: true;context 是上一条 AI 回复(取末尾 500 字由 checkGrammar 处理) */
  grammar?: { enabled: boolean; context: string };
}

type Phase = "open" | "saving" | "saved" | "abandoned";

interface Turn {
  phase: Phase;
  messageId?: string;
  assessmentId?: string;
  assessmentSent: boolean;
  grammarInput?: { text: string; context: string };
  grammar?: GrammarResult;
  grammarSent: boolean;
  /** 语法请求的等待;abandon/forget 时中止(语法没有服务端记录,无需清理) */
  grammarController?: AbortController;
  /** 补写串行化:同一时刻只有一个 PATCH 在途 */
  flushChain?: Promise<void>;
  /** forget():不再跟踪,也不删除评测(它可能已链接到已保存的消息) */
  forgotten?: boolean;
}

/**
 * 一轮用户消息的附加结果的账本(不依赖 React;计划裁定 R2–R4):
 * - start():转写/文字一到就并行发起,不阻塞回复;同一 key 只发起一次,重试回复不重复花钱。
 * - fieldsForSave():保存消息对时取走已到达的结果,随用户消息一起保存。
 * - saved():保存成功后,把保存时还没到、或保存途中才到的结果 PATCH 补写。
 * - abandon():这一轮不会被保存。对话评测不中止(中止不能保证服务端没保存),跑完后删除。
 * - saveFailed():保存失败,轮次回到 open(结果保留、不删除),用同一 key 重试保存即可,结果随重试附上。
 * - 语法检查(英文文字/转写,会话开启时)与回复、评测并行;结果随保存发出或补写(与评测同一个串行 PATCH);abandon/forget 中止其等待(无服务端记录);失败 -> status error,界面可调 retryGrammar。
 * onChange 只用于更新界面,页面负责在卸载后忽略它。
 *
 * 调用方约定:
 * 0. key 每轮唯一、永不复用(start() 会忽略已知 key)。
 * 1. 每个 start 过的 key 最终必须以 saved()、abandon() 或 forget() 结束。abandonOpen 只处理 open 状态:
 *    卸载时仍在 saving 的轮次,必须先以 saved() 或 saveFailed() 收尾,再 abandonOpen。
 * 2. 保存失败时调用 saveFailed(key),重试时用同一个 key 再 fieldsForSave/saved;不要换 key,也不要 abandon。
 *    保存请求"服务端成功但响应丢了"时,重试会因同一 assessment_id 得到 409(Assessment already linked):
 *    此时不得 abandon(会删除已链接到已保存消息的评测)。应重新加载会话消息:若这一对已在,用已有消息 id 调
 *    saved(key, existingId);映射不了就 forget(key);否则(确实没保存)去掉 assessment_id 重试保存,并 forget(key)
 *    ——评测保持原样,服务端若已有链接则已经在那里。forget 不删除评测,之后到达的结果被静默忽略。
 * 3. abandonOpen() 放在 effect 清理里(卸载/切换会话)。
 * 4. 实例在 effect/ref 中创建,StrictMode 重新挂载时才不会复用已 abandon 的实例。
 * 5. 卸载后忽略 onChange(本类不感知 React)。
 * 已保存的轮次条目保留在 Map 里(很小),用来保证同一 key 只发起一次评测;随实例一起回收。
 */
export class TurnResults {
  private readonly turns = new Map<string, Turn>();

  constructor(
    private readonly api: ApiClient,
    private readonly onChange: (userKey: string, change: TurnChange) => void,
  ) {}

  start(userKey: string, input: TurnInput): void {
    if (this.turns.has(userKey)) return;
    const turn: Turn = { phase: "open", assessmentSent: false, grammarSent: false };
    this.turns.set(userKey, turn);
    if (input.wav) this.startAssessment(userKey, turn, input.text, input.wav);
    const wantGrammar =
      input.grammar?.enabled && (!input.wav || GRAMMAR_FOR_VOICE) && input.text.length <= MAX_GRAMMAR_TEXT && checkability(input.text).ok;
    if (wantGrammar) {
      turn.grammarInput = { text: input.text, context: input.grammar!.context };
      this.runGrammar(userKey, turn);
    }
  }

  /** 语法检查失败后由界面的"重试"按钮调用。 */
  retryGrammar(userKey: string): void {
    const turn = this.turns.get(userKey);
    if (!turn || !turn.grammarInput || turn.grammar || turn.phase === "abandoned") return;
    this.runGrammar(userKey, turn);
  }

  private runGrammar(userKey: string, turn: Turn): void {
    const input = turn.grammarInput!;
    turn.grammarController?.abort();
    const controller = new AbortController();
    turn.grammarController = controller;
    this.onChange(userKey, { grammar: { status: "pending" } });
    cachedGrammar(this.api, input, controller.signal)
      .then(
        (result) => {
          if (controller.signal.aborted || turn.phase === "abandoned") return;
          turn.grammar = result;
          // 先补写再通知界面:onChange 抛错不能跳过 PATCH
          if (turn.phase === "saved") void this.flush(turn);
          this.onChange(userKey, { grammar: { status: "done", result } });
        },
        (error: unknown) => {
          if (controller.signal.aborted || turn.phase === "abandoned") return;
          this.onChange(userKey, { grammar: { status: "error", error } });
        },
      )
      .catch(() => {
        // onChange 抛错不应变成未处理的 rejection
      });
  }

  private startAssessment(userKey: string, turn: Turn, text: string, wav: Blob): void {
    if (!isAssessable(text)) {
      this.onChange(userKey, { assessment: { status: "skipped", reason: "non-english" } });
      return;
    }
    if (text.length > MAX_ASSESSMENT_REFERENCE) {
      this.onChange(userKey, { assessment: { status: "skipped", reason: "too-long" } });
      return;
    }
    this.onChange(userKey, { assessment: { status: "pending" } });
    assessPronunciation(this.api, { wav, reference: text, language: "en-US", save: true, source: "chat" })
      .then(
      (res) => {
        turn.assessmentId = res.assessmentId;
        if (turn.forgotten) return;
        if (turn.phase === "abandoned") {
          void this.discardAssessment(turn);
          return;
        }
        // 先补写再通知界面:onChange 抛错不能跳过 PATCH
        if (turn.phase === "saved") void this.flush(turn);
        this.onChange(userKey, {
          assessmentId: res.assessmentId ?? null,
          assessment: {
            status: "done",
            scores: {
              pronunciationScore: res.pronunciationScore,
              accuracyScore: res.accuracyScore,
              fluencyScore: res.fluencyScore,
              completenessScore: res.completenessScore,
            },
            words: briefWords(res.detailResult?.words),
          },
        });
      },
      (error) => {
        if (turn.phase !== "abandoned") this.onChange(userKey, { assessment: { status: "error", error } });
      },
    )
      .catch(() => {
        // onChange/解析抛错不应变成未处理的 rejection;assessmentId 已记录,清理仍有效
      });
  }

  fieldsForSave(userKey: string): MessageResultFields {
    const turn = this.turns.get(userKey);
    if (!turn || turn.phase !== "open") return {};
    turn.phase = "saving";
    const fields: MessageResultFields = {};
    if (turn.assessmentId) {
      fields.assessmentId = turn.assessmentId;
      turn.assessmentSent = true;
    }
    if (turn.grammar) {
      fields.grammar = turn.grammar;
      turn.grammarSent = true;
    }
    return fields;
  }

  /** 保存失败(将用同一 key 重试):回到 open,结果保留且不删除。 */
  saveFailed(userKey: string): void {
    const turn = this.turns.get(userKey);
    if (!turn || turn.phase !== "saving") return;
    turn.phase = "open";
    turn.assessmentSent = false;
    turn.grammarSent = false;
  }

  saved(userKey: string, messageId: string): Promise<void> {
    const turn = this.turns.get(userKey);
    if (!turn || turn.phase === "abandoned" || turn.phase === "saved") return Promise.resolve();
    turn.phase = "saved";
    turn.messageId = messageId;
    return this.flush(turn);
  }

  abandon(userKey: string): void {
    const turn = this.turns.get(userKey);
    if (!turn || turn.phase === "saved" || turn.phase === "abandoned") return;
    turn.phase = "abandoned";
    turn.grammarController?.abort();
    void this.discardAssessment(turn);
  }

  /** 停止跟踪这一轮,但不删除评测(它可能已链接到已保存的消息);之后到达的结果被忽略。 */
  forget(userKey: string): void {
    const turn = this.turns.get(userKey);
    if (!turn) return;
    turn.forgotten = true;
    turn.phase = "abandoned";
    turn.grammarController?.abort();
  }

  /** 卸载/切换会话:还没开始保存的轮次(流式中、失败待重试)都不会再被保存。 */
  abandonOpen(): void {
    for (const [key, turn] of this.turns) if (turn.phase === "open") this.abandon(key);
  }

  private flush(turn: Turn): Promise<void> {
    // 串行:字段在轮到本次时才收集,在途 PATCH 期间到达的结果合并进下一次
    const next = (turn.flushChain ?? Promise.resolve()).then(() => this.doFlush(turn));
    turn.flushChain = next;
    return next;
  }

  private async doFlush(turn: Turn): Promise<void> {
    if (!turn.messageId) return;
    const fields: MessageResultFields = {};
    if (turn.assessmentId && !turn.assessmentSent) {
      fields.assessmentId = turn.assessmentId;
      turn.assessmentSent = true;
    }
    if (turn.grammar && !turn.grammarSent) {
      fields.grammar = turn.grammar;
      turn.grammarSent = true;
    }
    if (!Object.keys(fields).length) return;
    try {
      await patchMessage(this.api, turn.messageId, fields);
    } catch {
      // 结果是附加信息:补写失败不影响对话
    }
  }

  private async discardAssessment(turn: Turn): Promise<void> {
    const id = turn.assessmentId;
    if (!id) return; // 还在路上:到达时 phase 已是 abandoned,会再进来
    turn.assessmentId = undefined;
    try {
      await deleteAssessment(this.api, id);
    } catch {
      // 删除失败静默忽略
    }
  }
}
