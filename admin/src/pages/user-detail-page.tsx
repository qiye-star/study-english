import { Link, useParams, useSearchParams } from "react-router-dom";
import { getUser, listConversations, listPracticeItems, listUserAssessments, listVocabulary } from "../api/endpoints";
import type { ConversationItem, PracticeItem, SourceFilter, VocabularyItem, AssessmentItem } from "../api/types";
import { AssessmentCard } from "../components/assessment-card";
import { Avatar } from "../components/avatar";
import { ChevronIcon } from "../components/icons";
import { Chips, Screen, TOP_BAR_H, TopBar, UnderlineTabs } from "../components/layout";
import { UserLibraryUsage } from "../features/library";
import { UserRankPanel } from "../features/rank";
import { UserAdminPanel, UserEmailCard } from "../features/users";
import { ErrorState, PagedList, Skeleton } from "../components/states";
import { useAsync } from "../hooks/use-async";
import { usePaged } from "../hooks/use-paged";
import { formatBytes, formatDateTime, formatRelative } from "../lib/format";
import { S } from "../strings";

type Tab = "chats" | "assessments" | "practice" | "vocab" | "rank" | "admin";
/** 「段位」「治理」两个页签的内容来自 features/rank 与 features/users(各自车道实现,本页不再改) */
const TABS: Tab[] = ["chats", "assessments", "practice", "vocab", "rank", "admin"];

function Chats({ userId }: { userId: string }) {
  const paged = usePaged<ConversationItem>(async (page) => {
    const r = await listConversations(userId, page);
    return { items: r.conversations, next: r.next };
  }, [userId]);
  return (
    <PagedList paged={paged} empty={S.user.emptyChats}>
      {(items) =>
        items.map((c) => (
          <li key={c.id}>
            <Link to={`/conversations/${encodeURIComponent(c.id)}`} className="row-link">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 break-words text-base font-medium leading-snug">{c.name || "—"}</p>
                <p className="mt-0.5 text-xs text-muted">
                  <span className="num">{S.user.messagesCount(c.message_count)}</span> · {formatRelative(c.updated_at)}
                </p>
              </div>
              <ChevronIcon className="shrink-0 text-line-strong" width={18} height={18} />
            </Link>
          </li>
        ))
      }
    </PagedList>
  );
}

function Assessments({ userId }: { userId: string }) {
  const [params, setParams] = useSearchParams();
  const source = (["all", "practice", "chat"].includes(params.get("source") ?? "") ? params.get("source") : "all") as SourceFilter;
  const paged = usePaged<AssessmentItem>(async (page) => {
    const r = await listUserAssessments(userId, source, page);
    return { items: r.assessments, next: r.next };
  }, [userId, source]);
  return (
    <div className="space-y-3">
      <Chips
        label={S.assessments.sourceLabel}
        value={source}
        onChange={(v) =>
          setParams(
            (p) => {
              const n = new URLSearchParams(p);
              n.set("source", v);
              return n;
            },
            { replace: true },
          )
        }
        options={(["all", "practice", "chat"] as const).map((v) => ({ value: v, label: S.assessments.filters[v] }))}
      />
      <PagedList paged={paged} empty={S.user.emptyAssessments}>
        {(items) => items.map((a) => <AssessmentCard key={a.id} item={a} />)}
      </PagedList>
    </div>
  );
}

function Practice({ userId }: { userId: string }) {
  const paged = usePaged<PracticeItem>(async (page) => {
    const r = await listPracticeItems(userId, page);
    return { items: r.items, next: r.next };
  }, [userId]);
  return (
    <PagedList paged={paged} empty={S.user.emptyPractice}>
      {(items) =>
        items.map((p) => (
          <li key={p.id} className="row flex-col items-start gap-1.5">
            <p className="break-words text-base leading-snug">{p.text}</p>
            <p className="flex items-center gap-2 text-xs text-muted">
              <span className="chip bg-sunken text-fg-2">{S.practiceSource[p.source] ?? p.source}</span>
              <span className="num">{formatDateTime(p.created_at)}</span>
            </p>
          </li>
        ))
      }
    </PagedList>
  );
}

