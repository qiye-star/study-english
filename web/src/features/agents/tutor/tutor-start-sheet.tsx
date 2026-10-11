import "./locales";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@renderer/components/ui/button";
import { cn } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { BottomSheet, BottomSheetContent, BottomSheetHeader } from "~/components/bottom-sheet";
import { SegmentedControl } from "~/components/segmented-control";
import {
  TUTOR_LENGTHS, TUTOR_SCENARIOS, TUTOR_SERVER_ERRORS, TUTOR_TOPICS, startTutor,
  type TutorGoalInput, type TutorInput, type TutorScenario, type TutorTopic,
} from "./tutor-api";
import { needsAgentTurn } from "./tutor-model";

export interface TutorStartSheetViewProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  busy: boolean;
  onStart(goal: TutorGoalInput): void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-meta font-semibold text-ink-2">{label}</span>
      {children}
    </div>
  );
}

const choice = (on: boolean) => cn(
  "min-h-tap rounded-button border-[0.5px] px-3 py-1.5 text-left transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  on ? "border-blue bg-blue-tint text-blue" : "border-hair bg-surface text-ink hover:bg-surface-2",
);

/** 「带我学」开始面板:主题(四选一,场景再选一个)、题数 5 / 8 / 12、回答方式打字 / 语音。 */
export function TutorStartSheetView({ open, onOpenChange, busy, onStart }: TutorStartSheetViewProps) {
  const { t } = useTranslation();
  const [topic, setTopic] = useState<TutorTopic>("free");
  const [scenario, setScenario] = useState<TutorScenario>("restaurant");
  const [length, setLength] = useState("8");
  const [input, setInput] = useState<TutorInput>("text");
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent data-testid="tutor-start-sheet" className="max-h-[85dvh] overflow-y-auto">
        <BottomSheetHeader title={t("web.agents.tutor.start.title")} description={t("web.agents.tutor.start.description")} />
        <div className="flex flex-col gap-4">
          <Field label={t("web.agents.tutor.start.topic")}>
            <div className="grid grid-cols-2 gap-2">
              {TUTOR_TOPICS.map((v) => (
                <button key={v} type="button" aria-pressed={topic === v} data-testid={`tutor-topic-${v}`} onClick={() => setTopic(v)} className={choice(topic === v)}>
                  <span className="block text-body font-semibold">{t(`web.agents.tutor.topic.${v}`)}</span>
                  <span className="block text-meta text-ink-2">{t(`web.agents.tutor.topicHint.${v}`)}</span>
                </button>
              ))}
            </div>
          </Field>
          {topic === "scenario" ? (
            <Field label={t("web.agents.tutor.start.scenario")}>
              <div className="flex flex-wrap gap-2">
                {TUTOR_SCENARIOS.map((v) => (
                  <button key={v} type="button" aria-pressed={scenario === v} data-testid={`tutor-scenario-${v}`} onClick={() => setScenario(v)}
                    className={cn(choice(scenario === v), "rounded-full text-sub")}>
                    {t(`web.agents.tutor.scenarioName.${v}`)}
                  </button>
                ))}
              </div>
            </Field>
          ) : null}
          <Field label={t("web.agents.tutor.start.length")}>
            <SegmentedControl label={t("web.agents.tutor.start.length")} value={length} onChange={setLength}
              options={TUTOR_LENGTHS.map((n) => ({ value: String(n), label: t("web.agents.tutor.start.lengthOption", { count: n }), testId: `tutor-length-${n}` }))} />
          </Field>
          <Field label={t("web.agents.tutor.start.input")}>
            <SegmentedControl<TutorInput> label={t("web.agents.tutor.start.input")} value={input} onChange={setInput}
              options={[
                { value: "text", label: t("web.agents.tutor.start.typing"), testId: "tutor-input-text" },
                { value: "voice", label: t("web.agents.tutor.start.voice"), testId: "tutor-input-voice" },
              ]} />
          </Field>
          <Button data-testid="tutor-start" className="min-h-tap w-full" disabled={busy}
            onClick={() => onStart({ topic, scenario: topic === "scenario" ? scenario : null, length: Number(length), input })}>
            {t("web.agents.tutor.start.go")}
          </Button>
          <p className="text-meta text-ink-2">{t("web.agents.tutor.start.note")}</p>
        </div>
      </BottomSheetContent>
    </BottomSheet>
  );
}

export interface TutorStartInfo {
  /** 回答方式(续上的会话取它原来的选择) */
  input: TutorInput;
  /** 智能体要先开口(开场 / 出下一题):对话页随即发一个 text = null 的回合;续上等待回答的会话为 false */
  speakFirst: boolean;
}
export interface TutorStartSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  personaId: string;
  conversationId: string;
  onStarted(sessionId: string, info: TutorStartInfo): void;
}

/** `TUTOR_SLOTS.StartSheet`:开始面板 + `POST /start`(幂等;一个对话只有一个进行中的会话)。 */
export function TutorStartSheet({ open, onOpenChange, personaId, conversationId, onStarted }: TutorStartSheetProps) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [busy, setBusy] = useState(false);
  const start = async (goal: TutorGoalInput) => {
    if (busy) return;
    setBusy(true);
    try {
      const session = await startTutor(api, { conversationId, personaId, ...goal, clientStartId: crypto.randomUUID() });
      onStarted(session.id, { input: session.goal.input, speakFirst: needsAgentTurn(session) });
    } catch (err) {
      toast.error(translateServerError(t, err, TUTOR_SERVER_ERRORS));
      setBusy(false);
    }
  };
  return <TutorStartSheetView open={open} onOpenChange={onOpenChange} busy={busy} onStart={(goal) => void start(goal)} />;
}
