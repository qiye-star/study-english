import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import i18n from "i18next";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { savePracticeItem } from "./save-practice-item";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: (): null => null }));

const ITEM = { id: "p1", text: "Hi.", source: "chat", created_at: "2026-10-05T00:00:00+00:00" };
const t = i18n.t.bind(i18n);

function apiFor(route: () => Response) {
  const mock = createFetchMock({ "POST /api/practice-items": route });
  return { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), mock };
}

describe("savePracticeItem", () => {
  beforeEach(() => { vi.mocked(toast.error).mockClear(); vi.mocked(toast.success).mockClear(); });

  it("toasts success once", async () => {
    const { api, mock } = apiFor(() => json(ITEM, 201));
    expect(await savePracticeItem(api, t, "  Hi.  ", "chat")).toBe(true);
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ text: "Hi.", source: "chat" });
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Saved to your practice list.");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("treats a duplicate (existing item, 200) as a normal save", async () => {
    const { api } = apiFor(() => json(ITEM, 200));
    expect(await savePracticeItem(api, t, "Hi.", "chat")).toBe(true);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("translates the limit error", async () => {
    const { api } = apiFor(() => json({ error: "Practice item limit reached" }, 429));
    expect(await savePracticeItem(api, t, "Hi.", "chat")).toBe(false);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("Your practice list is full. Delete some sentences first.");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("uses the generic message for unknown errors", async () => {
    const { api } = apiFor(() => json({ error: "weird" }, 500));
    expect(await savePracticeItem(api, t, "Hi.", "chat")).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("Something went wrong.");
  });
});
