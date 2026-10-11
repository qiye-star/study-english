/**
 * test/setup.ts loads the core contribution (plugins/core → vocabulary's button, lucide icons, enjoy's Button)
 * only for test files that can render slots. A pure-logic test file must not pay that cold compile in a hook:
 * under a full parallel run it used to exceed the 10 s hook timeout (Z1).
 */
import { expect, it } from "vitest";
import { ALL_OFF, contributionsFor, slotRendererLoaded } from "~/lib/extension-points";

it("a file that renders no slot does not load the core contribution", () => {
  expect(slotRendererLoaded()).toBe(false);
  expect(contributionsFor("wordActions", ALL_OFF)).toEqual([]);
});
