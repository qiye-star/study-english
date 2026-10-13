import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { createFetchMock, json } from "~/test/fetch-mock";
import { TestProviders } from "~/test/render";
import { SaveSentenceChip, useSaveSentence } from "./save-sentence";

const SAVED = { id: "p1", text: "Hello world.", source: "library", created_at: "2026-10-13T00:00:00Z" };

function Harness({ text }: { text: string }) {
  const save = useSaveSentence(text);
  return <SaveSentenceChip save={save} />;
}

function setup(handler: () => Response) {
  const mock = createFetchMock({ "POST /api/practice-items": handler });
  const api = new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch });
  const view = render(<TestProviders api={api}><Harness text="Hello world." /></TestProviders>);
  const rerender = (text: string) => view.rerender(<TestProviders api={api}><Harness text={text} /></TestProviders>);
  return { mock, rerender };
}

describe("add to practice list (spec §11.4, plan W2 R-SH18)", () => {
  it("saves the sentence with source=library and shows the saved state", async () => {
    const { mock } = setup(() => json(SAVED));
    expect(screen.getByTestId("shadow-save")).toHaveAccessibleName("Add to practice list");
    await userEvent.click(screen.getByTestId("shadow-save"));
    await waitFor(() => expect(screen.getByTestId("shadow-save")).toHaveAttribute("data-state", "saved"));
    expect(screen.getByTestId("shadow-save")).toHaveAccessibleName("Added to practice list");
    expect(JSON.parse(mock.calls[0].body as string)).toEqual({ text: "Hello world.", source: "library" });
    expect(mock.calls[0].url.search).toBe("");
  });

  it("saves again on a second tap (no client-side dedupe)", async () => {
    const { mock } = setup(() => json(SAVED));
    await userEvent.click(screen.getByTestId("shadow-save"));
    await waitFor(() => expect(screen.getByTestId("shadow-save")).toHaveAttribute("data-state", "saved"));
    await userEvent.click(screen.getByTestId("shadow-save"));
    await waitFor(() => expect(mock.calls).toHaveLength(2));
  });

  it("stays unsaved when the server refuses", async () => {
    const { mock } = setup(() => json({ error: "Practice item limit reached" }, 409));
    await userEvent.click(screen.getByTestId("shadow-save"));
    await waitFor(() => expect(mock.calls).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId("shadow-save")).not.toBeDisabled());
    expect(screen.getByTestId("shadow-save")).toHaveAttribute("data-state", "idle");
  });

  it("resets when the sentence changes", async () => {
    const { rerender } = setup(() => json(SAVED));
    await userEvent.click(screen.getByTestId("shadow-save"));
    await waitFor(() => expect(screen.getByTestId("shadow-save")).toHaveAttribute("data-state", "saved"));
    rerender("Another one.");
    expect(screen.getByTestId("shadow-save")).toHaveAttribute("data-state", "idle");
  });
});
