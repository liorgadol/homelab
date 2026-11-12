# Cutter High Quality Re-run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-image "Re-run in high quality" using birefnet-general-lite, lazily loaded and idle-unloaded on the backend.

**Architecture:** Backend gains a `quality` query param and a second, lazily created rembg session guarded by a lock with idle unload. Frontend item gains `quality`; editor button reruns with `'high'`.

**Tech Stack:** FastAPI, rembg 2.0.75, onnxruntime; React 18, vitest.

**Spec:** `cutter/docs/specs/2026-11-12-cutter-high-quality-design.md`

## Global Constraints
- Model names: standard `isnet-general-use` (existing `MODEL_NAME`), high `birefnet-general-lite`.
- HQ session options: `enable_cpu_mem_arena=False`, `enable_mem_pattern=False`. Create via `rembg.sessions` class lookup (`cls(name, sess_opts)`) — `new_session(..., sess_opts=...)` raises TypeError in rembg 2.0.75.
- Idle unload after 300 s (`HQ_IDLE_SECONDS = 300`).
- Copy: button "✨ Re-run in high quality"; spinner "High quality — about 15 s…"; badge "HQ"; confirm "Discard edits and re-run AI?".
- Backend test: `cutter/backend` → `<scratchpad>/venv/bin/python -m pytest -q` (24 baseline). Frontend: `npx vitest run` (107 baseline) + `npx vite build`.

## Review Focus
1. HQ request arriving while HQ session is being unloaded → must not use a freed session (lock covers create/use/unload).
2. Two HQ requests at once → serialized, second waits, both succeed.
3. Standard requests during an HQ run → not blocked by the HQ lock.
4. `quality=garbage` → 422, no model load.
5. Rerun in HQ of an item currently processing → stale standard result ignored (existing token logic).

---

### Task A: Backend (main.py, Dockerfile.backend, docker-compose.yml)
**Produces:** `POST /remove-bg?quality=standard|high`; `main._get_session()` unchanged (standard); new `main._run_hq(input_bytes) -> bytes` (acquires `_hq_lock`, lazily creates via `main._create_hq_session()`, runs `remove`, schedules idle unload); `main._unload_hq()`; constants `HQ_MODEL_NAME`, `HQ_IDLE_SECONDS`.
- [ ] Implement; Dockerfile pre-downloads both models; compose `cutter-backend` gets `mem_limit: 9g`.
- [ ] Tests (Haiku): quality default standard; high calls `remove` with HQ session (patch `_create_hq_session`); created once across two calls; `_unload_hq` drops it and next call recreates; invalid quality 422 without load; standard path doesn't touch HQ lock (lock held in another thread → standard request still returns).

### Task B: Frontend
**Consumes:** Task A query param. **Produces:** `removeBg(file, signal, quality='standard')`; item `quality` (default `'standard'`); `rerun(id, quality?)` — sets `quality` when given; worker passes `item.quality`; QueueStrip "HQ" badge (`aria-label="high quality"`) when `quality==='high'`; App spinner copy for HQ; Editor/RightPanel prop `onRerunHigh?` → button shown only when provided (App passes it only for standard items), same confirm logic as rerun.
- [ ] Implement in `src/api.js`, `src/queue/useQueue.js`, `src/components/QueueStrip.jsx`, `src/App.jsx`, `src/components/Editor.jsx`, `src/components/RightPanel.jsx`.
- [ ] Tests (Haiku): api appends `?quality=high`; rerun(id,'high') → removeBg called with 'high', item.quality 'high'; plain rerun keeps quality; HQ badge; button hidden for HQ items; confirm-cancel doesn't rerun; spinner copy.
