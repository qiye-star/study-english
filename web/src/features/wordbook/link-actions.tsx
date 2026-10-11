/**
 * 单词操作联动里属于词书的两行(spec §6.1):「加入词书学习」与「查看词卡」。wordbook 内部文件,只由
 * `register-word-actions.tsx` 登记进 wordActionsMenu 插槽;词书是否开启由登记处判断。
 */
import { BookOpenIcon, ChevronDownIcon, GalleryVerticalEndIcon, LoaderIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ApiError, type ApiClient } from "~/api/client";
import { translateServerError } from "~/api/error-messages";
import { useAuth } from "~/auth/auth-context";
import { IconChip } from "~/components/icon-chip";
import { ListRow } from "~/components/section-group";
import type { PointProps } from "~/lib/extension-points";
import type { BookId, Card, ItemState } from "./wordbook-api";

export type AdoptStatus = "added" | "known" | "not_in_book";
export interface AdoptResult { status: AdoptStatus; bookId: BookId | null }
export interface LinkCard { bookId: BookId; card: Card; item: ItemState | null }

/** feature 不能导入 plugins/,所以这里是 `plugins/links` 的 LINKS_SERVER_ERRORS 的同键小表(文案在 web.links.errors.*)。 */
const LINK_ERRORS: Record<string, string> = {
  "Link is off": "web.links.errors.off",
  "Word not found": "web.links.errors.wordNotFound",
  "Wordbook is disabled": "web.links.errors.wordbookOff",
  "Wordbook data unavailable": "web.links.errors.wordbookData",
  "Daily adopt limit reached": "web.links.errors.adoptLimit",
};

export const adoptWord = (api: ApiClient, word: string) =>
  api.request<AdoptResult>("POST", "/api/links/wordbook/adopt", { json: { word } });
export const fetchLinkCard = (api: ApiClient, word: string) =>
  api.request<LinkCard>("POST", "/api/links/wordbook/card", { json: { word } }); // body, not URL: keeps words out of access logs

function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return mounted;
}

const ADOPT_TEXT: Record<AdoptStatus, string> = {
  added: "web.links.wordActions.adopted",
  known: "web.links.wordActions.known",
  not_in_book: "web.links.wordActions.notInBook",
};

/** 「加入词书学习」:点一次 → 服务端建一条立即到期的 box 0 词条;有结果后整行变为说明文字、不可再点(不受每日新词目标限制)。 */
export function AdoptRow({ target }: PointProps["wordActionsMenu"]) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const mounted = useMounted();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<AdoptStatus | null>(null);
  const busyRef = useRef(false);
  const adopt = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await adoptWord(api, target.word);
      if (mounted.current) setStatus(res.status);
    } catch (err) {
      toast.error(translateServerError(t, err, LINK_ERRORS));
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const icon = <IconChip tone="teal" icon={BookOpenIcon} className={status === "not_in_book" ? "opacity-50" : undefined} />;
  if (status) {
    return <ListRow testId="word-actions-adopt" icon={icon} title={t("web.links.wordActions.adopt")} subtitle={t(ADOPT_TEXT[status])}
      className={status === "not_in_book" ? "text-ink-3" : undefined} />;
  }
  return (
    <ListRow testId="word-actions-adopt" icon={icon} title={t("web.links.wordActions.adopt")} subtitle={t("web.links.wordActions.adoptHint")}
      trailing={busy ? <LoaderIcon aria-hidden className="h-[18px] w-[18px] flex-none animate-spin text-ink-3" /> : undefined}
      onClick={() => void adopt()} />
  );
}

// 词卡与朗读只在第一次展开时加载(主包增长有上限,验收 8)
const LazyLinkCard = lazy(() => Promise.all([import("./word-card"), import("./use-speaker")]).then(([cardModule, speakerModule]) => {
  function LinkCardView({ card }: { card: Card }) {
    const speaker = speakerModule.useSpeaker();
    return <cardModule.WordCardView card={card} className="mx-3 mb-3 mt-1" onListen={speaker.listen} listening={speaker.active}
      canListen={speaker.available} />;
  }
  return { default: LinkCardView };
}));

type CardState = { phase: "idle" } | { phase: "loading" } | { phase: "shown"; card: Card } | { phase: "missing" };

/** 「查看词卡」:在行下方展开词卡(复用 WordCardView);词书里都没有 → 「词书里没有这个词」。 */
export function CardRow({ target }: PointProps["wordActionsMenu"]) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const mounted = useMounted();
  const [state, setState] = useState<CardState>({ phase: "idle" });
  const toggle = async () => {
    if (state.phase === "loading") return;
    if (state.phase === "shown" || state.phase === "missing") {
      setState({ phase: "idle" });
      return;
    }
    setState({ phase: "loading" });
    try {
      const res = await fetchLinkCard(api, target.word);
      if (mounted.current) setState({ phase: "shown", card: res.card });
    } catch (err) {
      if (!mounted.current) return;
      if (err instanceof ApiError && err.message === "Word not found") {
        setState({ phase: "missing" });
      } else {
        setState({ phase: "idle" });
        toast.error(translateServerError(t, err, LINK_ERRORS));
      }
    }
  };
  const open = state.phase === "shown" || state.phase === "missing";
  return (
    <div>
      <ListRow testId="word-actions-card" icon={<IconChip tone="gray" icon={GalleryVerticalEndIcon} />}
        title={t("web.links.wordActions.card")} subtitle={t("web.links.wordActions.cardHint")} chevron={false}
        trailing={state.phase === "loading"
          ? <LoaderIcon aria-label={t("web.links.wordActions.loading")} className="h-[18px] w-[18px] flex-none animate-spin text-ink-3" />
          : <ChevronDownIcon aria-hidden className={`h-[18px] w-[18px] flex-none text-ink-3 transition-transform duration-fast${open ? " rotate-180" : ""}`} />}
        onClick={() => void toggle()} />
      {state.phase === "shown" ? (
        <Suspense fallback={null}><LazyLinkCard card={state.card} /></Suspense>
      ) : null}
      {state.phase === "missing" ? (
        <p role="status" className="px-3.5 pb-3 text-sub text-ink-2">{t("web.links.wordActions.noCard")}</p>
      ) : null}
    </div>
  );
}
