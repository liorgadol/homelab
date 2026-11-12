# Cutter Batch Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multi-image upload with a processing queue, per-item editing/outline, and a "Download all" zip.

**Architecture:** All queue state in the browser (App via `useQueue` hook). Sequential calls to existing `/remove-bg`; `/add-bleed` per item at zip time. Zip built client-side with fflate. No backend change.

**Tech Stack:** React 18, Vite, vitest + Testing Library, fflate.

**Spec:** `cutter/docs/specs/2026-11-12-cutter-batch-queue-design.md`

## Global Constraints
- Frontend only (`cutter/frontend`). No backend/nginx/compose changes.
- Accepted types stay `image/jpeg`, `image/png`, `image/webp`. Max 50 files per add.
- One `/remove-bg` request in flight at a time.
- Filenames: `name-nobg.png`, `name-bleed-<x_y>mm.png` (existing `formatBleedSuffix`), dupes `-2`, `-3`; zip `cutter-YYYYMMDD-HHMM.zip` (local time).
- Default bleed for first item `{enabled:false, offsetMm:3.0}`; later items inherit last-used.
- Existing tests keep passing, except where single-image flow legitimately changed (update those, say which).
- Test cmd: `cd cutter/frontend && npx vitest run`; build: `npx vite build`.

## Review Focus
1. Removing the item currently processing → its result must be discarded, worker moves on, no crash.
2. Switching items mid-stroke/quickly → edits of previous item saved (flush on unmount), not lost or written to the wrong item.
3. Download all while some items still waiting/processing → only done items zipped; skipped listed.
4. Same filename twice (`cat.png` ×2) → zip contains `cat-nobg.png` and `cat-nobg-2.png`.
5. `/add-bleed` failure for one item during Download all → whole zip not aborted? Decision: abort with error naming the file (user can retry); test it.

---

### Task 1: API helpers, queue hook, zip builder (logic only)

**Files:**
- Create: `src/api.js`, `src/queue/useQueue.js`, `src/queue/zipAll.js`
- Modify: `package.json` (add `fflate`)
- Test: `src/test/useQueue.test.jsx`, `src/test/zipAll.test.js`

**Interfaces — Produces:**
- `api.js`: `removeBg(file: File, signal?) => Promise<Blob>`; `addBleed(blob: Blob, offsetMm: number, signal?) => Promise<Blob>`. Throw `Error` with same messages App/Editor use today (`'Server error — try again'`, `Processing failed (status)`, `'Cannot connect to backend — is it running?'` for TypeError, `Bleed failed (status)`).
- `useQueue({ removeBg })` returns `{ items, selectedId, selected, select(id), addFiles(fileList) => {added:number, skipped:{name,reason}[]}, remove(id), retry(id), rerun(id), setEdited(id, blob), setBleed(id, bleed), applyBleedToAll(bleed) }`.
  Item: `{ id, file, status:'waiting'|'processing'|'done'|'error', resultBlob, editedBlob, bleed:{enabled, offsetMm}, error }`.
  Rules: first added item auto-selected when nothing selected; worker effect starts next `waiting` when none `processing`; `remove` of processing item aborts it (AbortController) and ignores late result; `rerun` clears `resultBlob`/`editedBlob`, sets `waiting`; `retry` = error→waiting; reasons: `'unsupported type'`, `'limit 50 per add'`; new item bleed = last bleed set via `setBleed`/`applyBleedToAll` (default `{enabled:false, offsetMm:3}`); removing selected selects neighbour.
- `zipAll.js`: `uniqueName(name, used:Set) => string`; `outputName(file, bleed) => string`; `zipName(date) => string`; `buildZip(items, { addBleed, onProgress(done,total) }) => Promise<{ blob: Blob, skipped: string[] }>` — non-done items skipped (filenames listed); bleed failure rejects with `Error("<filename>: <msg>")`.

