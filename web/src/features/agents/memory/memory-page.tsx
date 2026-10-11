import "./locales";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { SegmentedControl } from "~/components/segmented-control";
import { PageHeader } from "~/layout/page-header";
import { ItemsTab } from "./items-tab";
import { ManageTab } from "./manage-tab";
import { ProfileTab } from "./profile-tab";
import { RecapsTab } from "./recaps-tab";

const TABS = ["profile", "items", "recaps", "manage"] as const;
type Tab = (typeof TABS)[number];
const isTab = (value: string | null): value is Tab => value !== null && (TABS as readonly string[]).includes(value);

/** 设置 → 智能体 → 记忆(spec §8.4):四个分区,一次只挂载一个;分区记在 ?tab=(便于设置页深链)。 */
export function MemoryPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = isTab(raw) ? raw : "profile";
  const choose = (next: Tab) => setParams(next === "profile" ? {} : { tab: next }, { replace: true });
  return (
    <div className="flex min-h-full flex-col pb-6">
      <PageHeader title={t("web.agents.memory.title")} back="/me/agents" />
      <div className="px-gutter pt-1">
        <SegmentedControl label={t("web.agents.memory.tabsLabel")} value={tab} onChange={choose} className="flex w-full"
          optionClassName="min-w-0 flex-1 px-1"
          options={TABS.map((value) => ({ value, label: t(`web.agents.memory.tabs.${value}`), testId: `memory-tab-${value}` }))} />
      </div>
      <section aria-label={t(`web.agents.memory.tabs.${tab}`)} className="px-gutter pt-3">
        {tab === "profile" ? <ProfileTab /> : tab === "items" ? <ItemsTab /> : tab === "recaps" ? <RecapsTab /> : <ManageTab />}
      </section>
    </div>
  );
}
