import { RoleGate } from "../../components/role-gate";
import { SpinnerIcon } from "../../components/icons";
import { StatusDot } from "../../components/status-dot";
import { formatDateTime } from "../../lib/format";
import type { RulesOverview } from "./api";
import { S } from "./strings";

/** 顶部状态条:已发布版本、草稿基线与修改数、校验结果、操作按钮(视觉稿第 2 屏)。 */
export function DraftBar({
  overview,
  changes,
  unsaved,
  errors,
  canEdit,
  canSave,
  busy,
  onNew,
  onSave,
  onDiscard,
  onValidate,
  onSimulate,
  onPublish,
}: {
  overview: RulesOverview;
  /** 草稿与当前生效版本相比的修改处数 */
  changes: number;
  unsaved: number;
  /** null = 尚未校验 */
  errors: string[] | null;
  canEdit: boolean;
  canSave: boolean;
  busy: boolean;
  onNew: () => void;
  onSave: () => void;
  onDiscard: () => void;
  onValidate: () => void;
  onSimulate: () => void;
  onPublish: () => void;
}) {
  const { published, draft } = overview;
  return (
    <div data-testid="draft-bar" className="panel flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
      <div className="flex flex-col">
        <span className="text-2xs text-fg-2">{published ? S.draftBar.published : S.draftBar.unpublished}</span>
        <span className="font-medium">
          {published
            ? S.draftBar.publishedBy(published.version, formatDateTime(published.publishedAt), published.publishedBy ?? "—")
            : S.draftBar.v0}
        </span>
      </div>
      <span className="h-8 w-px bg-line" aria-hidden="true" />
      {draft ? (
        <div className="flex flex-col">
          <span className="text-2xs text-fg-2">{S.draftBar.draft(draft.basedOn)}</span>
          <span className="font-medium">
            {S.draftBar.editedBy(draft.updatedBy, formatDateTime(draft.updatedAt))} · {S.draftBar.changes(changes)}
          </span>
        </div>
      ) : (
        <span className="text-fg-2">{S.draftBar.noDraft}</span>
      )}
      {unsaved > 0 && <span className="badge bg-warn-soft text-fg">{S.draftBar.unsaved(unsaved)}</span>}
      {draft &&
        (errors === null ? (
          <span className="badge bg-sunken text-fg-2">{S.draftBar.notValidated}</span>
        ) : errors.length === 0 ? (
          <span className="badge bg-good-soft text-fg">
            <StatusDot tone="good" />
            <span>{S.draftBar.valid}</span>
          </span>
        ) : (
          <span className="badge bg-bad-soft text-bad">{S.draftBar.problems(errors.length)}</span>
        ))}
      <span className="flex-1" />
      {busy && <SpinnerIcon width={16} height={16} className="text-fg-2" />}
      {canEdit && !draft && (
        <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={onNew}>
          {S.draftBar.newDraft}
        </button>
      )}
      {canEdit && draft && (
        <>
          <button type="button" className="btn-danger btn-sm" disabled={busy} onClick={onDiscard}>
            {S.draftBar.discard}
          </button>
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={onValidate}>
            {S.draftBar.validate}
          </button>
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={onSimulate}>
            {S.draftBar.simulate}
          </button>
          <button type="button" className="btn-ghost btn-sm" disabled={busy || !canSave} onClick={onSave}>
            {S.draftBar.save}
          </button>
          <RoleGate min="superadmin">
            <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={onPublish}>
              {S.draftBar.publish}
            </button>
          </RoleGate>
        </>
      )}
    </div>
  );
}
