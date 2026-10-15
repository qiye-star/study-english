import { CheckIcon, ChevronRightIcon, HeadphonesIcon, LoaderIcon, PlusIcon } from "lucide-react";
import { type CSSProperties, useRef } from "react";
import { useTranslation } from "react-i18next";
import { levelLabel } from "~/lib/levels";
import type { CatalogCard } from "./catalog-api";
import { fetchCatalogPoster } from "./catalog-api";
import { SpecularButton } from "./fx/specular-button";
import { SpotlightCard } from "./fx/spotlight-card";
import { formatDuration } from "./format";
import "./locales";
import { usePosterUrl } from "./use-poster";

const MAX_TAGS = 3;

/**
 * 精选目录的一张卡(设计稿 curated-library-v1,画面 2):窄屏(≤ 390)是紧凑行卡(小封面在左、文字在右),≥ 430 才是 2 列大卡(见 library.css `.lib-cat-*`)。
 * 卡片是 SpotlightCard(半透明 + 高光边,不加模糊);封面 16:9,没有封面时是耳机图标的渐变底;许可说明一行(ink-2,80%)。
 * 按钮三态:添加到我的库(主按钮)/ 正在添加(留在主按钮蓝色,转圈)/ 已添加 · 去学习(次按钮)。
 * 已添加时旁边有次要按钮『取消入库』(计划 2026-10-15-catalog-cancel-add,R-C5)。
 */
export function CatalogItemCard({ card, index = 0, adding, removing = false, onAdd, onOpen, onRemove }: {
  card: CatalogCard; index?: number; adding: boolean; removing?: boolean;
  onAdd(card: CatalogCard): void; onOpen(card: CatalogCard): void; onRemove?(card: CatalogCard): void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLLIElement>(null);
  const poster = usePosterUrl(card.id, card.hasPoster, ref, fetchCatalogPoster);
  const meta = [
    card.durationMs ? formatDuration(card.durationMs) : null,
    t("web.library.sentences", { count: card.segCount }),
  ].filter(Boolean).join(" · ");

  return (
    <li ref={ref} data-testid={`catalog-card-${card.id}`}>
      <SpotlightCard className="lib-cat-card lib-rise" style={{ "--lib-delay": `${(Math.min(index, 8) * 0.07).toFixed(2)}s` } as CSSProperties}>
        <div aria-hidden className="lib-cat-poster">
          {poster ? <img src={poster} alt="" /> : <HeadphonesIcon className="h-6 w-6" />}
        </div>
        <div className="lib-cat-body">
          <h3 className="lib-cat-title">{card.title}</h3>
          <div className="lib-cat-tags">
            {card.level ? <span className="lib-cat-level">{levelLabel(t, card.level)}</span> : null}
            {card.tags.slice(0, MAX_TAGS).map((tag) => <span key={tag} className="lib-cat-tag">{tag}</span>)}
          </div>
          <div className="lib-cat-meta num">{meta}</div>
          {card.licenseNote ? <div className="lib-cat-license">{card.licenseNote}</div> : null}
        </div>
        <div className="lib-cat-act">
          {card.addedItemId ? (
            <>
              <button type="button" disabled={removing} className="lib-cat-open lib-cat-btn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpen(card)}>
                <CheckIcon aria-hidden className="ok h-4 w-4" />{t("web.library.catalog.added")}<span aria-hidden className="sep">·</span>
                {t("web.library.catalog.open")}<ChevronRightIcon aria-hidden className="h-4 w-4" />
              </button>
              {onRemove ? (
                <button type="button" className="lib-cat-undo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  disabled={removing} aria-busy={removing || undefined}
                  aria-label={t("web.library.catalog.removeLabel", { title: card.title })} onClick={() => onRemove(card)}>
                  {t("web.library.catalog.remove")}
                </button>
              ) : null}
            </>
          ) : (
            <SpecularButton className="lib-cat-btn" disabled={adding} aria-busy={adding || undefined} onClick={() => onAdd(card)}>
              {adding ? <LoaderIcon aria-hidden className="animate-spin" /> : <PlusIcon aria-hidden />}
              {t(adding ? "web.library.catalog.adding" : "web.library.catalog.add")}
            </SpecularButton>
          )}
        </div>
      </SpotlightCard>
    </li>
  );
}
