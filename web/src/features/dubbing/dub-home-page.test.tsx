import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DubbingKit } from "~/features/library";
import { HOME_PATH } from "~/lib/home-route";

const h = vi.hoisted(() => {
  const request = vi.fn();
  return {
    request,
    // 稳定的假客户端:useDubbingConfig 以 api 为依赖,每次渲染换新对象会循环。
    api: { request } as { request: typeof request },
    listItems: vi.fn(),
    config: { enabled: true, suggest: false, limits: null as null },
  };
});

vi.mock("~/auth/auth-context", () => ({ useAuth: () => ({ api: h.api }) }));

import { DubKitProvider } from "./kit-context";
import { DubHomePage } from "./dub-home-page";

const ready = (id: string, over: Record<string, unknown> = {}) => ({
  id, kind: "video", source: "upload", title: `Title ${id}`, status: "ready", segCount: 6, hasPoster: false, catalogId: null as string | null, ...over,
});

const fakeKit = { listItems: (...args: unknown[]) => h.listItems(...args) } as unknown as DubbingKit;

/** 假 HTTP:配置、角色按路径应答;其余路径失败。 */
function routeRequests(roles: Record<string, unknown | Error>) {
  h.request.mockImplementation(async (_method: string, path: string) => {
    if (path === "/api/dubbing/config") return h.config;
    const m = /^\/api\/dubbing\/items\/([^/]+)\/roles$/.exec(path);
    if (m) {
      const v = roles[m[1]];
      if (v instanceof Error) throw v;
      return v ?? { names: [], speakers: [], editable: true, locked: null };
    }
    throw new Error(`unexpected ${path}`);
  });
}

function renderPage() {
  let where = "";
  function Where(): null {
    where = useLocation().pathname;
    return null;
  }
  render(
    <MemoryRouter initialEntries={["/dub"]}>
      <DubKitProvider kit={fakeKit}>
        <Routes>
          <Route path="/dub" element={<DubHomePage />} />
          <Route path={HOME_PATH} element={<div>home</div>} />
        </Routes>
      </DubKitProvider>
      <Where />
    </MemoryRouter>,
  );
  return { where: () => where };
}

describe("dub home page (plan L5 W7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.config = { enabled: true, suggest: false, limits: null };
    // 配置按 api 对象缓存(WeakMap):每个用例换一个新客户端,避免上一个用例的配置残留。
    h.api = { request: h.request };
  });

  it("lists only ready items with at least two sentences, and shows the role state of each", async () => {
    h.listItems.mockResolvedValue({
      items: [ready("a"), ready("b", { status: "processing" }), ready("c", { segCount: 1 }), ready("d")],
      nextCursor: null,
    });
    routeRequests({
      a: { names: [], speakers: [{ idx: 0, speaker: "A" }], editable: true, locked: null },
      d: { names: [], speakers: [{ idx: 0, speaker: null }], editable: true, locked: null },
    });
    renderPage();
    expect(await screen.findByText("Title a")).toBeInTheDocument();
    expect(screen.getByText("Title d")).toBeInTheDocument();
    expect(screen.queryByText("Title b")).toBeNull();
    expect(screen.queryByText("Title c")).toBeNull();
    expect(await screen.findByText("Roles set")).toBeInTheDocument();
    expect(await screen.findByText("Roles not set")).toBeInTheDocument();
  });

  it("a failed role request does not block the list", async () => {
    h.listItems.mockResolvedValue({ items: [ready("a")], nextCursor: null });
    routeRequests({ a: new Error("boom") });
    renderPage();
    expect(await screen.findByText("Title a")).toBeInTheDocument();
    expect(screen.queryByText("Roles set")).toBeNull();
    expect(screen.queryByText("Roles not set")).toBeNull();
  });

  it("the next-page button loads the next cursor", async () => {
    h.listItems
      .mockResolvedValueOnce({ items: [ready("a")], nextCursor: "cur-2" })
      .mockResolvedValueOnce({ items: [ready("e")], nextCursor: null });
    routeRequests({});
    renderPage();
    await screen.findByText("Title a");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Next page" })); });
    expect(await screen.findByText("Title e")).toBeInTheDocument();
    expect(h.listItems).toHaveBeenLastCalledWith(expect.anything(), "cur-2");
  });

  it("an empty library explains where to add material", async () => {
    h.listItems.mockResolvedValue({ items: [], nextCursor: null });
    routeRequests({});
    renderPage();
    expect(await screen.findByText("No material to dub yet")).toBeInTheDocument();
    expect(screen.getByText(/shadowing library/i)).toBeInTheDocument();
  });

  it("when the feature is off, /dub goes back to the home page", async () => {
    h.config = { enabled: false, suggest: false, limits: null };
    h.listItems.mockResolvedValue({ items: [], nextCursor: null });
    routeRequests({});
    const { where } = renderPage();
    await waitFor(() => expect(where()).toBe(HOME_PATH));
  });
});
