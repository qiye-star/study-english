import { useSearchParams } from "react-router-dom";
import { listAssessments } from "../api/endpoints";
import type { AssessmentItem, SourceFilter } from "../api/types";
import { AssessmentCard } from "../components/assessment-card";
import { Chips, Screen, TopBar } from "../components/layout";
import { PagedList } from "../components/states";
import { usePaged } from "../hooks/use-paged";
import { S } from "../strings";

export function AssessmentsPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("source");
  const source: SourceFilter = raw === "practice" || raw === "chat" ? raw : "all";
  const paged = usePaged<AssessmentItem>(async (page) => {
    const r = await listAssessments(source, page);
    return { items: r.assessments, next: r.next };
  }, [source]);

  return (
    <>
      <TopBar title={S.assessments.title} />
      <Screen className="space-y-3">
        <Chips
          label={S.assessments.sourceLabel}
          value={source}
          onChange={(v) => setParams(v === "all" ? {} : { source: v }, { replace: true })}
          options={(["all", "practice", "chat"] as const).map((v) => ({ value: v, label: S.assessments.filters[v] }))}
        />
        <PagedList paged={paged} empty={S.assessments.emptyAll}>
          {(items) => items.map((a) => <AssessmentCard key={a.id} item={a} showUser />)}
        </PagedList>
      </Screen>
    </>
  );
}
