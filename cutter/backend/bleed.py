from io import BytesIO
from PIL import Image
import numpy as np
from scipy.ndimage import binary_fill_holes, distance_transform_edt, label

DPI = 300
MM_PER_INCH = 25.4
MAX_OUTPUT_DIMENSION = 8000
MIN_OFFSET_MM = 0.0
MAX_OFFSET_MM = 10.0
ALPHA_THRESHOLD = 26
MIN_ISLAND_MM2 = 1.0
_EIGHT_CONNECTED = np.ones((3, 3), dtype=bool)


class BleedError(ValueError):
    """Raised for invalid input to add_bleed."""


def _mm_to_px(offset_mm: float) -> int:
    return round(offset_mm * DPI / MM_PER_INCH)


def _png_bytes(img: Image.Image) -> bytes:
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def add_bleed(png_bytes: bytes, offset_mm: float) -> bytes:
    if not (MIN_OFFSET_MM <= offset_mm <= MAX_OFFSET_MM):
        raise BleedError(
            f"offset_mm must be between {MIN_OFFSET_MM} and {MAX_OFFSET_MM}"
        )

    img = Image.open(BytesIO(png_bytes)).convert("RGBA")
    r = _mm_to_px(offset_mm)
    if r == 0:
        return _png_bytes(img)

    src = np.array(img)
    h, w = src.shape[:2]

    if w + 2 * r > MAX_OUTPUT_DIMENSION or h + 2 * r > MAX_OUTPUT_DIMENSION:
        raise BleedError(
            f"resulting image would exceed {MAX_OUTPUT_DIMENSION}px on a side"
        )

    src = src.copy()
    mask = src[:, :, 3] >= ALPHA_THRESHOLD

    labels, n = label(mask, structure=_EIGHT_CONNECTED)
    if n:
        min_px = MIN_ISLAND_MM2 * (DPI / MM_PER_INCH) ** 2
        sizes = np.bincount(labels.ravel(), minlength=n + 1)
        keep = sizes >= min_px
        keep[0] = False
        small = (labels > 0) & ~keep[labels]
        if small.any():
            src[small] = 0
            mask &= ~small
    if not mask.any():
        return _png_bytes(img)

    padded = np.zeros((h + 2 * r, w + 2 * r, 4), dtype=np.uint8)
    padded[r:r + h, r:r + w] = src
    padded_mask = np.zeros((h + 2 * r, w + 2 * r), dtype=bool)
    padded_mask[r:r + h, r:r + w] = mask

    filled_mask = binary_fill_holes(padded_mask)

    distance = distance_transform_edt(~filled_mask)
    bleed_a = np.clip(r + 0.5 - distance, 0.0, 1.0).astype(np.float32)

    src_a = padded[:, :, 3].astype(np.float32) / 255.0
    # Faint haze beyond the cut line would print outside the sticker: drop it.
    src_a[bleed_a == 0] = 0.0
    out_a = src_a + bleed_a * (1.0 - src_a)
    white_w = bleed_a * (1.0 - src_a)
    num = padded[:, :, :3].astype(np.float32) * src_a[..., None] + 255.0 * white_w[..., None]
    safe = np.where(out_a > 0, out_a, 1.0)
    out_rgb = num / safe[..., None]

    out = np.zeros_like(padded)
    out[:, :, :3] = np.clip(np.rint(out_rgb), 0, 255).astype(np.uint8)
    out[:, :, 3] = np.clip(np.rint(out_a * 255.0), 0, 255).astype(np.uint8)

    return _png_bytes(Image.fromarray(out, mode="RGBA"))
