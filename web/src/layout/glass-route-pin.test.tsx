import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { GLASS_ATTR } from "~/lib/glass-flag";
import { GlassRoutePin } from "./glass-route-pin";

let go: (path: string) => void = () => {};
function Nav(): null {
  const navigate = useNavigate();
  go = navigate;
  return null;
}
const attr = () => document.documentElement.getAttribute(GLASS_ATTR);

describe("GlassRoutePin (plan 2026-10-15-liquid-glass R-L0-2)", () => {
  afterEach(() => document.documentElement.removeAttribute(GLASS_ATTR));

  it("pins locked routes and unpins on leave and on unmount", () => {
    document.documentElement.setAttribute(GLASS_ATTR, "v2");
    const ui = render(
      <MemoryRouter initialEntries={["/library"]}>
        <Nav />
        <Routes><Route path="*" element={<GlassRoutePin />} /></Routes>
      </MemoryRouter>,
    );
    expect(attr()).toBe("pin");
    act(() => go("/practice"));
    expect(attr()).toBe("v2");
    act(() => go("/practice/changelog"));
    expect(attr()).toBe("pin");
    ui.unmount();
    expect(attr()).toBe("v2");
  });

  it("does nothing while the switch is off", () => {
    render(<MemoryRouter initialEntries={["/library"]}><GlassRoutePin /></MemoryRouter>);
    expect(document.documentElement.hasAttribute(GLASS_ATTR)).toBe(false);
  });
});
