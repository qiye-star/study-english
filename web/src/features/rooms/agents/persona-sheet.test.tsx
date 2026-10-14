import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { EMMA, LEO } from "./fixtures";
import { PersonaSheet } from "./persona-sheet";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: (): null => null }));

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
afterEach(async () => { vi.clearAllMocks(); localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

it("shows the public prompt, inserts an @mention and reports", async () => {
  const mock = createFetchMock({ "POST /api/rooms/r1/agents/builtin%3Acoach/report": () => json({ ok: true }) });
  const onAsk = vi.fn();
  renderWithProviders(<PersonaSheet open onOpenChange={() => {}} roomId="r1" agent={EMMA} canAsk onAsk={onAsk} />,
    { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  expect(await screen.findByTestId("persona-prompt")).toHaveTextContent("You are a patient coach.");
  expect(screen.getByText("内置")).toBeInTheDocument();
  expect(screen.getByText("友好")).toBeInTheDocument();
  expect(screen.getByText("B1 · 中级")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "@Emma 提问" }));
  expect(onAsk).toHaveBeenCalledWith("Emma");
  fireEvent.click(screen.getByRole("button", { name: "举报这个角色" }));
  fireEvent.click(screen.getByRole("button", { name: "不当内容" }));
  await waitFor(() => expect(JSON.parse(String(mock.calls.at(-1)!.body))).toEqual({ reason: "abuse" }));
  expect(await screen.findByRole("status")).toHaveTextContent("已举报,管理员会处理");
});

it("keeps a private prompt private and hides asking for a disabled persona", async () => {
  renderWithProviders(<PersonaSheet open onOpenChange={() => {}} roomId="r1" agent={{ ...LEO, disabled: true }} canAsk onAsk={vi.fn()} />);
  expect(await screen.findByText("创建者没有公开人设原文")).toBeInTheDocument();
  expect(screen.queryByTestId("persona-prompt")).toBeNull();
  expect(screen.getByText("已停用")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "@Leo 提问" })).toBeNull();
});

it("renders a prompt that looks like markup as plain text", async () => {
  const evil = { ...EMMA, prompt: "<img src=x onerror=alert(1)> **bold**" };
  renderWithProviders(<PersonaSheet open onOpenChange={() => {}} roomId="r1" agent={evil} canAsk={false} onAsk={vi.fn()} />);
  const box = await screen.findByTestId("persona-prompt");
  expect(box).toHaveTextContent("<img src=x onerror=alert(1)> **bold**");
  expect(box.querySelector("img")).toBeNull();
});
