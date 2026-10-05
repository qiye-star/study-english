import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { toast } from "sonner";
import { grammarRev } from "./grammar-api";
import { GrammarPromptEditor } from "./grammar-prompt-editor";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }, Toaster: (): null => null }));

const DEFAULT = "You check English written or spoken by a language learner.";
const state = (prompt: string | null) => ({ prompt, default_prompt: DEFAULT, max_length: 2000 });

function setup(routes: Record<string, Handler>) {
  const mock = createFetchMock(routes);
  renderWithProviders(<GrammarPromptEditor />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  return mock;
}
const body = (mock: ReturnType<typeof createFetchMock>, method: string) =>
  JSON.parse(mock.calls.find((c) => c.method === method)!.body as string);

describe("GrammarPromptEditor", () => {
  beforeEach(() => localStorage.clear());

  it("prefills the default rules and saves an edited version", async () => {
    const mock = setup({
      "GET /api/me/grammar-prompt": () => json(state(null)),
      "PUT /api/me/grammar-prompt": () => json(state(`${DEFAULT}\nAlso check articles.`)),
    });
    expect(await screen.findByTestId("grammar-prompt-input")).toHaveValue(DEFAULT);
    expect(screen.getByTestId("grammar-prompt-status")).toHaveAttribute("data-custom", "false");
    expect(screen.getByTestId("grammar-prompt-save")).toBeDisabled(); // 未修改
    expect(screen.getByTestId("grammar-prompt-reset")).toBeDisabled(); // 没有自定义
    await userEvent.type(screen.getByTestId("grammar-prompt-input"), "\nAlso check articles.");
    await userEvent.click(screen.getByTestId("grammar-prompt-save"));
    await waitFor(() => expect(screen.getByTestId("grammar-prompt-status")).toHaveAttribute("data-custom", "true"));
    expect(body(mock, "PUT")).toEqual({ prompt: `${DEFAULT}\nAlso check articles.` });
    expect(grammarRev()).toBe(1); // 本机语法缓存失效
  });

  it("restores the default after confirmation", async () => {
    const mock = setup({
      "GET /api/me/grammar-prompt": () => json(state("My rules")),
      "DELETE /api/me/grammar-prompt": () => json(state(null)),
    });
    expect(await screen.findByTestId("grammar-prompt-input")).toHaveValue("My rules");
    await userEvent.click(screen.getByTestId("grammar-prompt-reset"));
    expect(mock.calls.some((c) => c.method === "DELETE")).toBe(false); // 先确认
    await userEvent.click(await screen.findByTestId("grammar-prompt-reset-confirm"));
    await waitFor(() => expect(screen.getByTestId("grammar-prompt-input")).toHaveValue(DEFAULT));
    expect(screen.getByTestId("grammar-prompt-status")).toHaveAttribute("data-custom", "false");
    expect(grammarRev()).toBe(1);
  });

  it("saving text equal to the default restores the default instead of storing a copy", async () => {
    const mock = setup({
      "GET /api/me/grammar-prompt": () => json(state("My rules")),
      "DELETE /api/me/grammar-prompt": () => json(state(null)),
    });
    await screen.findByTestId("grammar-prompt-input");
    await userEvent.clear(screen.getByTestId("grammar-prompt-input"));
    await userEvent.type(screen.getByTestId("grammar-prompt-input"), `  ${DEFAULT} `);
    await userEvent.click(screen.getByTestId("grammar-prompt-save"));
    await waitFor(() => expect(mock.calls.some((c) => c.method === "DELETE")).toBe(true));
    expect(mock.calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("blocks text over the limit and maps the server's length error", async () => {
    const mock = setup({
      "GET /api/me/grammar-prompt": () => json({ ...state(null), max_length: 10 }),
      "PUT /api/me/grammar-prompt": () => json({ error: "prompt: String should have at most 2000 characters" }, 422),
    });
    await screen.findByTestId("grammar-prompt-input");
    await userEvent.clear(screen.getByTestId("grammar-prompt-input"));
    await userEvent.type(screen.getByTestId("grammar-prompt-input"), "12345678901");
    expect(screen.getByTestId("grammar-prompt-count")).toHaveTextContent("11 / 10");
    expect(screen.getByTestId("grammar-prompt-save")).toBeDisabled();
    await userEvent.type(screen.getByTestId("grammar-prompt-input"), "{Backspace}{Backspace}");
    await userEvent.click(screen.getByTestId("grammar-prompt-save"));
    expect(await screen.findByTestId("grammar-prompt-error")).toHaveTextContent("The rules are too long (2000 characters max).");
    expect(mock.calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  });

  it("shows a load error with retry", async () => {
    let fail = true;
    setup({ "GET /api/me/grammar-prompt": () => (fail ? json({ error: "boom" }, 500) : json(state(null))) });
    expect(await screen.findByTestId("grammar-prompt-error")).toHaveTextContent("Something went wrong.");
    fail = false;
    await userEvent.click(screen.getByTestId("grammar-prompt-retry"));
    expect(await screen.findByTestId("grammar-prompt-input")).toHaveValue(DEFAULT);
  });

  it("bumps the revision when the request resolves after unmount, without console errors", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const mock = createFetchMock({
      "GET /api/me/grammar-prompt": () => json(state("My rules")),
      "DELETE /api/me/grammar-prompt": async () => { await gate; return json(state(null)); },
    });
    const view = renderWithProviders(<GrammarPromptEditor />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await screen.findByTestId("grammar-prompt-input");
    await userEvent.click(screen.getByTestId("grammar-prompt-reset"));
    await userEvent.click(await screen.findByTestId("grammar-prompt-reset-confirm"));
    await waitFor(() => expect(mock.calls.some((c) => c.method === "DELETE")).toBe(true));
    view.unmount();
    release();
    await waitFor(() => expect(grammarRev()).toBe(1));
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("does not bump the revision when a request fails after unmount", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const mock = createFetchMock({
      "GET /api/me/grammar-prompt": () => json(state("My rules")),
      "DELETE /api/me/grammar-prompt": async () => { await gate; return json({ error: "boom" }, 500); },
    });
    const view = renderWithProviders(<GrammarPromptEditor />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
    await screen.findByTestId("grammar-prompt-input");
    await userEvent.click(screen.getByTestId("grammar-prompt-reset"));
    await userEvent.click(await screen.findByTestId("grammar-prompt-reset-confirm"));
    await waitFor(() => expect(mock.calls.some((c) => c.method === "DELETE")).toBe(true));
    view.unmount();
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(grammarRev()).toBe(0);
  });

  it("caps pasted input softly, ignores trailing whitespace, counts code points, and toasts restore distinctly", async () => {
    const mock = setup({
      "GET /api/me/grammar-prompt": () => json({ ...state("My rules"), max_length: 4 }),
      "DELETE /api/me/grammar-prompt": () => json(state(null)),
    });
    const input = await screen.findByTestId("grammar-prompt-input");
    await userEvent.click(input);
    await userEvent.paste("x".repeat(100));
    expect((input as HTMLTextAreaElement).value.length).toBe(20); // 4 * 5
    await userEvent.clear(input);
    await userEvent.type(input, "My rules  ");
    expect(screen.getByTestId("grammar-prompt-save")).toBeDisabled(); // 仅尾部空白
    await userEvent.clear(input);
    await userEvent.paste("😀😀😀😀");
    expect(screen.getByTestId("grammar-prompt-count")).toHaveTextContent("4 / 4");
    expect(mock.calls.some((c) => c.method === "PUT")).toBe(false);
    await userEvent.clear(input);
    await userEvent.paste("x".repeat(19) + "😀😀"); // the 20-unit soft cap would cut the first emoji's surrogate pair
    expect((input as HTMLTextAreaElement).value).toBe("x".repeat(19) + "😀"); // 20 code points kept whole, no lone surrogate
    expect(screen.getByTestId("grammar-prompt-count")).toHaveTextContent("20 / 4");
    await userEvent.clear(input);
    await userEvent.paste("😀".repeat(30)); // 30 code points -> capped at 20 code points, never mid-pair
    expect([...(input as HTMLTextAreaElement).value]).toHaveLength(20);
    expect((input as HTMLTextAreaElement).value).toBe("😀".repeat(20));
    await userEvent.click(screen.getByTestId("grammar-prompt-reset"));
    await userEvent.click(await screen.findByTestId("grammar-prompt-reset-confirm"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Default rules restored."));
  });
});
