import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import { useShadowSheet } from "~/features/practice";
import { createFetchMock } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { AppShell } from "./app-shell";

function Page() {
  const { open } = useShadowSheet();
  return <button type="button" data-testid="open-shadow" onClick={() => open({ text: "Hello there.", source: "chat" })}>open</button>;
}

describe("AppShell shadow sheet", () => {
  it("provides the shadow sheet to every page under the shell", async () => {
    const mock = createFetchMock({});
    renderWithProviders(
      <Routes><Route element={<AppShell />}><Route path="*" element={<Page />} /></Route></Routes>,
      { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }), route: "/chat/c1" },
    );
    await userEvent.click(screen.getByTestId("open-shadow"));
    expect(await screen.findByTestId("shadow-sheet", undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByTestId("shadow-reference")).toHaveTextContent("Hello there.");
    expect(screen.getByTestId("location")).toHaveTextContent("/chat/c1");
  }, 15000);
});
