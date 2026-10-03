import { useContext } from "react";
import { AppSettingsProviderContext } from "@renderer/context";
import { t } from "i18next";

export const usePronunciationAssessments = () => {
  const { webApi, EnjoyApp } = useContext(AppSettingsProviderContext);

  const createAssessment = async (params: {
    language: string;
    recording: RecordingType;
    reference?: string;
    targetId?: string;
    targetType?: string;
  }) => {
    let { recording } = params;
    const { targetId, targetType } = params;
    if (targetId && targetType && !recording) {
      recording = await EnjoyApp.recordings.findOne({ targetId });
    }

    EnjoyApp.recordings.sync(recording.id);
    const url = await EnjoyApp.echogarden.transcode(recording.src);
    const blob = await (await fetch(url)).blob();

    const { language, reference = recording.referenceText } = params;

    if (!reference?.trim()) {
      throw new Error(t("referenceTextRequired"));
    }

    const result = await webApi.assessPronunciation({
      blob,
      language,
      reference,
    });

    console.log("assess result: ", result);
    const resultJson = {
      ...result.detailResult,
      duration: recording?.duration,
    };

    return EnjoyApp.pronunciationAssessments.create({
      targetId: recording.id,
      targetType: "Recording",
      pronunciationScore: result.pronunciationScore,
      accuracyScore: result.accuracyScore,
      completenessScore: result.completenessScore,
      fluencyScore: result.fluencyScore,
      result: resultJson,
      language: params.language || recording.language,
    });
  };

  return {
    createAssessment,
  };
};
