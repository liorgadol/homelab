# Cutter: "Re-run in high quality" (birefnet-general-lite)

## Why
`isnet-general-use` (default, ~1s) is good for most images; fur/hair/fine edges sometimes need
`birefnet-general-lite`, which is cleaner but ~12s/image and ~6.7GB RAM peak on the host
(i5-9500T, 14GB). User wants it as an opt-in per image, from the editor only.

## Goals
- Editor panel: "✨ Re-run in high quality" button for the open image. Same confirm as Re-run AI when the image has edits ("Discard edits and re-run AI?").
- Item gets `quality: 'standard'|'high'`. HQ items: "HQ" badge in queue strip; spinner text "High quality — about 15 s…". Button hidden once item is HQ. "Re-run AI" repeats the item's current quality.
- Queue still processes one image at a time (HQ included).
- Backend: `POST /remove-bg?quality=standard|high` (default standard; other values → 422).
  - Standard session as today (always loaded).
  - HQ session: `birefnet-general-lite`, created lazily on first HQ request with ONNX Runtime `enable_cpu_mem_arena=False`, `enable_mem_pattern=False`; one HQ inference at a time (lock); unloaded after 5 idle minutes (free memory + `gc.collect()`).
  - Both models baked into the image (Dockerfile pre-download).
- compose: `mem_limit: 9g` on `cutter-backend` so an out-of-memory kill hits only Cutter's backend.

## Non-goals
Upload-time quality toggle, batch-wide HQ, GPU, other models.

## Approaches
- Lazy-load + idle-unload HQ session (picked): RAM only used while in use.
- Always-loaded HQ session: faster first HQ image, but holds GBs permanently.
- Separate HQ container: isolation, but more compose/nginx plumbing for one model.

## Builder calls
Idle-unload mechanism (timer thread vs check-on-request + background timer), exact badge styling.
