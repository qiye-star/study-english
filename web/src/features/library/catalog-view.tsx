import { BookOpenIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { translateServerError } from "~/api/error-messages";
import { LevelHint } from "~/components/level-hint";
import { levelLabel } from "~/lib/levels";
import type { CatalogCard } from "./catalog-api";
import { CatalogItemCard } from "./catalog-card";
import { LIBRARY_SERVER_ERRORS } from "./library-api";
import "./locales";
import { PageError, PageLoading } from "./page-status";
import { useCatalog } from "./use-catalog";

const ALL = "*";
const LEVEL_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"];

/** 出现过的级别,按 A1…C2 排(不认识的级别排在后面)。 */
export function levelsOf(cards: readonly CatalogCard[]): string[] {
  const seen = new Set(cards.map((c) => c.level).filter((l): l is string => !!l));
  const rank = (l: string) => (LEVEL_ORDER.includes(l) ? LEVEL_ORDER.indexOf(l) : LEVEL_ORDER.length);
  return [...seen].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * 「精选」页签的内容(`/library?tab=catalog`,spec 2026-10-14-curated-library §10;R-W2、R-W3):级别芯片(客户端筛选)+ 卡片网格 + 空状态。
 * 添加 = 幂等,成功(含「已添加过」)就进入播放页;404(条目已下架)= 吐司 + 卡片从列表里去掉(裁定 4)。
 */
export function CatalogView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const catalog = useCatalog(true);
  const [picked, setPicked] = useState(ALL);
  const levels = levelsOf(catalog.items);
  const level = levels.includes(picked) ? picked : ALL; // 选中的级别没有卡片了(下架)就回到「全部」
  const shown = level === ALL ? catalog.items : catalog.items.filter((c) => c.level === level);
  const go = (itemId: string) => navigate(`/library/${encodeURIComponent(itemId)}`);

  const onAdd = (card: CatalogCard) => {
    catalog.add(card.id).then((out) => go(out.item.id), (err: unknown) => {
      toast.error(translateServerError(t, err, LIBRARY_SERVER_ERRORS));
    });
  };
  const onOpen = (card: CatalogCard) => {
    if (card.addedItemId) go(card.addedItemId);
  };

  if (catalog.error && catalog.items.length === 0) {
    return <PageError message={translateServerError(t, catalog.error, LIBRARY_SERVER_ERRORS)} onRetry={() => void catalog.reload()} />;
  }
  if (catalog.loading && catalog.items.length === 0) return <PageLoading />;
  if (catalog.items.length === 0) {
    return (
      <div data-testid="catalog-empty" className="lib-cat-empty lib-tint">
        <div aria-hidden className="lib-cat-empty-ico"><BookOpenIcon className="h-7 w-7" /></div>
        <h3>{t("web.library.catalog.empty")}</h3>
        <p>{t("web.library.catalog.emptyHint")}</p>
      </div>
    );
  }
  return (
    <div data-testid="catalog-view">
      {levels.length > 1 ? (
        <div role="group" aria-label={t("web.library.catalog.levels")} aria-describedby="catalog-level-hint" className="lib-cat-levels">
          {[ALL, ...levels].map((l) => (
            <button key={l} type="button" className="lib-chip" aria-pressed={l === level} onClick={() => setPicked(l)}>
              {l === ALL ? t("web.library.catalog.allLevels") : levelLabel(t, l)}
            </button>
          ))}
        </div>
      ) : null}
      {levels.length > 1 ? (
        <LevelHint code={level === ALL ? null : level} fallback={t("web.level.scale")} id="catalog-level-hint" testId="catalog-level-hint" className="mx-1 mb-2 mt-1.5" />
      ) : null}
      <ul className="lib-cat-grid" data-testid="catalog-list">
        {shown.map((card, i) => (
          <CatalogItemCard key={card.id} card={card} index={i} adding={catalog.adding.has(card.id)} onAdd={onAdd} onOpen={onOpen} />
        ))}
      </ul>
    </div>
  );
}
