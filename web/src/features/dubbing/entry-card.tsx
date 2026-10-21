import "./locales";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useDubbingEnabled } from "./use-dubbing-enabled";

/** 练习首页的入口卡(计划 L5 R16):配置关闭时不渲染;开启时链接到 /dub。 */
export function DubbingEntryCard() {
  const { t } = useTranslation();
  const enabled = useDubbingEnabled();
  if (!enabled) return null;
  return (
    <Link
      to="/dub"
      className="mx-4 mb-3 block rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-left"
    >
      <span className="block text-[15px] font-semibold">{t("web.dubbing.entry.title")}</span>
      <span className="mt-0.5 block text-[12.5px] opacity-80">{t("web.dubbing.entry.hint")}</span>
    </Link>
  );
}
