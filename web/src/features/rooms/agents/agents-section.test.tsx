import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { RoomAgentsSection } from "./agents-section";
import { AGENTS_WIRE, ROOM_INFO, ROOM_WIRE } from "./fixtures";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: (): null => null }));
vi.mock("~/features/agents", () => ({
  PersonaPicker: ({ open, onSelect }: { open: boolean; onSelect(p: { id: string; name: string }): void }) =>
    open ? <button type="button" onClick={() => onSelect({ id: "builtin:interviewer", name: "Max" })}>pick Max</button> : null,
}));

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); });
afterEach(async () => { vi.clearAllMocks(); localStorage.removeItem("enjoy-web.settings"); await i18n.changeLanguage("en"); });

function setup(props: Partial<Parameters<typeof RoomAgentsSection>[0]> = {}) {
  const mock = createFetchMock({
    "GET /api/rooms/r1/agents": () => json(AGENTS_WIRE),
    "PATCH /api/rooms/r1": (call) => json({ room: { ...ROOM_WIRE, agent_ids: JSON.parse(String(call.body)).agents } }),
  });
  const onChanged = vi.fn();
  renderWithProviders(<RoomAgentsSection room={ROOM_INFO} owner live onChanged={onChanged} {...props} />,
    { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  return { mock, onChanged };
}
const patches = (mock: ReturnType<typeof createFetchMock>) =>
  mock.calls.filter((c) => c.url.pathname === "/api/rooms/r1" && c.method === "PATCH").map((c) => JSON.parse(String(c.body)));

it("the owner adds a second persona and removes one", async () => {
  const { mock, onChanged } = setup();
  expect(await screen.findByText("Emma")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("room-agent-add-1"));
  fireEvent.click(screen.getByRole("button", { name: "pick Max" }));
  await waitFor(() => expect(patches(mock)).toEqual([{ agents: ["builtin:coach", "builtin:interviewer"] }]));
  expect(onChanged).toHaveBeenLastCalledWith(expect.objectContaining({ agentIds: ["builtin:coach", "builtin:interviewer"] }));
  fireEvent.click(screen.getByTestId("room-agent-remove-0"));
  await waitFor(() => expect(patches(mock).at(-1)).toEqual({ agents: [] }));
});

it("members only read the list and open the persona sheet", async () => {
  setup({ owner: false, room: { ...ROOM_INFO, aiPublic: false } });
  fireEvent.click(await screen.findByText("Emma"));
  expect(await screen.findByTestId("persona-prompt")).toHaveTextContent("You are a patient coach.");
  expect(screen.queryByTestId("room-agent-add-1")).toBeNull();
  expect(screen.queryByTestId("room-agent-remove-0")).toBeNull();
  expect(screen.getByText(/「群内 @AI」关闭时智能体也不会回答/)).toBeInTheDocument();
});

it("members of a room without agents see nothing", () => {
  setup({ owner: false, room: { ...ROOM_INFO, agentIds: [] } });
  expect(screen.queryByTestId("room-agents-section")).toBeNull();
});
