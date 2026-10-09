import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "~/auth/auth-context";
import { FeatureGate, type GateState } from "~/components/feature-gate";
import { PageHeader } from "~/layout/page-header";
import { fetchRankConfig } from "./rank-api";

export function MatchPage() {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [state, setState] = useState<GateState>("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setState("loading");
    fetchRankConfig(api, ctrl.signal).then((c) => setState(c.enabled ? "ready" : "disabled"), () => { if (!ctrl.signal.aborted) setState("error"); });
    return () => ctrl.abort();
  }, [api, attempt]);
  return (
    <>
      <PageHeader title={t("web.rank.match.title")} back="/rank" />
      <FeatureGate state={state} disabledText={t("web.rank.disabled")} onRetry={() => setAttempt((n) => n + 1)}>
        <div data-testid="rank-match" />
      </FeatureGate>
    </>
  );
}
