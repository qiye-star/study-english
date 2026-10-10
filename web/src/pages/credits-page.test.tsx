import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { CreditsPage, KYLEBING_LICENSE } from "./credits-page";

const here = path.dirname(fileURLToPath(import.meta.url));
const LICENSE = path.resolve(here, "../../../server/dictionaries/kylebing-english-vocabulary/LICENSE");

beforeEach(() => { localStorage.setItem("enjoy-web.settings", JSON.stringify({ language: "zh-CN" })); void i18n.changeLanguage("zh-CN"); });
afterEach(() => { localStorage.removeItem("enjoy-web.settings"); void i18n.changeLanguage("en"); });

describe("CreditsPage", () => {
  it("shows the dictionary source, commit and full BSD-3 text", () => {
    renderWithProviders(<CreditsPage />);
    expect(screen.getByRole("heading", { name: "致谢与许可" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /KyleBing\/english-vocabulary/ })).toHaveAttribute(
      "href", "https://github.com/KyleBing/english-vocabulary");
    expect(screen.getByText(/c4c6c808/)).toBeTruthy();
    expect(screen.getByTestId("license-text").textContent).toContain("Redistribution and use in source and binary forms");
    expect(screen.getByTestId("license-text").textContent).toContain("Copyright (c) 2022-2026, KyleBing");
  });

  it("embeds the license verbatim (same text as the shipped LICENSE file)", () => {
    expect(KYLEBING_LICENSE).toBe(readFileSync(LICENSE, "utf8").replace(/\r\n/g, "\n").trimEnd());
  });
});
