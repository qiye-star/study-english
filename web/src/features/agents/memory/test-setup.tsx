import type { ReactElement } from "react";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { MemoryPage } from "./memory-page";
import { PAGE, RECAPS, STATE } from "./test-fixtures";

/** 默认回应三个只读端点;extra 覆盖或追加路由。返回 fetch 记录。 */
export function setupMemory(extra: Parameters<typeof createFetchMock>[0] = {}, route = "/me/agents/memory",
  ui: ReactElement = <MemoryPage />) {
  const mock = createFetchMock({
    "GET /api/agents/memory/profile": () => json(STATE),
    "GET /api/agents/memory/items": () => json(PAGE),
    "GET /api/agents/memory/recaps": () => json(RECAPS),
    ...extra,
  });
  renderWithProviders(ui, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route, path: "/me/agents/memory" });
  return mock;
}