- [ ] Step 1: Tests: `zipName(new Date(2026,10,12,9,5))==='cutter-20261112-0905.zip'`; `outputName({name:'cat.jpg'},{enabled:true,offsetMm:3})==='cat-bleed-3_0mm.png'`, disabled → `'cat-nobg.png'`; `uniqueName` gives `cat-nobg.png`, `cat-nobg-2.png`, `cat-nobg-3.png`; `buildZip` with 2 done + 1 waiting → unzip (fflate `unzipSync`) has 2 entries, `skipped` = waiting name, `addBleed` called only for bleed-enabled item, uses `editedBlob ?? resultBlob`, `onProgress` last call `(2,2)`; addBleed rejection → rejects with message containing filename.
- [ ] Step 2: Tests for useQueue (renderHook, mocked removeBg with deferred promises): sequential (2nd call only after 1st resolves); unsupported skipped; 51 files → 50 added + 1 skipped; remove processing item → result ignored, next starts; error then retry; rerun resets blobs; bleed inheritance; applyBleedToAll; auto-select first; remove selected selects neighbour.
- [ ] Step 3: Run → fail. Implement. Run → pass. `npm i fflate` (pin exact version). Full suite green.

### Task 2: UploadZone multi-file + QueueStrip

**Files:**
- Modify: `src/components/UploadZone.jsx`
- Create: `src/components/QueueStrip.jsx`, `src/components/QueueStrip.css`
- Test: `src/test/UploadZone.test.jsx` (update), `src/test/QueueStrip.test.jsx`

**Interfaces — Produces:**
- `UploadZone({ onFiles(files: File[]) })` — input `multiple`; drop passes all files (filtering is useQueue's job). Replaces `onFile`.
- `QueueStrip({ items, selectedId, onSelect(id), onRemove(id), onRetry(id), onAdd(files: File[]) })` — thumbnail per item (object URL of `file`, revoked on unmount/change), status badge with `aria-label` `waiting|removing background|done|failed`, × button `aria-label="Remove <name>"`, retry button on error `aria-label="Retry <name>"`, selected has `aria-current="true"`, hidden "+ Add" file input (multiple).

- [ ] Step 1: Tests: UploadZone drop of 3 files calls `onFiles` with array of 3; QueueStrip renders badges, click thumbnail → onSelect(id), × → onRemove (not onSelect), retry only on error, aria-current on selected.
- [ ] Step 2: Fail → implement → pass.

### Task 3: Wire App + Editor (depends on 1, 2)

**Files:**
- Modify: `src/App.jsx`, `src/App.css`, `src/components/Editor.jsx`, `src/components/RightPanel.jsx`
- Test: `src/test/App.test.jsx` (update), `src/test/batch.test.jsx`

**Interfaces — Consumes:** Task 1 `useQueue`, `removeBg`, `addBleed`, `buildZip`, `zipName`, `outputName`; Task 2 `UploadZone`, `QueueStrip`.
**Editor props (new):** `Editor({ key: item.id, sourceBlob, originalFile, bleed, onBleedChange(bleed), onEdited(blob), onRerun, onApplyBleedToAll? })`. Bleed enabled/offset controlled by props (internal preview fetch logic stays, use `addBleed`). On `editVersion` change (>initial) debounce 300ms `canvas.toBlob` → `onEdited`; flush pending save on unmount. `onApplyBleedToAll` shown as RightPanel button "Apply outline to all" only when provided (App passes it when items.length > 1).

**App behaviour:** upload page when queue empty; else header with "+ Add" and "⬇ Download all" (when ≥1 done; disabled + "Preparing n/m" while zipping); QueueStrip when items.length > 1; selected item: waiting/processing → spinner "Removing background…", error → error + retry, done → Editor. Skipped files message (`"2 files skipped: unsupported type"`) dismissible. Rerun confirm via `window.confirm('Discard edits and re-run AI?')` only when `editedBlob` exists. Download all errors shown as banner.

- [ ] Step 1: Tests: drop 2 files → first editor shows while 2nd processing; switch item → edits saved (onEdited fired, re-select loads editedBlob); Download all → `addBleed` per bleed-enabled item, anchor `download` matches `/^cutter-\d{8}-\d{4}\.zip$/`; single file → no QueueStrip; rerun with edits asks confirm, cancel keeps edits; Apply outline to all updates other items.
- [ ] Step 2: Fail → implement → pass; update legacy App tests for `onFiles` flow. Build passes.
