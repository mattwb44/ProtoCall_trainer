# PRD — Fire & Smoke markup tools

_Status: **planned, not built** (owner grill 2026-08-23). Deferred until after the
D1 v3 editor rework ships. This document is the buildable spec; see
`docs/ai/next-session.md` for the D1 v3 build-now items these depend on._

## Summary

Two new tools in the media markup editor (`openMarkupEditor`, `public/index.html`)
that let an author paint **fire** and **smoke** onto a scene photo by pressing and
holding. They extend the existing editable-overlay model — every gesture stays a
first-class, reversible overlay object, never baked pixels.

## Why

Fireground/EMS scenarios are more legible when the author can show *where the fire
is and what the smoke is doing* (color + volume are real size-up cues). Freehand pen
strokes can't convey glowing embers or building smoke density. These tools make the
scene communicate fire behavior at a glance.

## Core interaction (both tools)

- Author selects the **Fire** or **Smoke** tool; the color popover opens **already
  switched to that tool's palette** (Fire → Fire palette, Smoke → Smoke palette; see
  the palette spec in D1 v3). Author picks a color; the popover closes and the tool
  shows the chosen color.
- **Press-and-hold** on the photo **builds the effect up at that spot** — the longer
  the hold, the more it accumulates and grows.
- **Drag while holding** **lays the effect along the drag path**, so the author can
  either pile up one hotspot or paint a spreading band (e.g. smoke along a roofline,
  embers along a car's edge).
- Releasing ends the gesture and commits **one object** (see Storage).

## Fire behavior

- Renders as **simple, bright embers** — small glowing shapes in the selected fire
  color. **Bright/solid from the first touch** (embers glow; they do not fade in).
- Density and spread **grow with hold time** and follow the drag path.

## Smoke behavior

- Renders as **small smoke shapes** that **slowly grow** in size with hold time.
- **Opacity builds with hold time:** the first touch is **faint and see-through**;
  the longer the hold, the **more opaque/denser** it becomes. Quick tap = wispy haze;
  long hold = thick, choking smoke. (This is the inverse of a fade-out — it fades
  *in* and thickens.)

## Storage — the "recipe" model (load-bearing decision)

**Do NOT store individual embers/particles, and do NOT bake to flat pixels.** A few
seconds of holding would be thousands of shapes: it would blow the overlay's
**256 KB cap** (`MAX_OVERLAY_BYTES`), be slow, and — critically — **could not reopen
identically** (random particles re-scatter differently each time), breaking the D1a
editable-overlay guarantee.

Instead, store **one deterministic "emitter" object per gesture**:

```
{ id, type: 'fire' | 'smoke', color,
  path: [[x,y], …],        // the press point, or the drag path
  intensity,               // accumulated from hold duration (density / count / growth)
  seed }                   // fixes the pseudo-random layout
```

The embers/smoke are **regenerated deterministically from `(path, intensity, seed)`
every render** (screen + canvas export), so the effect looks **identical on every
reopen**, stays tiny in storage, and remains one editable unit. Same idea as saving
_"a medium campfire, right here"_ rather than the position of every flame.

Determinism requirement: use a **seeded PRNG** (not `Math.random()` at render time)
so on-screen SVG and the exported PNG composite match and survive reopen.

## Editing & deletion

Fire/smoke patches are **selectable like text boxes** (reusing the D1 v3 on-canvas
handle system, minus the text-editing part):

- **Tap to select** → shows the selection frame + handles.
- **Drag body to move** the whole patch.
- **Corner handle to resize** the whole patch (scales the effect uniformly).
- **"×" chip to delete.**
- **No eraser shortcut** — the freehand eraser stays pen/highlighter-ink only.
  Removing a just-made patch is covered by **Undo**; removing an arbitrary older
  patch is done via select → ×.

## Constraints & guardrails

- **Overlay cap:** the recipe model keeps each gesture to a handful of numbers, so
  many patches fit under 256 KB. Still cap **max intensity per gesture** and
  **max path points** so a very long hold/drag can't produce an unbounded recipe.
- **Performance:** regenerating particles each render must stay cheap; cap the
  particle count an emitter expands to, and consider caching the generated geometry
  per object between paints.
- **Export parity:** the Canvas 2D export must reproduce the seeded layout, fire
  glow, and smoke opacity build exactly as shown on screen (same approach as the
  existing stroke/text export).
- **Base photo untouched** — fire/smoke live in the overlay only, like all markup.

## Open implementation questions (resolve at build time)

- Exact ember/smoke shape vocabulary and glow style (additive blend vs plain fill).
- How `intensity` maps to count/size/opacity curves (tuning), and the hold-time
  sampling rate.
- Whether resize re-runs the recipe at a new scale or scales the generated geometry.
- Touch vs mouse hold semantics (long-press vs press-hold) and any accessibility
  affordance for "hold" on devices without it.

## Out of scope (for this PRD)

- Animated/looping fire or smoke (these are static composites, like all media).
- Live-session (host) fire/smoke markup — D3 remains parked.
- Wind/drift simulation or physically-based smoke modeling.
