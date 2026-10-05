import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { SentencePracticeSheet } from "./sentence-practice-sheet";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }, Toaster: (): null => null }));

function StateProbe() {
  return <pre data-testid="state">{JSON.stringify(useLocation().state)}</pre>;
}

function setup(routes: Parameters<typeof createFetchMock>[0] = {}, text = "**Great** idea! Mr. Lee agrees.\n- Shall we go?") {
  const mock = createFetchMock(routes);
  const onClose = vi.fn();
  const view = renderWithProviders(<><SentencePracticeSheet text={text} onClose={onClose} /><StateProbe /></>, {
    api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat/c1",
  });
  return { mock, onClose, view };
}

describe("SentencePracticeSheet", () => {
  it("lists the sentences of a reply", () => {
    setup();
    expect(screen.getAllByTestId("practice-sentence").map((el) => el.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Great idea!"), expect.stringContaining("Mr. Lee agrees."), expect.stringContaining("Shall we go?")]),
    );
    expect(screen.getAllByTestId("practice-sentence")).toHaveLength(3);
  });

  it("opens the practice page with the sentence as reference", async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getAllByTestId("practice-sentence-go")[1]);
    expect(screen.getByTestId("location")).toHaveTextContent("/practice");
    expect(JSON.parse(screen.getByTestId("state").textContent!)).toEqual({ reference: "Mr. Lee agrees." });
    expect(onClose).toHaveBeenCalled();
  });

  it("saves a sentence to the practice list", async () => {
    const { mock } = setup({ "POST /api/practice-items": () => json({ id: "p1", text: "Great idea!", source: "chat", created_at: "t" }) });
    await userEvent.click(screen.getAllByTestId("practice-sentence-save")[0]);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Saved to your practice list."));
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ text: "Great idea!", source: "chat" });
  });

  it("guards double taps and disables the row while saving", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const { mock } = setup({ "POST /api/practice-items": async () => { await gate; return json({ id: "p1", text: "x", source: "chat", created_at: "t" }); } });
    const btn = screen.getAllByTestId("practice-sentence-save")[0];
    await userEvent.click(btn);
    await userEvent.click(btn);
    expect(btn).toBeDisabled();
    expect(screen.getAllByTestId("practice-sentence-save")[1]).not.toBeDisabled();
    release();
    await waitFor(() => expect(btn).not.toBeDisabled());
    expect(mock.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("shows a disabled row with a hint for sentences over the server limit", () => {
    setup({}, `${"a".repeat(2100)}. Short one.`);
    const rows = screen.getAllByTestId("practice-sentence");
    expect(rows).toHaveLength(2);
    expect(screen.getAllByTestId("practice-sentence-go")[0]).toBeDisabled();
    expect(screen.getAllByTestId("practice-sentence-save")[0]).toBeDisabled();
    expect(screen.getAllByTestId("practice-sentence-go")[1]).not.toBeDisabled();
    expect(screen.getByText("Too long to practice as one sentence.")).toBeInTheDocument();
  });

  it("shows an empty hint when there is nothing to practice", () => {
    setup({}, "```\ncode\n```");
    expect(screen.queryAllByTestId("practice-sentence")).toHaveLength(0);
    expect(screen.getByText("No sentences to practice.")).toBeInTheDocument();
  });

  it("keeps the sentences visible (no empty hint) while the sheet animates closed", () => {
    // jsdom has no animations: pretend the content is animating so Radix keeps it mounted after close
    const spy = vi.spyOn(globalThis, "getComputedStyle").mockImplementation(
      (el: Element) => ({ get animationName() { return el.getAttribute("data-state") === "closed" ? "slide-out" : "slide-in"; }, display: "block" }) as unknown as CSSStyleDeclaration,
    );
    try {
      const mock = createFetchMock({});
      const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
      function Host() {
        const [text, setText] = useState<string | null>("Great idea! Shall we go?");
        return <><button data-testid="close" onClick={() => setText(null)}>c</button><SentencePracticeSheet text={text} onClose={vi.fn()} /></>;
      }
      renderWithProviders(<Host />, { api, route: "/chat/c1" });
      expect(screen.getAllByTestId("practice-sentence")).toHaveLength(2);
      act(() => screen.getByTestId("close").click());
      expect(screen.getByTestId("practice-sheet")).toHaveAttribute("data-state", "closed");
      expect(screen.getAllByTestId("practice-sentence")).toHaveLength(2);
      expect(screen.queryByText("No sentences to practice.")).not.toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });

  it("does not set state or toast after unmount", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { view } = setup({ "POST /api/practice-items": async () => { await gate; return json({ id: "p1", text: "x", source: "chat", created_at: "t" }); } });
    await userEvent.click(screen.getAllByTestId("practice-sentence-save")[0]);
    view.unmount();
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
