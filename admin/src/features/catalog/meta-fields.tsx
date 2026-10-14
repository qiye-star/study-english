import { useId } from "react";
import type { CatalogState, NewMeta } from "./api";
import { S } from "./strings";

/** 导入 / 上传对话框共用的元数据表单状态(标签是逗号分隔的原文)。 */
export interface MetaDraft { title: string; level: string; tags: string; license: string; aiLang: string }

export const emptyDraft = (state: CatalogState): MetaDraft => ({
  title: "", level: "", tags: "", license: "",
  aiLang: state.languages.includes("zh-CN") ? "zh-CN" : (state.languages[0] ?? "zh-CN"),
});

export function metaOf(d: MetaDraft): NewMeta {
  return {
    title: d.title.trim() || undefined,
    level: d.level || null,
    tags: d.tags.split(",").map((t) => t.trim()).filter(Boolean),
    licenseNote: d.license.trim() || null,
    aiLang: d.aiLang,
  };
}

export function MetaFields({ draft, state, onChange }: { draft: MetaDraft; state: CatalogState; onChange: (d: MetaDraft) => void }) {
  const id = useId();
  const set = (patch: Partial<MetaDraft>) => onChange({ ...draft, ...patch });
  return (
    <>
      <div className="space-y-1">
        <label htmlFor={`${id}-title`} className="block text-xs font-medium text-fg-2">{S.form.title}</label>
        <input id={`${id}-title`} className="field-sm" value={draft.title} placeholder={S.form.titleHint} maxLength={400}
          onChange={(e) => set({ title: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor={`${id}-level`} className="block text-xs font-medium text-fg-2">{S.form.level}</label>
          <select id={`${id}-level`} className="field-sm" value={draft.level} onChange={(e) => set({ level: e.target.value })}>
            <option value="">{S.form.noLevel}</option>
            {state.levels.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-lang`} className="block text-xs font-medium text-fg-2">{S.form.aiLang}</label>
          <select id={`${id}-lang`} className="field-sm" value={draft.aiLang} onChange={(e) => set({ aiLang: e.target.value })}>
            {state.languages.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-tags`} className="block text-xs font-medium text-fg-2">{S.form.tags}</label>
        <input id={`${id}-tags`} className="field-sm" value={draft.tags} onChange={(e) => set({ tags: e.target.value })} />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-license`} className="block text-xs font-medium text-fg-2">{S.form.license}</label>
        <input id={`${id}-license`} className="field-sm" value={draft.license} placeholder={S.form.licenseHint} maxLength={300}
          onChange={(e) => set({ license: e.target.value })} />
      </div>
    </>
  );
}
