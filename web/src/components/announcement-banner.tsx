import { TriangleAlert, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { fetchAnnouncements, type Announcement, type AnnouncementsState } from "~/api/announcements";
import { ApiClient } from "~/api/client";

/**
 * 公告与维护状态的共享存储:第一个订阅者挂载时拉取一次,之后每 5 分钟、页面重新可见时刷新。
 * 公开接口无需登录,所以用一个不带 token 的 ApiClient(同源,不发往第三方)。
 */
const REFRESH_MS = 5 * 60_000;
const DISMISSED_KEY = "announcement.dismissed";
const publicApi = new ApiClient({ getToken: () => null });

let current: AnnouncementsState | null = null;
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

/** 立即重新拉取(维护页的"重新检查")。 */
export async function refreshAnnouncements(): Promise<void> {
  return refresh();
}

async function refresh(): Promise<void> {
  try {
    const next = await fetchAnnouncements(publicApi);
    if (next) {
      current = next;
      listeners.forEach((l) => l());
    }
  } catch {
    /* 拉不到公告不影响使用;下次刷新再试 */
  }
}

function onVisibility() {
  if (document.visibilityState === "visible") void refresh();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  subscribers += 1;
  if (subscribers === 1) {
    void refresh();
    timer = setInterval(() => void refresh(), REFRESH_MS);
    document.addEventListener("visibilitychange", onVisibility);
  }
  return () => {
    listeners.delete(listener);
    subscribers -= 1;
    if (subscribers === 0) {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    }
  };
}

const snapshot = () => current;

/** 当前公告与维护状态(未拉到前为 null)。 */
export function useAnnouncements(): AnnouncementsState | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** 测试用:清空缓存。 */
export function resetAnnouncementsForTests(): void {
  current = null;
  lastMaintenanceNote = -Infinity;
}

const MAINTENANCE_REFRESH_MS = 10_000;
let lastMaintenanceNote = -Infinity;

/** 某个 API 返回了 503 Maintenance:立即刷新维护状态(最多每 10 秒一次),维护页/横幅马上出现。 */
export function noteMaintenance(now: number = Date.now()): void {
  if (now - lastMaintenanceNote < MAINTENANCE_REFRESH_MS) return;
  lastMaintenanceNote = now;
  void refresh();
}

/** 按界面语言选文案:中文界面用中文;其他语言用英文,英文为空时回退中文。 */
export function pickText(language: string | undefined, zh: string, en: string): string {
  return language?.toLowerCase().startsWith("zh") ? zh || en : en || zh;
}

function loadDismissed(): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((v): v is number => typeof v === "number") : [];
  } catch {
    return [];
  }
}

function saveDismissed(ids: number[]): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids.slice(-50)));
  } catch {
    /* 隐私模式等:只在本次会话内隐藏 */
  }
}

function Row({ tone, children, onDismiss, dismissLabel }: { tone: "warning" | "info"; children: React.ReactNode; onDismiss?: () => void; dismissLabel: string }) {
  return (
    <div className={`flex items-center gap-1 pl-4 text-[13px] leading-[18px] text-ink ${tone === "warning" ? "bg-amber-tint" : "bg-surface-2"} mat-surface liquid:mx-frame liquid:mt-2 liquid:gap-2 liquid:rounded-tile liquid:pl-3.5 liquid:text-sub`}>
      {tone === "warning" ? <TriangleAlert aria-hidden className="hidden h-4 w-4 flex-none text-amber liquid:block" /> : null}
      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words py-2.5">{children}</p>
      {onDismiss ? (
        <button type="button" aria-label={dismissLabel} onClick={onDismiss} className="flex h-11 w-11 shrink-0 items-center justify-center text-ink-2">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : (
        <span className="w-4 shrink-0" />
      )}
    </div>
  );
}

/**
 * 网页端公告横幅(redesign-v3 一色一义:warning = amber 色调,info = 中性底,文字 ink;不模糊)。
 * 液态皮肤(Rev 4):不模糊的 E1 面板 + 16px 琥珀图标(设计稿 .banner)。
 * 可关闭的公告记在 localStorage["announcement.dismissed"];只读维护时追加一条"暂时只能查看"。
 */
export function AnnouncementBanner() {
  const data = useAnnouncements();
  const { t, i18n } = useTranslation();
  const [dismissed, setDismissed] = useState<number[]>(loadDismissed);
  if (!data) return null;
  const visible = data.announcements.filter((a: Announcement) => !(a.dismissible && dismissed.includes(a.id)));
  const readOnly = data.maintenance.mode === "read_only";
  if (!visible.length && !readOnly) return null;
  const dismiss = (id: number) => {
    const next = [...dismissed.filter((d) => d !== id), id];
    setDismissed(next);
    saveDismissed(next);
  };
  const message = pickText(i18n.language, data.maintenance.messageZh, data.maintenance.messageEn);
  return (
    <section aria-label={t("web.announcements.label")} className="shrink-0 divide-y divide-black/5 pt-[env(safe-area-inset-top)] dark:divide-white/10 liquid:divide-y-0">
      {readOnly && (
        <Row tone="warning" dismissLabel={t("web.announcements.dismiss")}>
          <span className="font-medium">{t("web.announcements.readOnly")}</span>
          {message && <span>{` · ${message}`}</span>}
        </Row>
      )}
      {visible.map((a) => (
        <Row key={a.id} tone={a.level} dismissLabel={t("web.announcements.dismiss")} onDismiss={a.dismissible ? () => dismiss(a.id) : undefined}>
          {pickText(i18n.language, a.textZh, a.textEn)}
        </Row>
      ))}
    </section>
  );
}
