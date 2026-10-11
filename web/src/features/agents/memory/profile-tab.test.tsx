import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { json } from "~/test/fetch-mock";
import { changedValues } from "./profile-tab";
import { STATE } from "./test-fixtures";
import { setupMemory } from "./test-setup";

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("changedValues", () => {
  it("returns only the keys that changed, empty means null", () => {
    const draft = { level: "B1", goals: "雅思 7 分, 口语流利", interests: "", native: " 中文 ", correction: "", schedule: "" };
    expect(changedValues(draft, { level: "B1", goals: ["雅思 7 分"] })).toEqual({ goals: ["雅思 7 分", "口语流利"], native: "中文" });
    expect(changedValues({ ...draft, level: "", goals: "", native: "" }, { level: "B1", goals: ["雅思 7 分"] }))
      .toEqual({ level: null, goals: null });
  });
});

describe("ProfileTab", () => {
  it("edits the profile, sends only changed keys and marks edited fields", async () => {
    const user = userEvent.setup();
    const mock = setupMemory({
      "PATCH /api/agents/memory/profile": () => json({ ...STATE, profile: { ...STATE.profile, native: "中文" }, edited_keys: ["level", "native"] }),
    });
    const native = await screen.findByLabelText(/母语/);
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    expect(screen.getByText("你改过")).toBeTruthy();
    await user.type(native, "中文");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("已保存")).toBeTruthy();
    const patch = mock.calls.find((c) => c.method === "PATCH")!;
    expect(JSON.parse(String(patch.body))).toEqual({ values: { native: "中文" }, dismiss: [] });
    expect(screen.getAllByText("你改过")).toHaveLength(2);
  });

  it("accepts or dismisses an agent proposal", async () => {
    const user = userEvent.setup();
    const mock = setupMemory({ "PATCH /api/agents/memory/profile": () => json({ ...STATE, proposals: {} }) });
    const card = await screen.findByTestId("proposal-level");
    expect(card).toHaveTextContent("智能体建议把「水平」改成 B2");
    await user.click(within(card).getByRole("button", { name: "忽略" }));
    await waitFor(() => expect(screen.queryByTestId("proposal-level")).toBeNull());
    expect(JSON.parse(String(mock.calls.find((c) => c.method === "PATCH")!.body))).toEqual({ values: {}, dismiss: ["level"] });
  });

  it("accepting a proposal sends it as an edit", async () => {
    const user = userEvent.setup();
    const mock = setupMemory({ "PATCH /api/agents/memory/profile": () => json({ ...STATE, proposals: {} }) });
    await user.click(within(await screen.findByTestId("proposal-level")).getByRole("button", { name: "采纳" }));
    await waitFor(() => expect(screen.queryByTestId("proposal-level")).toBeNull());
    expect(JSON.parse(String(mock.calls.find((c) => c.method === "PATCH")!.body))).toEqual({ values: { level: "B2" }, dismiss: [] });
  });

  it("shows a translated error when the server rejects a value", async () => {
    const user = userEvent.setup();
    setupMemory({ "PATCH /api/agents/memory/profile": () => json({ error: "Invalid profile value" }, 422) });
    await user.type(await screen.findByLabelText(/可学习时间/), "每天晚上");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("有一项填写不符合要求,请检查后再保存。")).toBeTruthy();
  });
});
