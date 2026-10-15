import { afterEach, describe, expect, it } from "vitest";
import { lookupContext, lookupContextIf, lookupPressContext, ownLongPress } from "./lookup-context";

const $ = (sel: string) => document.querySelector(sel)!;
afterEach(() => { document.body.innerHTML = ""; });

describe("lookup marks (plan 2026-10-15 R-M1)", () => {
  it("spreads the attributes the selection reader and the recogniser look for", () => {
    expect(lookupContext).toEqual({ "data-lookup-context": "" });
    expect(lookupContextIf(true)).toEqual({ "data-lookup-context": "" });
    expect(lookupContextIf(false)).toEqual({});
    expect(ownLongPress).toEqual({ "data-lookup-press": "own" });
  });
});

describe("lookupPressContext (R-L2, R-L6)", () => {
  it("returns the nearest context for an element or a text node inside it", () => {
    document.body.innerHTML = `<div><p data-lookup-context id="c">say <b id="w">hello</b></p></div>`;
    expect(lookupPressContext($("#w"))).toBe($("#c"));
    expect(lookupPressContext($("#w").firstChild)).toBe($("#c"));
  });
  it("ignores text outside any context and a null target", () => {
    document.body.innerHTML = `<p id="p">plain</p>`;
    expect(lookupPressContext($("#p"))).toBeNull();
    expect(lookupPressContext(null)).toBeNull();
  });
  it("ignores links, buttons, inputs and role=button inside a context", () => {
    document.body.innerHTML = `<div data-lookup-context><a id="a" href="#">link</a><button id="b">go</button><span role="button" id="r">x</span><input id="i"></div>`;
    for (const id of ["#a", "#b", "#r", "#i"]) expect(lookupPressContext($(id))).toBeNull();
  });
  it("accepts a context inside a clickable row (its click is swallowed later, R-L5)", () => {
    document.body.innerHTML = `<div role="button" id="row"><p data-lookup-context id="c">word</p></div>`;
    expect(lookupPressContext($("#c"))).toBe($("#c"));
  });
  it("leaves an element that owns its long-press alone", () => {
    document.body.innerHTML = `<div data-lookup-press="own"><span data-lookup-context id="w">talk</span></div>`;
    expect(lookupPressContext($("#w"))).toBeNull();
  });
});
