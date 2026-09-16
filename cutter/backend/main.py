from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from rembg import remove
from bleed import add_bleed, BleedError, _mm_to_px

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
async def remove_background(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=422, detail="File must be an image")
    try:
        input_bytes = await file.read()
        output_bytes = remove(input_bytes)
        return Response(content=output_bytes, media_type="image/png")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/add-bleed")
async def add_bleed_route(offset_mm: float, file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=422, detail="File must be an image")
    try:
        input_bytes = await file.read()
        output_bytes = add_bleed(input_bytes, offset_mm)
    except BleedError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return Response(
        content=output_bytes,
        media_type="image/png",
        headers={"X-Bleed-Px": str(_mm_to_px(offset_mm))},
    )
