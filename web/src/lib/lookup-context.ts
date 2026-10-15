/**
 * Marks for select-to-lookup (plan 2026-10-15-global-longpress-glass-lookup R-M1, R-L2, R-L6).
 * A `[data-lookup-context]` element holds English learning text: the global LookupLayer reads selections inside it, and its
 * long-press recogniser selects the pressed word there. `data-lookup-press="own"` marks an element that handles its own
 * long-press (the wordbook review option rows); the global recogniser leaves it alone. Pure DOM helpers, no React.
 */
export const LOOKUP_CONTEXT_SELECTOR = "[data-lookup-context]";
export const OWN_LONG_PRESS_SELECTOR = '[data-lookup-press="own"]';
/** Interactive elements inside a context are never long-press targets (a link in a chat reply, a button). */
const INTERACTIVE_SELECTOR =
  "a[href], button, input, textarea, select, summary, [contenteditable]:not([contenteditable='false']), [role='button'], [role='textbox'], [role='link']";

/** Spread on the smallest element that holds English learning text: `<p {...lookupContext}>` (R-M2). */
export const lookupContext = { "data-lookup-context": "" } as const;

/** `lookupContext` only when `on` (quiz prompts become lookup-able only after the answer, R-M3). */
export const lookupContextIf = (on: boolean): { "data-lookup-context"?: "" } => (on ? lookupContext : {});

/** Spread on an element that owns its long-press, so the global recogniser skips it (R-L6). */
export const ownLongPress = { "data-lookup-press": "own" } as const;

/** The lookup context a press on `target` belongs to, or null when the global long-press must ignore it. */
export function lookupPressContext(target: EventTarget | null): Element | null {
  const el = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  if (!el || el.closest(OWN_LONG_PRESS_SELECTOR)) return null;
  const ctx = el.closest(LOOKUP_CONTEXT_SELECTOR);
  if (!ctx) return null;
  const interactive = el.closest(INTERACTIVE_SELECTOR);
  return interactive && ctx.contains(interactive) ? null : ctx;
}
