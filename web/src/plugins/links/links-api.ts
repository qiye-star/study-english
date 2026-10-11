import type { ApiClient } from "~/api/client";
import type { LinkKey } from "~/lib/extension-points";

export interface LinkItem { key: LinkKey; global: boolean; user: boolean; effective: boolean }
export interface LinksConfig { enabled: boolean; links: LinkItem[] }
/** 服务端 `{"error": …}` 原文 → 文案键(spec §11);各联动插件共用。 */
export const LINKS_SERVER_ERRORS: Record<string, string> = {
  "Links are disabled": "web.links.errors.disabled",
  "Link is off": "web.links.errors.off",
  "Unknown link": "web.links.errors.unknown",
  "Word not found": "web.links.errors.wordNotFound",
  "Wordbook is disabled": "web.links.errors.wordbookOff",
  "Wordbook data unavailable": "web.links.errors.wordbookData",
  "Daily adopt limit reached": "web.links.errors.adoptLimit",
};
export const fetchLinksConfig = (api: ApiClient, signal?: AbortSignal) => api.request<LinksConfig>("GET", "/api/links/config", { signal });
export const putLinkPref = (api: ApiClient, key: LinkKey, enabled: boolean) =>
  api.request<LinksConfig>("PUT", "/api/links/prefs", { json: { key, enabled } });
