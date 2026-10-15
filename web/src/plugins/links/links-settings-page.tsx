import { LoaderIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cn } from "@renderer/lib/utils";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { LQ_PAGE } from "~/components/liquid";
import { ListRow, SectionGroup } from "~/components/section-group";
import { PageHeader } from "~/layout/page-header";
import { flagsFromConfig, setLinkFlags, type LinkKey } from "~/lib/extension-points";
import { LINKS_SERVER_ERRORS, fetchLinksConfig, putLinkPref, type LinkItem, type LinksConfig } from "./links-api";

type State = { status: "loading" } | { status: "error" } | { status: "ready"; config: LinksConfig };

function toggled(config: LinksConfig, key: LinkKey): LinksConfig {
  return {
    ...config,
    links: config.links.map((l) => (l.key === key
      ? { ...l, user: !l.user, effective: config.enabled && l.global && !l.user } : l)),
  };
}

/** 「我的 → 学习联动」(spec §7.2):六个开关;管理员关掉的置灰并说明;乐观更新,失败回滚。 */
export function LinksSettingsPage() {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const saving = useRef(new Set<LinkKey>());

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    fetchLinksConfig(api, controller.signal).then(
      (config) => { if (!controller.signal.aborted) setState({ status: "ready", config }); },
      () => { if (!controller.signal.aborted) setState({ status: "error" }); },
    );
    return () => controller.abort();
  }, [api, attempt]);

  const toggle = useCallback(async (item: LinkItem) => {
    if (state.status !== "ready" || !item.global || saving.current.has(item.key)) return;
    const before = state.config;
    saving.current.add(item.key);
    setState({ status: "ready", config: toggled(before, item.key) });
    try {
      const next = await putLinkPref(api, item.key, !item.user);
      setState({ status: "ready", config: next });
      setLinkFlags(flagsFromConfig(next));
    } catch (err) {
      setState({ status: "ready", config: before });
      toast.error(t("web.links.settings.saveFailed"), { description: translateServerError(t, err, LINKS_SERVER_ERRORS) });
    } finally {
      saving.current.delete(item.key);
    }
  }, [api, state, t]);

  return (
    <div>
      <PageHeader title={t("web.links.settings.title")} back="/me" />
      <div className={`px-gutter pb-6 ${LQ_PAGE}`}>
        <p className="px-0.5 pt-1 text-sub text-ink-2">{t("web.links.settings.lede")}</p>
        {state.status === "loading" && (
          <div data-testid="links-settings-loading" className="flex justify-center py-16 text-ink-2">
            <LoaderIcon className="size-5 animate-spin" aria-label={t("web.common.loading")} />
          </div>
        )}
        {state.status === "error" && (
          <div role="alert" className="flex flex-col items-center gap-2 py-16 text-sub text-ink-2">
            <p>{t("web.common.loadFailed")}</p>
            <button type="button" data-testid="links-settings-retry" onClick={() => setAttempt((n) => n + 1)}
              className="min-h-11 px-4 font-semibold text-blue">{t("web.common.retry")}</button>
          </div>
        )}
        {state.status === "ready" && (
          <SectionGroup title={t("web.links.settings.group")}>
            {state.config.links.map((item) => {
              const title = t(`web.links.names.${item.key}`);
              return (
                <ListRow key={item.key} title={title} testId={`link-row-${item.key}`}
                  subtitle={item.global ? t(`web.links.desc.${item.key}`) : t("web.links.settings.adminOff")}
                  trailing={(
                    <button type="button" role="switch" aria-checked={item.effective} aria-disabled={!item.global}
                      aria-label={title} data-testid={`link-switch-${item.key}`} onClick={() => void toggle(item)}
                      className={cn(
                        "hit-expand relative inline-flex h-[26px] w-11 flex-none items-center rounded-full transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        item.effective ? "bg-blue" : "bg-surface-2 shadow-hair liquid:bg-wash-2",
                        !item.global && "cursor-not-allowed opacity-50",
                      )}>
                      <span aria-hidden className={cn(
                        "inline-block h-[22px] w-[22px] rounded-full bg-white shadow transition-transform duration-fast",
                        item.effective ? "translate-x-[20px]" : "translate-x-[2px]",
                      )} />
                    </button>
                  )} />
              );
            })}
          </SectionGroup>
        )}
      </div>
    </div>
  );
}
