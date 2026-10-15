/**
 * The "pending" underline under the word the user tapped once (tap-to-lookup). It is our own marker, never a browser selection.
 * Preferred: the CSS Custom Highlight API (`CSS.highlights` + `Highlight`, styled by `::highlight(lookup-pending)` in index.css).
 * Fallback for engines without it: absolutely positioned (fixed) underline bars built from `range.getClientRects()`, removed on
 * clear, scroll (the hook clears) and resize. Touches no DOM inside lookup contexts and no text content.
 */
export const PENDING_HIGHLIGHT_NAME = "lookup-pending";
export const FALLBACK_ATTR = "data-lookup-pending-mark";

type HighlightRegistry = { set(name: string, h: unknown): unknown; delete(name: string): unknown };
type HighlightCtor = new (...ranges: Range[]) => unknown;

function highlightApi(win: Window & typeof globalThis): { registry: HighlightRegistry; Highlight: HighlightCtor } | null {
  const registry = (win.CSS as { highlights?: HighlightRegistry } | undefined)?.highlights;
  const Highlight = (win as unknown as { Highlight?: HighlightCtor }).Highlight;
  return registry && typeof Highlight === "function" ? { registry, Highlight } : null;
}

export interface PendingMark {
  show(range: Range): void;
  clear(): void;
  /** true when the CSS Custom Highlight API is in use (false = fixed-layer fallback) */
  readonly native: boolean;
}

export function createPendingMark(doc: Document = document): PendingMark {
  const win = (doc.defaultView ?? window) as Window & typeof globalThis;
  const api = highlightApi(win);
  let bars: HTMLElement[] = [];
  let offViewport: (() => void) | null = null;
  const clearBars = () => {
    for (const bar of bars) bar.remove();
    bars = [];
    offViewport?.();
    offViewport = null;
  };
  const showBars = (range: Range) => {
    clearBars();
    if (typeof range.getClientRects !== "function") return;
    for (const r of Array.from(range.getClientRects())) {
      if (r.width <= 0) continue;
      const bar = doc.createElement("span");
      bar.setAttribute(FALLBACK_ATTR, "");
      bar.setAttribute("aria-hidden", "true");
      Object.assign(bar.style, {
        position: "fixed", left: `${r.left}px`, top: `${r.bottom + 1}px`, width: `${r.width}px`, height: "2px", borderRadius: "1px",
        background: "rgb(var(--blue))", pointerEvents: "none", zIndex: "60",
      });
      doc.body.appendChild(bar);
      bars.push(bar);
    }
    win.addEventListener("resize", clearBars);
    offViewport = () => win.removeEventListener("resize", clearBars);
  };
  return {
    native: api !== null,
    show(range) {
      if (api) api.registry.set(PENDING_HIGHLIGHT_NAME, new api.Highlight(range));
      else showBars(range);
    },
    clear() {
      if (api) api.registry.delete(PENDING_HIGHLIGHT_NAME);
      clearBars();
    },
  };
}
