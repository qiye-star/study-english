import { PronunciationAssessmentScoreResult } from "@renderer/components/pronunciation-assessments/pronunciation-assessment-score-result";
import type { AssessmentScores } from "./assessment-api";

/** 桌面评分视图是三列布局 + 160px 圆环,手机上会横向溢出;用任意变体改成单列,不改 enjoy 源码。 */
export function MobileScoreResult({ scores }: { scores: AssessmentScores }) {
  return (
    <div data-testid="assessment-scores"
      className="overflow-hidden [&_.col-span-2]:col-span-1 [&_.gap-8]:gap-4 [&_.grid-cols-3]:grid-cols-1">
      <PronunciationAssessmentScoreResult
        pronunciationScore={scores.pronunciationScore}
        accuracyScore={scores.accuracyScore}
        fluencyScore={scores.fluencyScore}
        completenessScore={scores.completenessScore}
      />
    </div>
  );
}
