import { render, screen } from "@testing-library/react";
import camelcaseKeys from "camelcase-keys";
import { describe, expect, it } from "vitest";
import * as ui from "@renderer/components/ui";
import { PronunciationAssessmentScoreResult } from "@renderer/components/pronunciation-assessments/pronunciation-assessment-score-result";
import { PronunciationAssessmentFulltextResult } from "@renderer/components/pronunciation-assessments/pronunciation-assessment-fulltext-result";
import raw from "~/test/fixtures/assessment-good.json";

const sample = camelcaseKeys(raw, { deep: true }) as any;

describe("enjoy component reuse", () => {
  it("ui shim exposes only the selected components", () => {
    expect(ui.Button).toBeDefined();
    expect(ui.Sheet).toBeDefined();
    expect((ui as Record<string, unknown>).Command).toBeUndefined();
  });

  it("renders the desktop score view", () => {
    render(
      <PronunciationAssessmentScoreResult
        pronunciationScore={sample.pronunciationScore}
        accuracyScore={sample.accuracyScore}
        fluencyScore={sample.fluencyScore}
        completenessScore={sample.completenessScore}
      />,
    );
    expect(screen.getAllByText(String(sample.pronunciationScore)).length).toBeGreaterThan(0);
  });

  it("renders word-level results through the components shim", () => {
    render(<PronunciationAssessmentFulltextResult words={sample.detailResult.words} />);
    expect(screen.getAllByText(/coffee/i).length).toBeGreaterThan(0);
  });
});
