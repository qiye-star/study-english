import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserLibraryUsage } from "./user-library-usage";

const body = {
  user_id: 10000101, enabled: true, items: 2, bytes: 12582912, quota_mb: 2000, max_items: 100,
  by_status: { uploading: 0, queued: 0, processing: 0, ready: 2, failed: 0, canceled: 0 },
};

function stub(out: unknown, status = 200) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify(out), { status, headers: { "Content-Type": "application/json" } });
    }),
  );
  return calls;
}

const renderUsage = () =>
  render(
    <MemoryRouter>
      <UserLibraryUsage userId="10000101" />
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("UserLibraryUsage", () => {
  it("shows items, bytes and the effective quota with a link to the filtered list", async () => {
    const calls = stub(body);
    renderUsage();
    expect(await screen.findByText("2 / 100 条 · 已用 12.0 MB / 配额 2,000 MB")).toBeTruthy();
    expect(calls).toEqual(["/api/admin/library/users/10000101"]);
    expect(screen.getByRole("link", { name: "查看条目" }).getAttribute("href")).toBe("/library?user=10000101");
  });

  it("renders nothing while the library is off and the user has no items", async () => {
    const calls = stub({ ...body, enabled: false, items: 0, bytes: 0 });
    const { container } = renderUsage();
    await waitFor(() => expect(calls).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.textContent).toBe("");
  });

  it("still shows old items after the library was switched off", async () => {
    stub({ ...body, enabled: false });
    renderUsage();
    expect(await screen.findByText("2 / 100 条 · 已用 12.0 MB / 配额 2,000 MB")).toBeTruthy();
  });

  it("shows a quiet line when the request fails", async () => {
    stub({ error: "boom" }, 500);
    renderUsage();
    expect(await screen.findByText("跟读库占用读取失败")).toBeTruthy();
  });
});
