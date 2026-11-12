import logging
import threading

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from rembg import remove, new_session
from bleed import add_bleed, BleedError, _mm_to_px

logger = logging.getLogger("cutter")

_session = None
_session_lock = threading.Lock()


def _get_session():
    global _session
    if _session is None:
        with _session_lock:
            if _session is None:
                _session = new_session("u2net")
    return _session


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
def remove_background(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=422, detail="File must be an image")
    try:
        input_bytes = file.file.read()
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
