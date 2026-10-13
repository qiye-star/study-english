import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useNavigate } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "~/test/render";
import { ShadowSheetProvider, normalizeShadowInput, useShadowSheet, useShadowSheetOpen, type ShadowOpenInput } from "./shadow-context";
import { ShadowSheetHost } from "./shadow-host";

describe("normalizeShadowInput", () => {
  it("collapses whitespace in a single sentence and has no neighbours", () => {
    expect(normalizeShadowInput({ text: "  Hello \n  world ", source: "chat" })).toEqual({ items: ["Hello world"], index: 0, source: "chat" });
  });

  it("truncates to the practice limit", () => {
    const next = normalizeShadowInput({ text: "a".repeat(2500), source: "lookup" });
    expect(next?.items[0]).toHaveLength(2000);
  });

  it("keeps the whole list and the tapped index", () => {
    expect(normalizeShadowInput({ text: "B.", list: ["A.", "B.", "C."], index: 1, source: "chat" })).toEqual({
      items: ["A.", "B.", "C."], index: 1, source: "chat",
    });
  });

  it("drops blank list entries but keeps the index on the same sentence", () => {
    expect(normalizeShadowInput({ text: "C.", list: ["A.", "  ", "C."], index: 2, source: "chat" })).toEqual({
      items: ["A.", "C."], index: 1, source: "chat",
    });
  });

  it("finds the text in the list when no index is given, and falls back to the first sentence", () => {
    expect(normalizeShadowInput({ text: "B.", list: ["A.", "B."], source: "chat" })?.index).toBe(1);
    expect(normalizeShadowInput({ text: "Z.", list: ["A.", "B."], source: "chat" })?.index).toBe(0);
  });

  it("a one-item list is a single sentence; nothing to practise yields null", () => {
    expect(normalizeShadowInput({ text: "A.", list: ["A."], index: 0, source: "chat" })?.items).toEqual(["A."]);
    expect(normalizeShadowInput({ text: "   ", source: "chat" })).toBeNull();
    expect(normalizeShadowInput({ text: " ", list: [" ", ""], source: "chat" })).toBeNull();
  });
});

function Opener({ input, label = "open" }: { input: ShadowOpenInput; label?: string }) {
  const { open } = useShadowSheet();
  return <button type="button" data-testid={label} onClick={() => open(input)}>{label}</button>;
}

function Nav() {
  const go = useNavigate();
  return <button type="button" data-testid="go" onClick={() => go("/elsewhere")}>go</button>;
}

describe("useShadowSheet without a provider", () => {
  it("falls back to the practice page with the sentence as reference", async () => {
    renderWithProviders(<Opener input={{ text: "  Hello   there. ", source: "chat" }} />, { route: "/chat/c1" });
    await userEvent.click(screen.getByTestId("open"));
    expect(screen.getByTestId("location")).toHaveTextContent("/practice");
    expect(JSON.parse(screen.getByTestId("location").getAttribute("data-state")!)).toEqual({ reference: "Hello there." });
  });
});

describe("ShadowSheetProvider + ShadowSheetHost", () => {
  it("opens the sheet in place without navigating", async () => {
    renderWithProviders(
      <ShadowSheetProvider><Opener input={{ text: "Hello there.", source: "chat" }} /><ShadowSheetHost /></ShadowSheetProvider>,
      { route: "/chat/c1" },
    );
    expect(screen.queryByTestId("shadow-sheet")).toBeNull();
    await userEvent.click(screen.getByTestId("open"));
    expect(await screen.findByTestId("shadow-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("shadow-reference")).toHaveTextContent("Hello there.");
    expect(screen.getByTestId("location")).toHaveTextContent("/chat/c1");
    expect(screen.getByTestId("location").getAttribute("data-state")).toBe("null");
  });

  it("closes from the sheet's close button", async () => {
    renderWithProviders(
      <ShadowSheetProvider><Opener input={{ text: "Hello there.", source: "chat" }} /><ShadowSheetHost /></ShadowSheetProvider>,
    );
    await userEvent.click(screen.getByTestId("open"));
    await userEvent.click(await screen.findByTestId("shadow-close"));
    expect(screen.queryByTestId("shadow-sheet")).toBeNull();
  });

  it("closes when the route changes (including browser back)", async () => {
    renderWithProviders(
      <ShadowSheetProvider><Opener input={{ text: "Hello there.", source: "chat" }} /><Nav /><ShadowSheetHost /></ShadowSheetProvider>,
    );
    await userEvent.click(screen.getByTestId("open"));
    expect(await screen.findByTestId("shadow-sheet")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("go"));
    expect(screen.queryByTestId("shadow-sheet")).toBeNull();
  });

  it("a second open replaces the first request", async () => {
    renderWithProviders(
      <ShadowSheetProvider>
        <Opener input={{ text: "First one.", source: "chat" }} label="a" />
        <Opener input={{ text: "Second one.", source: "grammar" }} label="b" />
        <ShadowSheetHost />
      </ShadowSheetProvider>,
    );
    await userEvent.click(screen.getByTestId("a"));
    expect(await screen.findByTestId("shadow-reference")).toHaveTextContent("First one.");
    await userEvent.click(screen.getByTestId("b"));
    expect(screen.getByTestId("shadow-reference")).toHaveTextContent("Second one.");
  });

  it("ignores an open request with nothing to practise", async () => {
    renderWithProviders(
      <ShadowSheetProvider><Opener input={{ text: "   ", source: "chat" }} /><ShadowSheetHost /></ShadowSheetProvider>,
    );
    await userEvent.click(screen.getByTestId("open"));
    expect(screen.queryByTestId("shadow-sheet")).toBeNull();
  });
});

function OpenProbe() {
  return <span data-testid="shadow-open-probe">{String(useShadowSheetOpen())}</span>;
}

describe("useShadowSheetOpen", () => {
  it("is false without a provider and follows the sheet with one", async () => {
    const first = renderWithProviders(<OpenProbe />);
    expect(screen.getByTestId("shadow-open-probe")).toHaveTextContent("false");
    first.unmount();
    renderWithProviders(
      <ShadowSheetProvider><OpenProbe /><Opener input={{ text: "Hello there.", source: "chat" }} /><ShadowSheetHost /></ShadowSheetProvider>,
    );
    expect(screen.getByTestId("shadow-open-probe")).toHaveTextContent("false");
    await userEvent.click(screen.getByTestId("open"));
    expect(screen.getByTestId("shadow-open-probe")).toHaveTextContent("true");
    await userEvent.click(await screen.findByTestId("shadow-close"));
    expect(screen.getByTestId("shadow-open-probe")).toHaveTextContent("false");
  });

  it("accepts the manual source", () => {
    expect(normalizeShadowInput({ text: "Hi.", source: "manual" })).toEqual({ items: ["Hi."], index: 0, source: "manual" });
  });
});
