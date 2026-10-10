import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALL_OFF, LINK_KEYS, MAX_WORD_TARGET, POINT_NAMES, contribute, createExtensionRegistry, flagsFromConfig, setLinkFlags,
  visible, type LinkFlags,
} from "./extension-points";
import { LinkRoute, Slot, WordActions } from "./extension-points-react";
import { AddVocabularyButton } from "~/features/vocabulary";
import { TestProviders } from "~/test/render";

const on = (...keys: string[]): LinkFlags => ({
  enabled: true, links: Object.fromEntries(LINK_KEYS.map((k) => [k, keys.includes(k)])) as LinkFlags["links"],
});

afterEach(() => setLinkFlags(ALL_OFF));

describe("extension registry", () => {
  it("filters by link flag, master switch and sorts by order then id", () => {
    const r = createExtensionRegistry();
    const C = (): null => null;
    r.contribute({ point: "practiceHome", id: "b", order: 1, component: C });
    r.contribute({ point: "practiceHome", id: "a", order: 1, component: C });
    r.contribute({ point: "practiceHome", id: "core", order: 9, component: C });
    r.contribute({ point: "practiceHome", id: "linked", order: 0, link: "daily_tasks", component: C });
    r.contribute({ point: "practiceHome", id: "needs", order: 5, requiresLinks: true, component: C });
    expect(r.contributionsFor("practiceHome", ALL_OFF).map((c) => c.id)).toEqual(["a", "b", "core"]);
    expect(r.contributionsFor("practiceHome", on()).map((c) => c.id)).toEqual(["a", "b", "needs", "core"]);
    expect(r.contributionsFor("practiceHome", on("daily_tasks")).map((c) => c.id)).toEqual(["linked", "a", "b", "needs", "core"]);
    expect(r.contributionsFor("practiceHome", { ...on("daily_tasks"), enabled: false }).map((c) => c.id)).toEqual(["a", "b", "core"]);
  });

  it("rejects duplicate ids and duplicate routes", () => {
    const r = createExtensionRegistry();
    const C = (): null => null;
    r.contribute({ point: "meRows", id: "x", component: C });
    expect(() => r.contribute({ point: "meRows", id: "x", component: C })).toThrow(/duplicate/);
    r.contributeRoute({ id: "r", path: "/me/links", requiresLinks: true, component: C });
    expect(() => r.contributeRoute({ id: "r2", path: "/me/links", component: C })).toThrow(/duplicate/);
    expect(r.routesFor(ALL_OFF)).toEqual([]);
    expect(r.routesFor(on()).map((x) => x.path)).toEqual(["/me/links"]);
    expect(r.allRoutes().map((x) => x.id)).toEqual(["r"]);
  });

  it("notifies flag subscribers only on change", () => {
    const r = createExtensionRegistry();
    const fn = vi.fn();
    const off = r.subscribeLinkFlags(fn);
    r.setLinkFlags(r.getLinkFlags());
    expect(fn).not.toHaveBeenCalled();
    r.setLinkFlags(on("mistakes"));
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    r.setLinkFlags(ALL_OFF);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("builds flags from the server config and ignores unknown keys", () => {
    const flags = flagsFromConfig({ enabled: true, links: [
      { key: "mistakes", effective: true }, { key: "chat_words", effective: false }, { key: "future_link", effective: true }] });
    expect(flags.enabled).toBe(true);
    expect(flags.links.mistakes).toBe(true);
    expect(flags.links.chat_words).toBe(false);
    expect(Object.keys(flags.links).sort()).toEqual([...LINK_KEYS].sort());
    expect(visible({ id: "x", link: "mistakes" }, flags)).toBe(true);
  });

  it("knows every point and keeps the vocabulary limits", async () => {
    expect(POINT_NAMES).toEqual(["wordActions", "wordActionsMenu", "dailyTasks", "practiceHome", "learningSources",
      "wordDetailSections", "notebookViews", "meRows", "appEffects"]);
    const { MAX_VOCAB_WORD, MAX_VOCAB_MEANING, MAX_VOCAB_EXAMPLE } = await import("~/features/vocabulary/vocabulary-api");
    expect(MAX_WORD_TARGET).toEqual({ word: MAX_VOCAB_WORD, meaning: MAX_VOCAB_MEANING, example: MAX_VOCAB_EXAMPLE });
  });
});

describe("<Slot>", () => {
  it("renders visible contributions with props, re-renders on flag change and isolates failures", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    contribute({ point: "learningSources", id: "test.core", component: ({ pick }) => <button onClick={() => pick("hi")}>core</button> });
    contribute({ point: "learningSources", id: "test.boom", link: "pron_shadow", component: () => { throw new Error("x"); } });
    contribute({ point: "learningSources", id: "test.linked", link: "pron_shadow", order: 1, component: () => <span>linked</span> });
    const pick = vi.fn();
    const { rerender } = render(<Slot point="learningSources" props={{ pick }} />);
    expect(screen.getByText("core")).toBeInTheDocument();
    expect(screen.queryByText("linked")).toBeNull();
    act(() => setLinkFlags(on("pron_shadow")));
    rerender(<Slot point="learningSources" props={{ pick }} />);
    expect(screen.getByText("linked")).toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith("[slot] learningSources/test.boom failed");
    screen.getByText("core").click();
    expect(pick).toHaveBeenCalledWith("hi");
    warn.mockRestore();
    error.mockRestore();
  });

  it("<WordActions> adds no wrapper elements and the core contribution equals AddVocabularyButton", () => {
    // test/setup.ts registers the core contribution (vocabulary.add, order 0) like plugins/core does in the app
    contribute({ point: "wordActions", id: "test.only", order: 1, component: ({ testId }) => <i data-testid={testId} /> });
    const target = { word: "talk", source: "manual" } as const;
    const slot = render(<TestProviders><WordActions target={target} testId="w" label="Add talk" variant="labeled" /></TestProviders>);
    const direct = render(
      <TestProviders><AddVocabularyButton testId="w" input={target} label="Add talk" withLabel /><i data-testid="w" /></TestProviders>,
    );
    expect(slot.container.innerHTML).toBe(direct.container.innerHTML);
    expect(slot.container.lastElementChild?.outerHTML).toBe('<i data-testid="w"></i>');
  });
});

describe("<LinkRoute>", () => {
  const route = { id: "t.page", path: "/t", requiresLinks: true, component: () => <p>page</p> };
  const view = () => render(
    <MemoryRouter initialEntries={["/t"]}>
      <Routes>
        <Route path="/t" element={<LinkRoute route={route} />} />
        <Route path="/practice" element={<p>practice</p>} />
      </Routes>
    </MemoryRouter>,
  );

  it("waits while the flags are not loaded, then renders the page", () => {
    view();
    expect(screen.queryByText("page")).toBeNull();
    expect(screen.queryByText("practice")).toBeNull();
    act(() => setLinkFlags(on()));
    expect(screen.getByText("page")).toBeInTheDocument();
  });

  it("goes back to practice once loaded flags say no", () => {
    view();
    act(() => setLinkFlags({ ...on(), enabled: false }));
    expect(screen.getByText("practice")).toBeInTheDocument();
  });
});
