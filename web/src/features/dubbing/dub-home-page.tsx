import "./locales";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "~/auth/auth-context";
import type { DubbingKit } from "~/features/library";
import { HOME_PATH } from "~/lib/home-route";
import { useDubbingConfig } from "./config";
import { getRoles } from "./dubbing-api";
import { useDubKit } from "./kit-context";

/** `/dub`:选素材(计划 L5 R16/W7)。只列出就绪且至少两句的条目;角色状态按需取,失败不阻塞列表。 */
type LibItem = Awaited<ReturnType<DubbingKit["listItems"]>>["items"][number];
type RoleLabel = "labeled" | "unlabeled" | "unknown";

export function DubHomePage() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const kit = useDubKit();
  const config = useDubbingConfig();
  const [items, setItems] = useState<LibItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [labels, setLabels] = useState<Record<string, RoleLabel>>({});
  const asked = useRef(new Set<string>());

  const loadPage = async (cursor: string | null) => {
    setBusy(true);
    try {
      const page = await kit.listItems(api, cursor);
      setItems((prev) => (cursor ? [...prev, ...page.items] : page.items));
      setNext(page.nextCursor);
    } finally {
      setBusy(false);
      setLoaded(true);
    }
  };

  // 配置打开后加载第一页(loadPage 只依赖 kit 与 api)。
  useEffect(() => {
    if (config?.enabled) void loadPage(null);
  }, [config?.enabled, api]);

  const eligible = items.filter((i) => i.status === "ready" && i.segCount >= 2);

  useEffect(() => {
    for (const item of eligible) {
      if (asked.current.has(item.id)) continue;
      asked.current.add(item.id);
      getRoles(api, item.id).then(
        (r) => setLabels((p) => ({ ...p, [item.id]: r.speakers.some((s) => s.speaker) ? "labeled" : "unlabeled" })),
        () => setLabels((p) => ({ ...p, [item.id]: "unknown" })),
      );
    }
  }, [items, api]); // eligible 由 items 派生

  if (config && !config.enabled) return <Navigate to={HOME_PATH} replace />;

  return (
    <div className="min-h-dvh px-4 pb-24 pt-4">
      <header className="mb-4 flex items-center justify-between">
        <Link to="/practice" className="text-[13px] opacity-80">{t("web.dubbing.home.back")}</Link>
        <h1 className="text-[17px] font-semibold">{t("web.dubbing.home.title")}</h1>
        <span className="w-10" />
      </header>

      {loaded && eligible.length === 0 ? (
        <div className="rounded-2xl border border-white/20 bg-white/10 p-4 text-center">
          <p className="font-semibold">{t("web.dubbing.home.empty")}</p>
          <p className="mt-1 text-[13px] opacity-80">{t("web.dubbing.home.emptyHint")}</p>
        </div>
      ) : null}

      <ul className="space-y-2">
        {eligible.map((item) => (
          <li key={item.id}>
            <Link to={`/dub/${item.id}`} className="block rounded-2xl border border-white/20 bg-white/10 px-4 py-3">
              <span className="block text-[15px] font-medium">{item.title}</span>
              <span className="mt-1 flex items-center gap-2 text-[12px] opacity-80">
                <span>{t(item.kind === "video" ? "web.dubbing.home.video" : "web.dubbing.home.audio")}</span>
                <span>·</span>
                <span>{t("web.dubbing.home.sentences", { count: item.segCount })}</span>
                {labels[item.id] === "labeled" ? <span className="ml-auto">{t("web.dubbing.home.labeled")}</span> : null}
                {labels[item.id] === "unlabeled" ? <span className="ml-auto">{t("web.dubbing.home.unlabeled")}</span> : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {next ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void loadPage(next)}
          className="mt-4 w-full rounded-2xl border border-white/20 bg-white/10 py-2.5 text-[14px]"
        >
          {t("web.dubbing.home.next")}
        </button>
      ) : null}
    </div>
  );
}
