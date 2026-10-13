import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { LIBRARY_SERVER_ERRORS, MAX_TITLE_CHARS, MAX_URL_CHARS, importLink, type LibraryItem } from "./library-api";
import "./locales";
import { FIELD, PRIMARY } from "./ui";

/** 只做形状检查:http(s)、有主机、无用户信息、≤ 2000 字;能否访问由服务端判定(spec §7.2)。 */
export function isHttpUrl(value: string): boolean {
  const s = value.trim();
  if (!s || s.length > MAX_URL_CHARS) return false;
  try {
    const u = new URL(s);
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

// 导入时的 404 = 管理员刚关掉链接导入(spec §9),不是「素材不存在」
const IMPORT_ERRORS: Record<string, string> = { ...LIBRARY_SERVER_ERRORS, "Not Found": "web.library.link.disabled" };

/** 链接页签(spec §7.4、§11.3):DRM 文案常驻;开关关时只显示说明。链接只放在 POST 体里。 */
export function ImportForm({ linkImport, onImported }: { linkImport: boolean; onImported: (item: LibraryItem) => void }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!isHttpUrl(url)) {
      setError(t("web.library.link.badUrl"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const item = await importLink(api, { url: url.trim(), title: title.trim() || undefined });
      setUrl("");
      setTitle("");
      onImported(item);
    } catch (err) {
      setError(translateServerError(t, err, IMPORT_ERRORS));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="library-import">
      <p data-testid="library-drm-note" className="rounded-card bg-surface-2 p-3 text-meta text-ink-2">{t("web.library.link.drm")}</p>
      {!linkImport ? (
        <p data-testid="library-link-disabled" className="text-sub text-ink-2">{t("web.library.link.disabled")}</p>
      ) : (
        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow">{t("web.library.link.url")}</span>
            <input type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} maxLength={MAX_URL_CHARS}
              placeholder={t("web.library.link.placeholder")} value={url} className={FIELD} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow">{t("web.library.link.titleLabel")}</span>
            <input type="text" value={title} maxLength={MAX_TITLE_CHARS} className={FIELD} onChange={(e) => setTitle(e.target.value)} />
          </label>
          {error ? <p role="alert" className="text-meta text-red">{error}</p> : null}
          <p className="text-meta text-ink-2">{t("web.library.link.note")}</p>
          <button type="submit" disabled={busy || !url.trim()} className={`${PRIMARY} h-12`}>{t("web.library.link.submit")}</button>
        </form>
      )}
    </div>
  );
}
