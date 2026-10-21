import "./locales";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/** 首次录制前提示戴耳机(计划 L5 R14)。已读记在 localStorage;读写都包 try/catch,读不到就每次都提示。 */
const KEY = "dubbing.headphoneHint.seen";

export function headphoneHintSeen(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function rememberHeadphoneHint(): void {
  try {
    globalThis.localStorage?.setItem(KEY, "1");
  } catch {
    // 存不下就下次再提示
  }
}

export function HeadphoneHint() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(() => !headphoneHintSeen());
  if (!open) return null;
  return (
    <div role="note" className="rounded-2xl bg-white/15 p-3 text-[13px]">
      <p>{t("web.dubbing.headphones.hint")}</p>
      <button
        type="button"
        onClick={() => {
          rememberHeadphoneHint();
          setOpen(false);
        }}
        className="mt-2 rounded-lg bg-white/25 px-3 py-1"
      >
        {t("web.dubbing.headphones.ok")}
      </button>
    </div>
  );
}
