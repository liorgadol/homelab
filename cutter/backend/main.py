import gc
import logging
import threading

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from rembg import remove, new_session
from bleed import add_bleed, BleedError, _mm_to_px

logger = logging.getLogger("cutter")

MODEL_NAME = "isnet-general-use"
HQ_MODEL_NAME = "birefnet-general-lite"
HQ_IDLE_SECONDS = 300

_session = None
_session_lock = threading.Lock()


def _get_session():
    global _session
    if _session is None:
        with _session_lock:
            if _session is None:
                _session = new_session(MODEL_NAME)
    return _session


_hq_lock = threading.Lock()
_hq_session = None
_hq_timer = None


def _create_hq_session():
    import onnxruntime as ort
    from rembg.sessions import sessions_class

    opts = ort.SessionOptions()
    opts.enable_cpu_mem_arena = False
    opts.enable_mem_pattern = False
    for cls in sessions_class:
        if cls.name() == HQ_MODEL_NAME:
            return cls(HQ_MODEL_NAME, opts)
    raise RuntimeError(f"No rembg session class for {HQ_MODEL_NAME}")


def _run_hq(input_bytes):
    global _hq_session, _hq_timer
    with _hq_lock:
        if _hq_timer is not None:
            _hq_timer.cancel()
            _hq_timer = None
        if _hq_session is None:
            _hq_session = _create_hq_session()
        try:
            return remove(input_bytes, session=_hq_session)
        finally:
            _hq_timer = threading.Timer(HQ_IDLE_SECONDS, _unload_hq)
            _hq_timer.args = (_hq_timer,)
            _hq_timer.daemon = True
            _hq_timer.start()


def _unload_hq(timer=None):
    """Drop the HQ session. When called by an idle timer, only that timer's
    own (still current) schedule may unload; a timer superseded by a newer
    run while it waited on the lock does nothing."""
    global _hq_session, _hq_timer
    with _hq_lock:
        if timer is not None and timer is not _hq_timer:
            return
        _hq_session = None
        _hq_timer = None
        gc.collect()
    logger.info("Unloaded high quality model after idle")


app = FastAPI(title="Cutter API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/remove-bg")
def remove_background(file: UploadFile = File(...), quality: str = "standard"):
    if quality not in ("standard", "high"):
        raise HTTPException(status_code=422, detail="quality must be standard or high")
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=422, detail="File must be an image")
    try:
        input_bytes = file.file.read()
        if quality == "high":
            output_bytes = _run_hq(input_bytes)
        else:
            output_bytes = remove(input_bytes, session=_get_session())
        return Response(content=output_bytes, media_type="image/png")
    except Exception as exc:
        logger.exception("Processing failed")
        raise HTTPException(status_code=500, detail="Processing failed") from exc


@app.post("/add-bleed")
def add_bleed_route(offset_mm: float, file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=422, detail="File must be an image")
    try:
        input_bytes = file.file.read()
        output_bytes = add_bleed(input_bytes, offset_mm)
    except BleedError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Processing failed")
        raise HTTPException(status_code=500, detail="Processing failed") from exc
    return Response(
        content=output_bytes,
        media_type="image/png",
        headers={"X-Bleed-Px": str(_mm_to_px(offset_mm))},
    )
