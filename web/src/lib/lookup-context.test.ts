import { afterEach, describe, expect, it } from "vitest";
import { lookupContext, lookupContextIf, lookupTapContext, lookupTapOff } from "./lookup-context";

const $ = (sel: string) => document.querySelector(sel)!;
afterEach(() => { document.body.innerHTML = ""; });

describe("lookup marks (plan 2026-10-15 R-M1)", () => {
  it("spreads the attributes the selection reader and the tap hook look for", () => {
    expect(lookupContext).toEqual({ "data-lookup-context": "" });
    expect(lookupContextIf(true)).toEqual({ "data-lookup-context": "" });
    expect(lookupContextIf(false)).toEqual({});
    expect(lookupTapOff).toEqual({ "data-lookup-tap": "off" });
  });
});

describe("lookupTapContext (tap-to-lookup eligibility)", () => {
  it("returns the nearest context for an element or a text node inside it", () => {
    document.body.innerHTML = `<div><p data-lookup-context id="c">say <b id="w">hello</b></p></div>`;
    expect(lookupTapContext($("#w"))).toBe($("#c"));
    expect(lookupTapContext($("#w").firstChild)).toBe($("#c"));
  });
  it("ignores text outside any context and a null target", () => {
    document.body.innerHTML = `<p id="p">plain</p>`;
    expect(lookupTapContext($("#p"))).toBeNull();
    expect(lookupTapContext(null)).toBeNull();
  });
  it("ignores links, buttons, inputs, labels and ARIA widgets, inside or around the context", () => {
    document.body.innerHTML = `<div data-lookup-context><a id="a" href="#">link</a><button id="b">go</button><span role="button" id="r">x</span><input id="i"><label id="l">l</label><span role="tab" id="t">t</span><span role="menuitem" id="m">m</span><span role="switch" id="s">s</span><span role="checkbox" id="k">k</span><span contenteditable="true" id="e">e</span><summary id="u">u</summary><select id="o"></select><textarea id="x"></textarea></div>`;
    for (const id of ["#a", "#b", "#r", "#i", "#l", "#t", "#m", "#s", "#k", "#e", "#u", "#o", "#x"]) expect(lookupTapContext($(id))).toBeNull();
    document.body.innerHTML = `<button><span data-lookup-context id="c">word</span></button><div role="button"><span data-lookup-context id="d">word</span></div>`;
    expect(lookupTapContext($("#c"))).toBeNull();
    expect(lookupTapContext($("#d"))).toBeNull();
  });
  it("accepts a plain non-editable contenteditable=false subtree", () => {
    document.body.innerHTML = `<div contenteditable="false"><span data-lookup-context id="c">word</span></div>`;
    expect(lookupTapContext($("#c"))).toBe($("#c"));
  });
  it("honours the data-lookup-tap=off opt-out on the context or any ancestor", () => {
    document.body.innerHTML = `<div data-lookup-tap="off"><span data-lookup-context id="w">talk</span></div><span data-lookup-context data-lookup-tap="off" id="s">talk</span>`;
    expect(lookupTapContext($("#w"))).toBeNull();
    expect(lookupTapContext($("#s"))).toBeNull();
  });
});
