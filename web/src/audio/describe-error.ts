import type { TFunction } from "i18next";
import { translateServerError } from "~/api/error-messages";
import { AudioConvertError } from "./convert";
import { RecorderError } from "./recorder";

export function describeAudioError(t: TFunction, err: unknown, serverErrors: Record<string, string> = {}): string {
  if (err instanceof RecorderError) return t(`web.recorder.${err.code}`);
  if (err instanceof AudioConvertError) return t(`web.audio.${err.code}`);
  return translateServerError(t, err, serverErrors);
}
