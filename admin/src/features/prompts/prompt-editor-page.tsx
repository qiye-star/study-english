import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { hasRole, useAdminSession } from "../../api/session";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { DataTable, type Column } from "../../components/data-table";
import { SpinnerIcon } from "../../components/icons";
import { Page } from "../../components/layout";
import { ErrorState, Skeleton } from "../../components/states";
import { errorText, useAsync } from "../../hooks/use-async";
import { formatDateTime } from "../../lib/format";
import {
  createPromptDraft, deletePromptDraft, getPrompt, publishPrompt, savePromptDraft, type PromptDetail, type PromptVersion,
} from "./api";
import { lineDiff } from "./diff";
import { PlaceholderChecklist } from "./placeholder-checklist";
import { checkPrompt, cleanPrompt } from "./placeholders";
import { S } from "./strings";
import { TemplatesEditor } from "./templates-editor";
import { TestRunPanel } from "./test-run-panel";

function messageFor(e: unknown): string {
  const text = errorText(e);
  return S.errors[text] ?? text;
}

/** 等宽编辑器:左侧行号栏随文本滚动。 */
function CodeEditor({ value, onChange, readOnly }: { value: string; onChange: (v: string) => void; readOnly: boolean }) {
  const gutter = useRef<HTMLDivElement>(null);
  const lines = value.split("\n").length;
  return (
    <div className="flex h-[460px] overflow-hidden rounded-lg border border-line bg-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
      <div ref={gutter} aria-hidden="true" className="num select-none overflow-hidden border-r border-line bg-sunken px-2 py-2 text-right text-[12px] leading-[20px] text-fg-2">
        {Array.from({ length: lines }, (_, i) => <div key={i}>{i + 1}</div>)}
      </div>
      <textarea
        aria-label={S.editorLabel}
        className={`flex-1 resize-none bg-transparent px-3 py-2 font-mono text-[13px] leading-[20px] text-fg outline-none ${readOnly ? "text-fg-2" : ""}`}
        value={value}
        readOnly={readOnly}
        spellCheck={false}
        wrap="off"
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
        }}
      />
    </div>
  );
}

function DiffView({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => lineDiff(before, after), [before, after]);
  if (lines.every((l) => l.type === "same")) return <p className="px-4 pb-4 text-sm text-fg-2">{S.diffSame}</p>;
  return (
    <div className="max-h-96 overflow-auto border-t border-line font-mono text-[13px] leading-[20px]">
      {lines.map((l, i) => (
        <div key={i} className={`flex gap-2 px-4 ${l.type === "add" ? "bg-good-soft" : l.type === "del" ? "bg-bad-soft" : ""}`}>
          <span aria-hidden="true" className="w-3 shrink-0 text-fg-2">{l.type === "add" ? "+" : l.type === "del" ? "-" : " "}</span>
          <span className="whitespace-pre-wrap break-all">{l.text}</span>
        </div>
      ))}
    </div>
  );
}

