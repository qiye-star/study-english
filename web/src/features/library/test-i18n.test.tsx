import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "~/i18n";
import { renderWithProviders } from "~/test/render";
import { resetUiLanguage, setUiLanguage } from "./test-i18n";

function Probe() {
  return <p data-testid="lang">{i18n.language}</p>;
}

afterEach(async () => {
  await resetUiLanguage();
});

describe("test-i18n (R-L36)", () => {
  it("keeps the language across SettingsProvider's initialiser", async () => {
    await setUiLanguage("zh-CN");
    renderWithProviders(<Probe />);
    expect(screen.getByTestId("lang")).toHaveTextContent("zh-CN");
  });

  it("is needed: a bare changeLanguage is put back by the provider (jsdom's navigator.language is en-US)", async () => {
    localStorage.clear();
    await i18n.changeLanguage("zh-CN");
    renderWithProviders(<Probe />);
    // 若这条失败,说明 SettingsProvider 不再重设语言:R-L36 可以放宽,但 setUiLanguage 仍是正确写法
    expect(i18n.language).toBe("en");
  });
});
