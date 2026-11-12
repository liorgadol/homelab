# Cutter round 1: correctness, cleaner cuts, backend speed

## Why
Cutter makes Cricut print-then-cut stickers. Today the downloaded file can be wrong
(stale bleed), editor navigation is broken, and stray specks/jagged edges cause bad cuts.
Model stays rembg (withoutbg integration deferred by user).

## Goals
1. Frontend correctness (Editor.jsx, useCanvasEditor.js)
   - Bleed recomputes after every edit (stroke end, undo, redo), not only on toggle/offset.
   - Download with bleed on always renders bleed from the *current* canvas (fresh /add-bleed call), never a stale or in-flight blob.
   - Cmd/Ctrl+Shift+Z redo works (`e.key` is `'Z'` with Shift).
   - Fit to screen measures `.canvas-viewport`, not the canvas-sized parent; auto-fit when an image loads.
   - Wheel zoom: native non-passive listener so page does not scroll.
   - Pan: hold Space + drag, or middle-mouse drag, translates the view. Painting disabled while panning.
   - Remove stale "First run downloads the AI model" text in App.jsx (model is baked into image).
2. Cleaner cuts (bleed.py)
   - Mask uses alpha threshold (alpha >= 26, ~10%) instead of `alpha > 0`.
   - Islands smaller than `MIN_ISLAND_MM2` (default 1.0 mm² at 300 DPI) are dropped from mask AND their pixels cleared from output (no orphan specks printed outside the cut).
   - Bleed edge anti-aliased: bleed alpha = clip(r + 0.5 - distance, 0, 1) instead of hard `distance <= r`.
   - If nothing survives cleanup, return input unchanged.
3. Backend speed/robustness (main.py)
   - One shared rembg session (`new_session('u2net')`) created once, reused.
   - CPU-bound routes become plain `def` so FastAPI runs them in threadpool; `/health` stays responsive.
   - 500 responses return generic message; exception logged server-side.

## Non-goals
withoutbg, model selector, DPI/physical sizing, SVG export, outline colour, batch, sheet layout, touch support, undo memory rework.

## Approaches considered
- Bleed sync: (a) bump an `editVersion` counter on stroke end/undo/redo and add it to the bleed effect deps — picked, minimal; (b) client-side bleed rendering — bigger, deferred.
- Download: fresh server call at download time (picked) vs waiting on in-flight request — fresh is simpler and always correct.

## Builder calls
Exact pan implementation, island threshold constant names, and log format are builder's call. Existing tests must keep passing.
