import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "~/auth/auth-context";
import { SectionGroup } from "~/components/section-group";
import { cn } from "~/lib/cn";
import { achievementCondition, achievementTitle, iconFor, toneFor } from "./achievements-page";
import { type AchievementItem, fetchAchievements, fetchRankMe } from "./rank-api";

/**
 * 会话小结里的「新解锁」(背单词 spec §11.2,视觉稿 10):挂载时拉一次 GET /api/rank/me(同步段位并解锁成就;
 * 新成就只返回这一次,所以就在这里展示,不再弹 toast),有新成就再拉目录取图标与分组。拉不到就什么也不显示。
 */
export function NewAchievements({ title }: { title: string }) {
  const { api } = useAuth();
  const { t } = useTranslation();
  const [items, setItems] = useState<AchievementItem[]>([]);
  // 一个实例只请求一次:StrictMode 的试卸载 / 重挂载复用同一个请求,否则第二次 /me 已经没有「新」成就了
  const request = useRef<Promise<AchievementItem[]> | null>(null);
  useEffect(() => {
    let alive = true;
    request.current ??= fetchRankMe(api).then(async (me) => {
      if (!me.newAchievements?.length) return [];
      const catalog = await fetchAchievements(api).catch((): AchievementItem[] => []);
      return me.newAchievements.map((key) => catalog.find((a) => a.key === key) ?? { key, group: "", icon: "", unlockedAt: null });
    });
    request.current.then((fresh) => { if (alive) setItems(fresh); }, (): void => undefined);
    return () => { alive = false; };
  }, [api]);
  if (!items.length) return null;
  return (
    <div data-testid="new-achievements">
      <SectionGroup title={title}>
        {items.map((item) => {
          const Icon = iconFor(item);
          return (
            <div key={item.key} className="flex min-h-row items-center gap-3 py-2.5 pl-3.5 pr-3">
              <span aria-hidden className={cn("flex size-9 flex-none items-center justify-center rounded-full", toneFor(item))}>
                <Icon className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium">{achievementTitle(t, item.key)}</span>
                <span className="mt-0.5 block text-meta text-ink-2">{achievementCondition(t, item.key)}</span>
              </span>
            </div>
          );
        })}
      </SectionGroup>
    </div>
  );
}
