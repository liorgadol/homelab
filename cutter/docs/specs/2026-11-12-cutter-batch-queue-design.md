# Cutter: batch queue + download all

## Why
User makes several stickers per session. Today Cutter takes one image (extra dropped files silently ignored).
Wants: drop many images, bg removed in background, touch up each in the editor, then download all together.

## Goals
- Upload many images at once (file picker `multiple`, multi-file drop). "+ Add" button adds more later.
- Queue strip of thumbnails above the editor with per-item status: waiting · removing bg · done · failed (retry).
  Strip hidden when the queue has exactly one item (single-image flow looks like today).
- Backend processes one image at a time (sequential `/remove-bg` calls from the browser). User can edit a done item while others process.
- Click a thumbnail to open it in the editor. Edits persist per item when switching (saved as the item's edited PNG). Undo history resets on switch (memory).
- Outline (bleed) setting is per item. New items inherit last-used setting. "Apply outline to all" copies current item's setting to every item.
- Per-item: remove from queue (×), Re-run AI (asks confirmation if item has edits — discards them).
- "Download all" builds one zip in the browser (fflate): every done item, edited-or-AI result, with `/add-bleed` applied when that item's outline is on. Names `name-nobg.png` / `name-bleed-3_0mm.png`; duplicates get `-2`, `-3`. Zip name `cutter-YYYYMMDD-HHMM.zip`. Progress shown ("Preparing 3/10"); waiting/failed items skipped and reported.
- Single "Download PNG" for the current item keeps working as today.
- Unsupported file types in a drop are reported ("2 files skipped: HEIC not supported"), not silently ignored.

## Non-goals
Server-side queue/persistence (refresh loses queue), parallel processing, per-item undo history across switches, sheet layout, HEIC decoding, backend changes.

## Approaches
1. **Browser-side queue + browser zip** — picked. No backend change, reuses `/remove-bg` and `/add-bleed`.
2. Server-side job queue — survives refresh but needs storage/cleanup/job API; too heavy for homelab tool.
3. Separate downloads, no zip — browsers block/prompt on many downloads.

## Builder calls (my proposals, builder may refine)
- Queue state lives in App: `{id, file, status, resultBlob, editedBlob, bleed:{enabled, offsetMm}, error}` + `selectedId`.
- Editor is keyed by item id; loads `editedBlob ?? resultBlob`; reports edits back via callback (debounced canvas.toBlob on editVersion change, flushed on unmount/switch); bleed enabled/offset become controlled props.
- Max 50 files per add (more → message). Thumbnails via object URLs, revoked on removal.
- New dependency: `fflate` (frontend only).
- Existing tests keep passing; existing single-image tests may need updating where the flow legitimately changed.
