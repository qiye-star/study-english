# Liquid glass UI polish results (2026-10-15)

1. Routing: AppearancePage guarded on useLiquid() (data-glass === "v2"). Entering from /library or /practice/changelog the attribute is still "pin" for the first commit (GlassRoutePin updates it in a layout effect after render), so the guard rendered Navigate to /me. Guard now uses isGlassOn() (attribute present = app-wide switch). Test: appearance-route-pin.test.tsx.
2. Red badge: the changelog unread dot (ChangelogEntry, bg-red) on the practice header. The changelog dir is locked (no liquid tokens allowed), so practice-page.tsx wraps the practiceHeaderActions slot in a `contents` span that recolours the dot to blue under liquid. Classic/pinned look unchanged.
3. Appearance: preview card is now a flex column (no absolute text); page bottom padding is calc(var(--tab-bar-space)+2rem).
4. Tab bar untouched.

Bundle: 416.3 kB, +0.04 kB vs 416.26 baseline (budget 0.2). Build log had no WARNING.
Unverified: visual result in a real browser; whether main's own pb-[var(--tab-bar-space)] was already sufficient (padding now stacks).
