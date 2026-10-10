import type { WordActionProps } from "~/lib/extension-points";
import { AddVocabularyButton } from "./add-vocabulary-button";

/** wordActions 插槽里的核心贡献:与原先直接渲染 AddVocabularyButton 完全相同(同 testId、无障碍名、状态)。 */
export function AddVocabularyAction({ target, testId, label, variant }: WordActionProps) {
  return <AddVocabularyButton testId={testId} label={label} withLabel={variant === "labeled"} input={target} />;
}
