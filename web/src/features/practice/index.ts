// practice 的公共接口:其他目录只能从这里引入 practice(由 src/architecture.test.ts 约束)。
export { AssessmentPage } from "./assessment-page";
export { HistoryPage } from "./history-page";
export { PracticeListPage } from "./practice-list-page";
export { PracticePage } from "./practice-page";
export {
  PRACTICE_SERVER_ERRORS,
  assessPronunciation,
  briefWords,
  deleteAssessment,
  getAssessment,
  getAssessmentAudio,
  type AssessmentDetail,
  type AssessmentScores,
  type AssessmentWordBrief,
} from "./assessment-api";
export { MAX_PRACTICE_TEXT } from "./practice-items-api";
export { goPractice, savePracticeItem } from "./save-practice-item";
export { MobileScoreResult } from "./mobile-score-result";
export { ShadowSheetProvider, useShadowSheet, useShadowSheetOpen, type ShadowOpenInput, type ShadowSource } from "./shadow/shadow-context";
export { ShadowSheetHost } from "./shadow/shadow-host";