function Vocabulary({ userId }: { userId: string }) {
  const paged = usePaged<VocabularyItem>(async (page) => {
    const r = await listVocabulary(userId, page);
    return { items: r.items, next: r.next };
  }, [userId]);
  return (
    <PagedList paged={paged} empty={S.user.emptyVocab}>
      {(items) =>
        items.map((v) => (
          <li key={v.id} className="row flex-col items-stretch gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="break-words text-md font-semibold">{v.word}</p>
              <span className="chip num shrink-0 bg-accent-soft text-accent">{S.user.box(v.box)}</span>
            </div>
            <p className="break-words text-sm leading-snug text-fg-2">{v.meaning}</p>
            {v.example && <p className="break-words border-l-2 border-line pl-3 text-sm italic leading-snug text-muted">{v.example}</p>}
            <p className="num text-xs text-muted">
              {S.user.reps} {v.reps} · {S.user.lapses} {v.lapses} · {S.user.due} {formatDateTime(v.due_at).slice(0, 10)}
            </p>
          </li>
        ))
      }
    </PagedList>
  );
}

export function UserDetailPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab") as Tab | null;
  const tab: Tab = raw && TABS.includes(raw) ? raw : "chats";
  const { data: u, error, reload } = useAsync(() => getUser(id), [id]);

  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true });

  return (
    <>
      <TopBar title={u?.username ?? S.user.title} back="/users" />
      <Screen className="space-y-4">
        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !u ? (
          <Skeleton rows={2} variant="blocks" />
        ) : (
          <>
            <header className="fade-in flex items-center gap-3">
              <Avatar name={u.username} size={56} />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-semibold leading-tight">{u.username}</h2>
                <p className="num mt-0.5 truncate text-2xs text-muted">{u.id}</p>
                <p className="mt-1 text-xs text-muted">
                  {S.user.registered} <span className="num">{formatDateTime(u.created_at).slice(0, 10)}</span> · {S.user.lastActive} {formatRelative(u.last_active_at)}
                </p>
              </div>
            </header>

            <section className="panel fade-in" aria-label={S.user.title}>
              <dl className="grid grid-cols-3 gap-px bg-line">
                {(Object.keys(S.user.counts) as (keyof typeof u.counts)[]).map((k) => (
                  <div key={k} className="bg-surface px-3 py-2.5">
                    <dt className="eyebrow">{S.user.counts[k]}</dt>
                    <dd className="num mt-0.5 text-md font-semibold leading-none">{u.counts[k]}</dd>
                  </div>
                ))}
                <div className="bg-surface px-3 py-2.5">
                  <dt className="eyebrow">{S.user.recordings}</dt>
                  <dd className="num mt-0.5 text-md font-semibold leading-none">{formatBytes(u.recording_bytes)}</dd>
                </div>
              </dl>
              {u.grammar_prompt && (
                <details className="border-t border-line px-4 py-1 text-sm">
                  <summary className="flex min-h-[40px] cursor-pointer items-center text-fg-2">{S.user.grammarPrompt}</summary>
                  <p className="mb-2 whitespace-pre-wrap break-words rounded-lg bg-sunken px-3 py-2 text-sm leading-relaxed">{u.grammar_prompt}</p>
                </details>
              )}
            </section>

            <UserEmailCard userId={id} emailMasked={u.email_masked ?? null} emailVerified={!!u.email_verified} onChanged={reload} />

            <UserLibraryUsage userId={id} />

            <div className="sticky z-10-mx-4 border-b border-line bg-bg/88 px-4 backdrop-blur-xl" style={{ top: `calc(${TOP_BAR_H}px + env(safe-area-inset-top))` }}>
              <UnderlineTabs label="内容" value={tab} onChange={setTab} options={TABS.map((t) => ({ value: t, label: S.user.tabs[t] }))} />
            </div>

            {tab === "chats" && <Chats userId={id} />}
            {tab === "assessments" && <Assessments userId={id} />}
            {tab === "practice" && <Practice userId={id} />}
            {tab === "vocab" && <Vocabulary userId={id} />}
            {tab === "rank" && <UserRankPanel userId={id} />}
            {tab === "admin" && <UserAdminPanel userId={id} />}
          </>
        )}
      </Screen>
    </>
  );
}
