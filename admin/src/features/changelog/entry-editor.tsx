import { useState } from "react";
import { hasRole, useAdminSession } from "../../api/session";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { errorText } from "../../hooks/use-async";
import {
  TAGS, createEntry, deleteEntry, publishEntry, unpublishEntry, updateEntry,
  type ChangelogEntry, type ChangelogInput, type ChangelogItem, type ChangelogTag,
} from "./api";
import { EntryPreview, type PreviewLang } from "./entry-preview";
import { S } from "./strings";

export const MAX_ITEMS = 20;
export const MAX_TEXT = 200;
export const MAX_TITLE = 80;
export const MAX_VERSION = 24;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/;
const E = S.editor;

export interface Form { entryDate: string; version: string; titleZh: string; titleEn: string; items: ChangelogItem[] }

const pad = (n: number) => String(n).padStart(2, "0");
const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const blank = (): Form => ({ entryDate: today(), version: "", titleZh: "", titleEn: "", items: [{ tag: "new", zh: "", en: "" }] });
const fromEntry = (e: ChangelogEntry): Form => ({
  entryDate: e.entryDate, version: e.version ?? "", titleZh: e.titleZh, titleEn: e.titleEn, items: e.items.map((i) => ({ ...i })),
});
const toInput = (f: Form): ChangelogInput => ({
  entryDate: f.entryDate.trim(),
  version: f.version.trim() || null,
  titleZh: f.titleZh.trim(),
  titleEn: f.titleEn.trim(),
  items: f.items.map((i) => ({ tag: i.tag, zh: i.zh.trim(), en: i.en.trim() })),
});

/** 与服务端 `changelog.validate` 同一套规则(服务端仍会再校验);返回要显示的问题。 */
export function problemsOf(f: Form): string[] {
  const input = toInput(f);
  const out: string[] = [];
  if (!DATE_RE.test(input.entryDate)) out.push(E.invalid.date);
  if (input.version !== null && (input.version.length > MAX_VERSION || !VERSION_RE.test(input.version))) out.push(E.invalid.version);
  if (!input.titleZh || input.titleZh.length > MAX_TITLE) out.push(E.invalid.title);
  if (input.titleEn.length > MAX_TITLE) out.push(E.invalid.titleEn);
  if (input.items.length < 1 || input.items.length > MAX_ITEMS) out.push(E.invalid.items);
  input.items.forEach((item, i) => {
    if (!item.zh || item.zh.length > MAX_TEXT) out.push(E.invalid.itemZh(i + 1));
    if (item.en.length > MAX_TEXT) out.push(E.invalid.itemEn(i + 1));
  });
  return out;
}

type Confirm = "publish" | "unpublish" | "delete" | null;

/**
 * 更新日志编辑器(spec D6、计划 R-19):日期、版本号、中英文标题、条目列表(类型下拉 + 一句话)、预览、保存 / 发布 / 下架 / 删除。
 * 操作员及以上可写;查看者只读。「发布」= 有改动(或新建)就先保存再发布。父组件用 key 在条目变化时重新挂载本组件。
 */
