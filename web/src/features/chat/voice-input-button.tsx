import { LoaderIcon, MicIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@renderer/components/ui/button";
import { toAssessmentWav } from "~/audio/convert";
import { describeAudioError } from "~/audio/describe-error";
import type { RecorderEnv, RecordingResult } from "~/audio/recorder";
import { useRecorder } from "~/audio/use-recorder";
import { useAuth } from "~/auth/auth-context";
import { CHAT_SERVER_ERRORS } from "./chat-api";
import { transcribe } from "./speech-api";

export function VoiceInputButton({ onText, disabled, recorderEnv }: { onText(text: string): void; disabled?: boolean; recorderEnv?: RecorderEnv }) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const handle = async (recording: RecordingResult) => {
    setBusy(true);
    try {
      const { wav } = await toAssessmentWav(recording.blob);
      const { text } = await transcribe(api, wav, "en");
      if (!mountedRef.current) return;
      if (text?.trim()) onText(text.trim());
      else toast.info(t("web.chat.noSpeech"));
    } catch (err) {
      if (mountedRef.current) toast.error(describeAudioError(t, err, CHAT_SERVER_ERRORS));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const recorder = useRecorder({ env: recorderEnv, onAutoStop: (r) => void handle(r) });
  useEffect(() => {
    if (recorder.error) toast.error(describeAudioError(t, recorder.error));
  }, [recorder.error, t]);

  const state = busy ? "transcribing" : recorder.state === "recording" ? "recording" : "idle";
  return (
    <Button type="button" data-testid="chat-mic" data-state={state} size="icon"
      variant={state === "recording" ? "destructive" : "ghost"} className="h-11 w-11 shrink-0"
      disabled={busy || recorder.state === "starting" || (disabled && recorder.state !== "recording")}
      aria-label={state === "recording" ? t("web.recorder.stop") : state === "transcribing" ? t("web.chat.transcribing") : t("web.chat.mic")}
      onClick={async () => {
        if (recorder.state === "recording") {
          const result = await recorder.stop();
          if (result) await handle(result);
        } else {
          await recorder.start();
        }
      }}>
      {busy ? <LoaderIcon className="h-5 w-5 animate-spin" /> : state === "recording" ? <SquareIcon className="h-5 w-5" /> : <MicIcon className="h-5 w-5" />}
    </Button>
  );
}
