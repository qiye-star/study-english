import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as session from "../../api/session";
import * as api from "./api";
import { RoleLabels } from "./role-labels";
import { S } from "./strings";

vi.mock("./api", async (orig) => ({ ...(await orig<typeof import("./api")>()), fetchRoles: vi.fn(), putRoles: vi.fn(), suggestRoles: vi.fn() }));

const ID = "3f2a9c1e-0000-4000-8000-000000000001";
const as = (role: session.Role) => session.setSession({
  username: "u", role, csrfToken: "c", expiresAt: "2099-01-01T00:00:00Z", stepUpUntil: null,
  totpEnabled: false, safeMode: false, maintenanceMode: "off",
});
const lines = (n: number): api.CatalogSegment[] => Array.from({ length: n }, (_, i) => ({
  idx: i, startMs: i * 1000, endMs: i * 1000 + 900, text: `Sentence number ${i}.`, zh: null, zhLang: null,
  hasAnalysis: false, flags: [],
}));
const EMPTY: api.RolesState = { names: [], speakers: [], editable: true, locked: null };

afterEach(() => {
  cleanup();
  session.resetSessionForTests();
});

describe("RoleLabels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.fetchRoles).mockResolvedValue(EMPTY);
  });

  it("shows a viewer the letters and names, with no way to change them", async () => {
    as("viewer");
    vi.mocked(api.fetchRoles).mockResolvedValue({
      names: [{ key: "A", name: "Host" }], speakers: [{ idx: 0, speaker: "A" }], editable: true, locked: null,
    });
    render(<RoleLabels id={ID} lines={lines(2)} onError={() => {}} />);
    expect(await screen.findByText(S.roles.readonly)).toBeInTheDocument();
    expect(screen.getByText("Host")).toBeInTheDocument();
    expect(screen.getByText("Sentence number 0.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: S.roles.save })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("cycles a sentence through none, A … F and back, then saves only what changed", async () => {
    as("operator");
    vi.mocked(api.putRoles).mockResolvedValue({ names: [{ key: "A", name: "Host" }],
      speakers: [{ idx: 0, speaker: "A" }, { idx: 1, speaker: null }], editable: true, locked: null, copies: 2 });
    render(<RoleLabels id={ID} lines={lines(2)} onError={() => {}} />);
    const save = await screen.findByRole("button", { name: S.roles.save });
    expect(save).toBeDisabled();

    const row = screen.getByText("Sentence number 0.").closest("li") as HTMLElement;
    const toggle = within(row).getByRole("button");
    expect(toggle).toHaveTextContent(S.roles.none);
    const cycle = ["A", "B", "C", "D", "E", "F", S.roles.none, "A"];
    for (const expected of cycle) {
      await userEvent.click(toggle);
      expect(toggle).toHaveTextContent(expected);
    }

    await userEvent.type(screen.getByLabelText(`${S.roles.name} A`), "Host");
    await userEvent.click(screen.getByRole("button", { name: S.roles.save }));
    await waitFor(() => expect(api.putRoles).toHaveBeenCalledWith(ID, {
      names: { A: "Host" }, speakers: [{ idx: 0, speaker: "A" }],
    }));
    expect(await screen.findByText(S.roles.saved(2))).toBeInTheDocument();
  });

  it("caps role names at 24 characters", async () => {
    as("operator");
    render(<RoleLabels id={ID} lines={lines(1)} onError={() => {}} />);
    expect(await screen.findByLabelText(`${S.roles.name} B`)).toHaveAttribute("maxlength", "24");
  });

  it("suggests in runs of at most 40 sentences and keeps the result as a draft until adopted", async () => {
    as("operator");
    vi.mocked(api.suggestRoles)
      .mockResolvedValueOnce({ speakers: [{ idx: 0, speaker: "A" }, { idx: 39, speaker: "B" }] })
      .mockResolvedValueOnce({ speakers: [{ idx: 40, speaker: "A" }] });
    render(<RoleLabels id={ID} lines={lines(41)} onError={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: S.roles.suggest }));

    await waitFor(() => expect(api.suggestRoles).toHaveBeenCalledTimes(2));
    expect(api.suggestRoles).toHaveBeenNthCalledWith(1, ID, 0, 39);
    expect(api.suggestRoles).toHaveBeenNthCalledWith(2, ID, 40, 40);
    expect(await screen.findByText(S.roles.draft(3))).toBeInTheDocument();
    expect(api.putRoles).not.toHaveBeenCalled(); // a suggestion saves nothing

    await userEvent.click(screen.getByRole("button", { name: S.roles.adopt }));
    expect(screen.queryByText(S.roles.draft(3))).toBeNull();
    const row = screen.getByText("Sentence number 40.").closest("li") as HTMLElement;
    expect(within(row).getByRole("button")).toHaveTextContent("A");
    expect(api.putRoles).not.toHaveBeenCalled(); // adopting only changes what the admin is about to save
    expect(screen.getByRole("button", { name: S.roles.save })).toBeEnabled();
  });

  it("discards a draft without touching the labels", async () => {
    as("operator");
    vi.mocked(api.suggestRoles).mockResolvedValue({ speakers: [{ idx: 0, speaker: "D" }] });
    render(<RoleLabels id={ID} lines={lines(1)} onError={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: S.roles.suggest }));
    await userEvent.click(await screen.findByRole("button", { name: S.roles.discard }));
    const row = screen.getByText("Sentence number 0.").closest("li") as HTMLElement;
    expect(within(row).getByRole("button")).toHaveTextContent(S.roles.none);
    expect(screen.getByRole("button", { name: S.roles.save })).toBeDisabled();
  });

  it("reports a refused save through onError with the mapped message", async () => {
    as("operator");
    vi.mocked(api.putRoles).mockRejectedValue(new Error("Invalid roles"));
    const onError = vi.fn();
    render(<RoleLabels id={ID} lines={lines(1)} onError={onError} />);
    const row = (await screen.findByText("Sentence number 0.")).closest("li") as HTMLElement;
    await userEvent.click(within(row).getByRole("button"));
    await userEvent.click(screen.getByRole("button", { name: S.roles.save }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(S.errors["Invalid roles"]));
  });

  it("reports a failed suggestion (daily cap) and stops asking", async () => {
    as("operator");
    vi.mocked(api.suggestRoles).mockRejectedValue(new Error("AI is busy today"));
    const onError = vi.fn();
    render(<RoleLabels id={ID} lines={lines(45)} onError={onError} />);
    await userEvent.click(await screen.findByRole("button", { name: S.roles.suggest }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(S.errors["AI is busy today"]));
    expect(api.suggestRoles).toHaveBeenCalledTimes(1);
  });

  it("never writes sentences or names to the console", async () => {
    as("operator");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<RoleLabels id={ID} lines={lines(1)} onError={() => {}} />);
    await screen.findByText("Sentence number 0.");
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });
});