function Editor({ detail, reload }: { detail: PromptDetail; reload: () => void }) {
  const session = useAdminSession();
  const canEdit = hasRole(session, "operator");
  const isSuper = hasRole(session, "superadmin");
  const { spec, draft, published } = detail;
  const liveBody = published?.body ?? detail.defaultBody ?? "";
  const savedBody = draft?.body ?? liveBody;

  const [body, setBody] = useState(savedBody);
  const [note, setNote] = useState(draft?.note ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"publish" | "delete" | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  useEffect(() => {
    setBody(savedBody);
    setNote(draft?.note ?? "");
  }, [savedBody, draft?.note]);

  const check = useMemo(() => checkPrompt(spec, body), [spec, body]);
  const savedCheck = useMemo(() => checkPrompt(spec, savedBody), [spec, savedBody]);
  const editable = canEdit && !!draft;
  const dirty = !!draft && (body !== draft.body || note !== draft.note);
  const valid = check.errors.length === 0;

  const act = async (name: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
      reload();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(null);
    }
  };

  const nextVersion = Math.max(0, ...detail.versions.map((v) => v.version)) + 1;

  const versionColumns: Column<PromptVersion>[] = [
    { key: "version", header: S.colVersion, render: (v) => <span className="num">{`v${v.version}`}</span> },
    {
      key: "status", header: S.colStatus,
      render: (v) => <span className={`badge ${v.status === "published" ? "bg-good-soft text-good" : "bg-sunken text-fg-2"}`}>{S.status[v.status]}</span>,
    },
    { key: "note", header: S.colNote, render: (v) => v.note || "—" },
    { key: "by", header: S.colPublishedBy, render: (v) => v.publishedBy ?? "—" },
    { key: "at", header: S.colPublishedAt, render: (v) => <span className="num">{formatDateTime(v.publishedAt)}</span> },
    {
      key: "actions", header: "", align: "right",
      render: (v) => canEdit && !draft ? (
        <button type="button" className="btn-quiet btn-sm" disabled={busy !== null}
          onClick={() => act("rollback", () => createPromptDraft(spec.key, v.version))}>
          {S.rollback}
        </button>
      ) : null,
    },
  ];

  return (
    <>
      {/* 草稿栏 */}
      <div className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {published ? <span className="badge bg-good-soft text-good">{S.published(published.version)}</span>
            : <span className="badge bg-sunken text-fg-2">{S.notPublished}</span>}
          {draft ? (
            <span className="text-fg-2">{S.draftBy(draft.updatedBy, formatDateTime(draft.updatedAt))}</span>
          ) : (
            <span className="text-fg-2">{canEdit ? S.noDraft : S.readOnlyViewer}</span>
          )}
          {dirty && <span className="badge bg-warn-soft text-warn">{S.unsaved}</span>}
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            {!draft ? (
              <button type="button" className="btn-primary btn-sm" disabled={busy !== null}
                onClick={() => act("create", () => createPromptDraft(spec.key))}>
                {S.createDraft}
              </button>
            ) : (
              <>
                <button type="button" className="btn-danger btn-sm" disabled={busy !== null} onClick={() => setConfirm("delete")}>
                  {S.deleteDraft}
                </button>
                <button type="button" className={`${isSuper ? "btn-ghost" : "btn-primary"} btn-sm`} disabled={busy !== null || !dirty || !valid}
                  onClick={() => act("save", () => savePromptDraft(spec.key, cleanPrompt(body), note.trim()), S.savedToast)}>
                  {busy === "save" && <SpinnerIcon width={14} height={14} />}
                  {busy === "save" ? S.saving : S.saveDraft}
                </button>
                {isSuper && (
                  <button type="button" className="btn-primary btn-sm" title={dirty || savedCheck.errors.length ? S.publishBlocked : undefined}
                    disabled={busy !== null || dirty || savedCheck.errors.length > 0} onClick={() => setConfirm("publish")}>
                    {S.publish}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
      {notice && <p role="status" className="text-sm text-good">{notice}</p>}

      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-4">
        <div className="min-w-0 space-y-3">
          {spec.kind === "json" ? (
            <TemplatesEditor body={body} onChange={setBody} readOnly={!editable} />
          ) : (
            <div className="space-y-1">
              <CodeEditor value={body} onChange={setBody} readOnly={!editable} />
              <div className="flex justify-end">
                <span className={`num text-xs ${check.length > spec.maxChars ? "text-bad" : "text-fg-2"}`}>{S.chars(check.length, spec.maxChars)}</span>
              </div>
            </div>
          )}
          {editable && (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-fg-2">{S.note}</span>
              <input className="field-sm" value={note} maxLength={200} placeholder={S.notePlaceholder} onChange={(e) => setNote(e.target.value)} />
            </label>
          )}
        </div>
        <div className="space-y-4">
          <PlaceholderChecklist spec={spec} check={check} />
          {isSuper && spec.kind === "text" && (
            <TestRunPanel promptKey={spec.key} body={cleanPrompt(body)} fields={spec.sampleFields ?? spec.required} blocked={!valid} />
          )}
        </div>
      </div>

      <section className="panel" aria-label={S.diffTitle}>
        <div className="panel-head">
          <h2 className="text-sm font-semibold">{S.diffTitle}</h2>
          {published && (
            <button type="button" className="btn-quiet btn-sm" onClick={() => setShowDiff((v) => !v)}>
              {showDiff ? S.diffHide : S.diffShow}
            </button>
          )}
        </div>
        {!published ? <p className="px-4 pb-4 text-sm text-fg-2">{S.diffNoPublished}</p>
          : showDiff && <DiffView before={published.body} after={cleanPrompt(body)} />}
      </section>

      <section className="panel" aria-label={S.versionsTitle}>
        <div className="panel-head">
          <h2 className="text-sm font-semibold">{S.versionsTitle}</h2>
        </div>
        <DataTable columns={versionColumns} rows={detail.versions} rowKey={(v) => v.version} empty={S.noVersions} caption={S.versionsTitle} />
      </section>

      <ConfirmDialog
        open={confirm === "publish"}
        title={S.publishTitle}
        body={S.publishBody(spec.label, nextVersion)}
        confirmText={S.publish}
        reasonRequired
        onClose={() => setConfirm(null)}
        onConfirm={async (reason) => {
          const r = await publishPrompt(spec.key, reason).catch((e) => {
            throw new Error(messageFor(e));
          });
          setConfirm(null);
          setNotice(S.publishedToast(r.version));
          reload();
        }}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        title={S.deleteTitle}
        body={S.deleteBody}
        confirmText={S.deleteDraft}
        danger
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          await deletePromptDraft(spec.key).catch((e) => {
            throw new Error(messageFor(e));
          });
          setConfirm(null);
          reload();
        }}
      />
    </>
  );
}

/** `/prompts/:key`:编辑器 + 检查栏 + 草稿/发布栏 + 版本与对比 + 试运行(superadmin)。 */
export function PromptEditorPage() {
  const { key = "" } = useParams();
  const { data, loading, error, reload } = useAsync(() => getPrompt(key), [key]);
  return (
    <Page
      title={data?.spec.label ?? S.promptDetailPage}
      actions={<Link to="/prompts" className="btn-quiet btn-sm">{S.back}</Link>}
    >
      {data ? <Editor detail={data} reload={reload} /> : loading ? <Skeleton rows={3} variant="blocks" /> : <ErrorState message={error ?? ""} onRetry={reload} />}
    </Page>
  );
}
