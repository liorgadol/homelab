from io import BytesIO
from PIL import Image
import numpy as np
from scipy.ndimage import binary_fill_holes, distance_transform_edt

DPI = 300
MM_PER_INCH = 25.4
MAX_OUTPUT_DIMENSION = 8000
MIN_OFFSET_MM = 0.0
MAX_OFFSET_MM = 10.0


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

    alpha = src[:, :, 3]
    mask = alpha > 0
    if not mask.any():
        return _png_bytes(img)

    padded = np.zeros((h + 2 * r, w + 2 * r, 4), dtype=np.uint8)
    padded[r:r + h, r:r + w] = src
    padded_mask = np.zeros((h + 2 * r, w + 2 * r), dtype=bool)
    padded_mask[r:r + h, r:r + w] = mask

    filled_mask = binary_fill_holes(padded_mask)

    distance = distance_transform_edt(~filled_mask)
    dilated_mask = distance <= r

    out = np.zeros_like(padded)
    out[dilated_mask] = (255, 255, 255, 255)
    src_alpha = padded[:, :, 3:4].astype(np.float32) / 255.0
    out_rgb = padded[:, :, :3].astype(np.float32) * src_alpha + \
              out[:, :, :3].astype(np.float32) * (1.0 - src_alpha)
    out_a = np.maximum(out[:, :, 3], padded[:, :, 3])
    out[:, :, :3] = np.clip(out_rgb, 0, 255).astype(np.uint8)
    out[:, :, 3] = out_a

    return _png_bytes(Image.fromarray(out, mode="RGBA"))
