import { useEffect, useState } from "react";
import { MIN_REASON } from "../../components/confirm-dialog";
import { Dialog } from "../../components/dialog";
import { RoleGate } from "../../components/role-gate";
import { errorText } from "../../hooks/use-async";
import { formatDateTime } from "../../lib/format";
import { levelText } from "../../lib/levels";
import { editPersona, type AdminPersona, type PersonaEdit } from "./api";
import { S } from "./strings";

/** 人设原文(审核用):viewer 只读;operator 可改名称 / 简介 / 人设,带理由,服务端同一条校验规则(计划 R-C23)。 */
export function PersonaDialog({ persona, onClose, onSaved }: { persona: AdminPersona | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [intro, setIntro] = useState("");
  const [prompt, setPrompt] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!persona) return;
    setName(persona.name);
    setIntro(persona.intro);
    setPrompt(persona.prompt);
    setReason("");
    setError(null);
    setBusy(false);
  }, [persona]);

  if (!persona) return null;
  const changes: PersonaEdit = {
    ...(name !== persona.name ? { name } : {}),
    ...(intro !== persona.intro ? { intro } : {}),
    ...(prompt !== persona.prompt ? { prompt } : {}),
  };
  const canSave = Object.keys(changes).length > 0 && reason.trim().length >= MIN_REASON && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await editPersona(persona.id, changes, reason.trim());
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const facts: [string, string][] = [
    [S.dialog.owner, persona.owner ?? "—"],
    [S.dialog.level, levelText(persona.level)],
    [S.dialog.style, persona.style],
    [S.dialog.tools, persona.tools.join(", ") || "—"],
    [S.dialog.public, persona.promptPublic ? S.dialog.yes : S.dialog.no],
    [S.personaCols.created, formatDateTime(persona.createdAt)],
  ];

  return (
    <Dialog
      open
      width={680}
      title={S.dialog.title(persona.name)}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            {S.dialog.close}
          </button>
          <RoleGate min="operator">
            <button type="button" className="btn-primary btn-sm" disabled={!canSave} onClick={save}>
              {S.dialog.save}
            </button>
          </RoleGate>
        </>
      }
    >
      <p className="rounded-lg bg-sunken px-3 py-2 text-xs text-fg-2">{S.dialog.moderationNote}</p>
      <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-1 text-xs">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-fg-2">{k}</dt>
            <dd className="num">{v}</dd>
          </div>
        ))}
      </dl>
      <RoleGate
        min="operator"
        fallback={<pre className="max-h-[320px] overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-sunken p-3 text-xs">{persona.prompt}</pre>}
      >
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-2">{S.dialog.name}</span>
          <input className="field-sm" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-2">{S.dialog.intro}</span>
          <input className="field-sm" value={intro} onChange={(e) => setIntro(e.target.value)} maxLength={60} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-2">{S.dialog.prompt}</span>
          <textarea className="field-sm h-auto min-h-[160px] py-2 font-mono text-xs" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-2">{S.dialog.reason}</span>
          <textarea className="field-sm h-auto min-h-[56px] py-2" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
        </label>
      </RoleGate>
      {error && (
        <p role="alert" className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-bad">
          {S.failed(error)}
        </p>
      )}
    </Dialog>
  );
}
