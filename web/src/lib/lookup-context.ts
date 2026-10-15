/**
 * Marks for select-to-lookup (plan 2026-10-15-global-longpress-glass-lookup R-M1; tap-to-lookup replaced the long-press recogniser).
 * A `[data-lookup-context]` element holds English learning text: the global LookupLayer reads selections inside it, and its
 * tap-to-lookup hook marks (first tap) and selects (second tap) the tapped word there. `data-lookup-tap="off"` opts a subtree
 * out of tapping. Pure DOM helpers, no React.
 */
export const LOOKUP_CONTEXT_SELECTOR = "[data-lookup-context]";
export const TAP_OFF_SELECTOR = '[data-lookup-tap="off"]';
/** A tap inside any of these keeps its own meaning (a link in a chat reply, a button, a form control) and never marks a word. */
const INTERACTIVE_SELECTOR =
  "a, button, input, textarea, select, summary, label, [contenteditable]:not([contenteditable='false']), " +
  "[role='button'], [role='link'], [role='tab'], [role='menuitem'], [role='switch'], [role='checkbox'], [role='textbox']";

/** Spread on the smallest element that holds English learning text: `<p {...lookupContext}>` (R-M2). */
export const lookupContext = { "data-lookup-context": "" } as const;

/** `lookupContext` only when `on` (quiz prompts become lookup-able only after the answer, R-M3). */
export const lookupContextIf = (on: boolean): { "data-lookup-context"?: "" } => (on ? lookupContext : {});

/** Spread on an element whose subtree must not react to taps (tap-to-lookup opt-out). */
export const lookupTapOff = { "data-lookup-tap": "off" } as const;

/** The lookup context a tap on `target` belongs to, or null when tap-to-lookup must ignore it. */
export function lookupTapContext(target: EventTarget | null): Element | null {
  const el = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  if (!el || el.closest(TAP_OFF_SELECTOR) || el.closest(INTERACTIVE_SELECTOR)) return null;
  return el.closest(LOOKUP_CONTEXT_SELECTOR);
}
