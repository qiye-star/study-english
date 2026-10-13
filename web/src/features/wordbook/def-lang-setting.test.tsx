import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiClient } from "~/api/client";
import i18n from "~/i18n";
import { createFetchMock, json, type Handler } from "~/test/fetch-mock";
import { renderWithProviders } from "~/test/render";
import { DefLangSetting } from "./def-lang-setting";
import { CONFIG } from "./test-fixtures";
import en from "./locales/en.json";

function setup(config: unknown = CONFIG, extra: Record<string, Handler> = {}) {
  const mock = createFetchMock({ "GET /api/wordbook/config": () => json(config), ...extra });
  renderWithProviders(<DefLangSetting />, { api: new ApiClient({ getToken: () => "t", fetchImpl: mock.fetch }) });
  return mock;
}
const group = () => screen.getByRole("radiogroup", { name: "释义显示" });
const PATCH = "PATCH /api/wordbook/enrollment"; // AD-1

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("DefLangSetting", () => {
  it("offers 中英 / 仅中文 / 仅英文 with 仅英文 selected on an old server", async () => {
    setup();
    const radios = within(group()).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["中英", "仅中文", "仅英文"]);
    expect(screen.getByRole("radio", { name: "仅英文" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/小测的题面和选项仍用中文/)).toBeTruthy();
    for (const r of radios) expect(r.className).toContain("hit-expand"); // visual 32px, hit area 44px
  });

  it("selects the server value once the config arrives", async () => {
    setup({ ...CONFIG, def_lang: "zh" });
    await waitFor(() => expect(screen.getByRole("radio", { name: "仅中文" })).toHaveAttribute("aria-checked", "true"));
  });

  it("applies a choice before the server answers, then announces it", async () => {
    let release!: () => void;
    const mock = setup(CONFIG, {
      [PATCH]: () => new Promise<Response>((resolve) => { release = () => resolve(json({ def_lang: "both" })); }),
    });
    await userEvent.click(screen.getByRole("radio", { name: "中英" })); // English only is the default now, so pick another
    expect(screen.getByRole("radio", { name: "中英" })).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(mock.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(JSON.parse(String(mock.calls.find((c) => c.method === "PATCH")!.body))).toEqual({ def_lang: "both" });
    release();
    await waitFor(() => expect(screen.getByText("已保存")).toBeTruthy());
  });

  it("goes back and says why when saving fails", async () => {
    setup({ ...CONFIG, def_lang: "zh" }, { [PATCH]: () => json({ error: "nope" }, 500) });
    await waitFor(() => expect(screen.getByRole("radio", { name: "仅中文" })).toHaveAttribute("aria-checked", "true"));
    await userEvent.click(screen.getByRole("radio", { name: "仅英文" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "仅中文" })).toHaveAttribute("aria-checked", "true");
  });

  it("is reachable by keyboard like the other segmented controls", async () => {
    setup(CONFIG, { [PATCH]: () => json({ def_lang: "zh" }) }); // without a route the 404 would roll the choice back
    screen.getByRole("radio", { name: "仅英文" }).focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "仅中文" })).toHaveAttribute("aria-checked", "true");
  });

  it("structure for 360 px: three equal cells that never wrap, no fixed pixel widths (jsdom has no layout; real width unverified)", () => {
    setup();
    for (const r of within(group()).getAllByRole("radio")) {
      expect(r.className).toContain("flex-1");
      expect(r.className).toContain("min-w-0");
      expect(r.className).toContain("whitespace-nowrap");
      expect(r.className).not.toMatch(/\bw-\[\d+px\]/);
    }
    expect(group().className).toContain("w-full");
    const labels = Object.values(en.web.wordbookDefs.setting.options);
    for (const l of labels) expect(l.length).toBeLessThanOrEqual(12);
  });
});
