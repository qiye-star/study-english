import { GLASS_ATTR } from "~/lib/glass-flag";

/** Classes that put a backdrop-filter on an element (INDEX R-LG6). */
export const BLUR_CLASSES = ["glass", "glass-bar", "glass-float", "glass-pop", "glass-sheet", "mat-chrome", "mat-chrome-bar", "mat-sheet"] as const;

/** Tests render pages without the shell: the floating tab bar adds 1, so a page may show at most 2 (+ 1 transient). */
export const PAGE_RESIDENT_MAX = 2;

export function setLiquid(on: boolean, doc: Document = document): void {
  if (on) doc.documentElement.setAttribute(GLASS_ATTR, "v2");
  else doc.documentElement.removeAttribute(GLASS_ATTR);
}

export function blurLayers(root: ParentNode = document): Element[] {
  return Array.from(root.querySelectorAll(BLUR_CLASSES.map((c) => `.${c}`).join(",")));
}

/** Rule 4: visible text on a blurred layer that is not a title, not on a plate (mat-sheet paints its own plate). */
export function textOutsidePlates(el: Element): string[] {
  const out: string[] = [];
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    const parent = node.parentElement;
    if (!text || !parent) continue;
    if (parent.closest(".plate, .mat-sheet, [data-glass-title], .sr-only, svg")) continue;
    out.push(text);
  }
  return out;
}
