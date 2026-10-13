import { ClipboardPasteIcon, InfoIcon, Link2OffIcon, LoaderIcon, TriangleAlertIcon } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { SpecularButton } from "./fx/specular-button";
import { LIBRARY_SERVER_ERRORS, MAX_TITLE_CHARS, MAX_URL_CHARS, importLink, type LibraryItem } from "./library-api";
import "./locales";

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

/** 只有能读剪贴板(安全上下文)才给「粘贴」按钮(R-A13)。 */
const canPaste = (): boolean => typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function";

/** 链接页签(spec §7.4、§11.3):DRM 文案常驻(着色卡片);开关关时只显示说明。链接只放在 POST 体里。 */
export function ImportForm({ linkImport, onImported }: { linkImport: boolean; onImported: (item: LibraryItem) => void }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urlInput = useRef<HTMLInputElement>(null);

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

  // 必须在点击手势里调用(iOS 会弹「粘贴」确认气泡);读到的内容只进输入框状态,不记日志(隐私)。
  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) {
        setUrl(text);
        setError(null);
        return;
      }
    } catch { /* 被拒绝或不支持:不报错,让用户自己长按粘贴 */ }
    urlInput.current?.focus();
  };

  const pasteable = canPaste();

  return (
    <div className="flex flex-col gap-3" data-testid="library-import">
      <div data-testid="library-drm-note" className="lib-note lib-note--warn">
        <InfoIcon aria-hidden />
        <p>{t("web.library.link.drm")}</p>
      </div>
      {!linkImport ? (
        <div data-testid="library-link-disabled" role="status" className="lib-note">
          <Link2OffIcon aria-hidden />
          <p>{t("web.library.link.disabled")}</p>
        </div>
      ) : (
        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-3" aria-busy={busy || undefined}>
          <div className={`lib-ffield${pasteable ? " lib-ffield--paste" : ""}`}>
            <label className="lib-ffield-in">
              <span className="lib-ffield-label">{t("web.library.link.url")}</span>
              <input ref={urlInput} type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} maxLength={MAX_URL_CHARS}
                placeholder={t("web.library.link.placeholder")} value={url} className="lib-ffield-input" onChange={(e) => setUrl(e.target.value)} />
            </label>
            {pasteable ? (
              <button type="button" className="lib-chip lib-ffield-paste text-blue" onClick={() => void paste()}>
                <ClipboardPasteIcon aria-hidden />{t("web.library.link.paste")}
              </button>
            ) : null}
          </div>
          <label className="lib-ffield">
            <span className="lib-ffield-label">{t("web.library.link.titleLabel")}</span>
            <input type="text" autoComplete="off" value={title} maxLength={MAX_TITLE_CHARS} className="lib-ffield-input" onChange={(e) => setTitle(e.target.value)} />
          </label>
          {error ? (
            <div role="alert" className="lib-note lib-note--err">
              <TriangleAlertIcon aria-hidden />
              <p>{error}</p>
            </div>
          ) : null}
          <p className="text-meta text-ink-2">{t("web.library.link.note")}</p>
          <SpecularButton type="submit" disabled={busy || !url.trim()} className="h-12">
            {busy ? (
              <>
                <LoaderIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
                {t("web.library.link.submitting")}
              </>
            ) : t("web.library.link.submit")}
          </SpecularButton>
        </form>
      )}
    </div>
  );
}