export function EntryEditor({ initial, onChanged, onDeleted }: {
  initial: ChangelogEntry | null;
  onChanged: (id: number) => void;
  onDeleted: () => void;
}) {
  const canWrite = hasRole(useAdminSession(), "operator");
  const [form, setForm] = useState<Form>(() => (initial ? fromEntry(initial) : blank()));
  const [baseline] = useState(() => JSON.stringify(toInput(initial ? fromEntry(initial) : blank())));
  const [lang, setLang] = useState<PreviewLang>("zh");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const problems = problemsOf(form);
  const valid = problems.length === 0;
  const dirty = JSON.stringify(toInput(form)) !== baseline;
  const published = initial?.status === "published";
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const setItem = (i: number, patch: Partial<ChangelogItem>) => set({ items: form.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const titleKey = lang === "zh" ? "titleZh" : "titleEn";

  const save = async () => {
    if (!valid || busy || !canWrite) return;
    setBusy(true);
    setError(null);
    try {
      const saved = initial ? await updateEntry(initial.id, toInput(form)) : await createEntry(toInput(form));
      onChanged(saved.id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    let id = initial?.id;
    if (!initial || dirty) id = (initial ? await updateEntry(initial.id, toInput(form)) : await createEntry(toInput(form))).id;
    await publishEntry(id as number);
    setConfirm(null);
    onChanged(id as number);
  };

  return (
    <section className="panel space-y-4 p-4" aria-label={initial ? E.editTitle : E.createTitle}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-md font-semibold">{initial ? E.editTitle : E.createTitle}</h2>
        <div className="flex items-center gap-2">
          <button type="button" aria-pressed={preview} className="btn-ghost btn-sm" onClick={() => setPreview((p) => !p)}>{E.preview}</button>
          {canWrite && (
            <>
              <button type="button" className="btn-ghost btn-sm" disabled={!valid || !dirty || busy} onClick={() => void save()}>{E.save}</button>
              {published ? (
                <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => setConfirm("unpublish")}>{E.unpublish}</button>
              ) : (
                <button type="button" className="btn-primary btn-sm" disabled={!valid || busy} onClick={() => setConfirm("publish")}>{E.publish}</button>
              )}
              {initial && <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => setConfirm("delete")}>{E.remove_entry}</button>}
            </>
          )}
        </div>
      </div>
      {!canWrite && <p className="text-sm text-muted">{S.readOnly}</p>}

      <div className="grid grid-cols-[160px_140px] gap-3">
        <label className="space-y-1">
          <span className="block text-xs font-medium text-fg-2">{E.date}</span>
          <input type="date" className="field-sm" value={form.entryDate} disabled={!canWrite} onChange={(e) => set({ entryDate: e.target.value })} />
        </label>
        <label className="space-y-1">
          <span className="block text-xs font-medium text-fg-2">{E.version}</span>
          <input className="field-sm" value={form.version} maxLength={MAX_VERSION} disabled={!canWrite} onChange={(e) => set({ version: e.target.value })} />
        </label>
      </div>

      <div role="radiogroup" aria-label={E.lang} className="inline-flex gap-0.5 rounded-lg bg-sunken p-0.5">
        {(["zh", "en"] as const).map((l) => (
          <button key={l} type="button" role="radio" aria-checked={l === lang} onClick={() => setLang(l)}
            className={`min-h-[30px] min-w-[72px] rounded-[7px] px-3 text-sm font-medium ${l === lang ? "bg-surface text-fg shadow-card" : "text-muted"}`}>
            {l === "zh" ? E.zh : E.en}
          </button>
        ))}
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-xs font-medium text-fg-2">
          <label htmlFor="changelog-title">{E.title}</label>
          <span className="num">{E.count(form[titleKey].length, MAX_TITLE)}</span>
        </div>
        <input id="changelog-title" className="field-sm" value={form[titleKey]} disabled={!canWrite} maxLength={MAX_TITLE + 20}
          onChange={(e) => set({ [titleKey]: e.target.value } as Partial<Form>)} />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-fg-2">{E.items}</p>
        {form.items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <select aria-label={E.tag(i + 1)} className="field-sm w-[104px]" value={item.tag} disabled={!canWrite}
              onChange={(e) => setItem(i, { tag: e.target.value as ChangelogTag })}>
              {TAGS.map((t) => <option key={t} value={t}>{S.tags[t]}</option>)}
            </select>
            <input aria-label={E.text(i + 1)} className="field-sm flex-1" value={lang === "zh" ? item.zh : item.en} disabled={!canWrite}
              maxLength={MAX_TEXT + 20} onChange={(e) => setItem(i, lang === "zh" ? { zh: e.target.value } : { en: e.target.value })} />
            <span className="num w-[52px] text-right text-xs text-muted">{E.count((lang === "zh" ? item.zh : item.en).length, MAX_TEXT)}</span>
            {canWrite && (
              <button type="button" aria-label={E.remove(i + 1)} className="btn-quiet btn-sm" disabled={form.items.length <= 1}
                onClick={() => set({ items: form.items.filter((_, j) => j !== i) })}>×</button>
            )}
          </div>
        ))}
        {canWrite && (
          <button type="button" className="btn-quiet btn-sm text-accent" disabled={form.items.length >= MAX_ITEMS}
            onClick={() => set({ items: [...form.items, { tag: "new", zh: "", en: "" }] })}>{E.add}</button>
        )}
      </div>

      {preview && <EntryPreview lang={lang} entryDate={form.entryDate} version={form.version} titleZh={form.titleZh} titleEn={form.titleEn} items={form.items} />}
      {canWrite && !valid && dirty && <p role="note" className="text-xs text-warn">{problems[0]}</p>}
      {error && <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-bad">{error}</p>}
      <p className="text-xs leading-relaxed text-muted">{E.note}</p>
      <p className="text-xs leading-relaxed text-muted">{E.order}</p>

      <ConfirmDialog open={confirm === "publish"} title={S.confirm.publishTitle} body={S.confirm.publishBody} confirmText={E.publish}
        onConfirm={publish} onClose={() => setConfirm(null)} />
      <ConfirmDialog open={confirm === "unpublish"} title={S.confirm.unpublishTitle} body={S.confirm.unpublishBody} confirmText={E.unpublish}
        onConfirm={async () => {
          await unpublishEntry((initial as ChangelogEntry).id);
          setConfirm(null);
          onChanged((initial as ChangelogEntry).id);
        }} onClose={() => setConfirm(null)} />
      <ConfirmDialog open={confirm === "delete"} title={S.confirm.deleteTitle} body={S.confirm.deleteBody} confirmText={E.remove_entry} danger
        onConfirm={async () => {
          await deleteEntry((initial as ChangelogEntry).id);
          setConfirm(null);
          onDeleted();
        }} onClose={() => setConfirm(null)} />
    </section>
  );
}
