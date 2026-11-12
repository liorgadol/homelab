from io import BytesIO
from PIL import Image
import numpy as np
import pytest

from bleed import add_bleed, BleedError, _mm_to_px


def make_png(img: Image.Image) -> bytes:
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def decode_png(data: bytes) -> Image.Image:
    return Image.open(BytesIO(data)).convert("RGBA")


def solid_square_png(size=200, square=100, color=(255, 0, 0, 255)) -> bytes:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pad = (size - square) // 2
    for y in range(pad, pad + square):
        for x in range(pad, pad + square):
            img.putpixel((x, y), color)
    return make_png(img)


def test_offset_zero_returns_same_pixels():
    src = solid_square_png()
    out = add_bleed(src, 0.0)
    src_arr = np.array(decode_png(src))
    out_arr = np.array(decode_png(out))
    assert src_arr.shape == out_arr.shape
    assert np.array_equal(src_arr, out_arr)


def _alpha_bbox(img: Image.Image):
    arr = np.array(img)
    alpha = arr[:, :, 3]
    ys, xs = np.where(alpha > 0)
    if ys.size == 0:
        return None
    return (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))


def test_solid_square_grows_by_r_with_white_ring():
    src = solid_square_png(size=200, square=100, color=(200, 50, 50, 255))
    src_bbox = _alpha_bbox(decode_png(src))
    assert src_bbox == (50, 50, 149, 149)

    out = add_bleed(src, 2.54)
    out_img = decode_png(out)
    out_arr = np.array(out_img)

    assert out_img.size[0] >= 200 and out_img.size[1] >= 200

    out_bbox = _alpha_bbox(out_img)
    src_w = src_bbox[2] - src_bbox[0]
    src_h = src_bbox[3] - src_bbox[1]
    out_w = out_bbox[2] - out_bbox[0]
    out_h = out_bbox[3] - out_bbox[1]
    assert abs(out_w - (src_w + 60)) <= 2
    assert abs(out_h - (src_h + 60)) <= 2

    cx, cy = out_img.size[0] // 2, out_img.size[1] // 2
    r_px, g_px, b_px, a_px = out_arr[cy, cx]
    assert (r_px, g_px, b_px, a_px) == (200, 50, 50, 255)

    ring_pixels = (
        (out_arr[:, :, 3] == 255)
        & (out_arr[:, :, 0] == 255)
        & (out_arr[:, :, 1] == 255)
        & (out_arr[:, :, 2] == 255)
    )
    assert ring_pixels.sum() > 0, "expected at least some white bleed pixels"


def square_with_hole_png(size=200, square=100, hole=30) -> bytes:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pad = (size - square) // 2
    hole_pad = (size - hole) // 2
    for y in range(pad, pad + square):
        for x in range(pad, pad + square):
            img.putpixel((x, y), (10, 200, 10, 255))
    for y in range(hole_pad, hole_pad + hole):
        for x in range(hole_pad, hole_pad + hole):
            img.putpixel((x, y), (0, 0, 0, 0))
    return make_png(img)


def test_interior_holes_are_filled_with_white():
    src = square_with_hole_png()
    src_img = decode_png(src)
    cx, cy = src_img.size[0] // 2, src_img.size[1] // 2
    assert src_img.getpixel((cx, cy))[3] == 0

    out_img = decode_png(add_bleed(src, 1.0))
    ox, oy = out_img.size[0] // 2, out_img.size[1] // 2
    px = out_img.getpixel((ox, oy))
    assert px == (255, 255, 255, 255), (
        f"expected center hole to be filled white, got {px}"
    )


def test_fully_transparent_input_passthrough():
    img = Image.new("RGBA", (50, 50), (0, 0, 0, 0))
    src = make_png(img)
    out = add_bleed(src, 3.0)
    out_img = decode_png(out)
    arr = np.array(out_img)
    assert arr.shape == (50, 50, 4)
    assert (arr[:, :, 3] == 0).all()


def test_oversize_result_rejected():
    img = Image.new("RGBA", (7980, 10), (255, 0, 0, 255))
    src = make_png(img)
    with pytest.raises(BleedError):
        add_bleed(src, 1.0)


def test_offset_out_of_range_rejected():
    src = solid_square_png()
    with pytest.raises(BleedError):
        add_bleed(src, -0.1)
    with pytest.raises(BleedError):
        add_bleed(src, 10.1)


def array_png(arr: np.ndarray) -> bytes:
    return make_png(Image.fromarray(arr, mode="RGBA"))


def blank(h: int, w: int) -> np.ndarray:
    return np.zeros((h, w, 4), dtype=np.uint8)


def test_faint_speck_island_dropped_without_bleed():
    # 3x3 opaque speck (9 px, well under the 1 mm^2 ~ 139.5 px island floor)
    # far from a real subject must not print, nor grow a bleed ring.
    arr = blank(200, 200)
    arr[70:130, 70:130] = (200, 50, 50, 255)
    arr[10:13, 10:13] = (0, 0, 255, 255)
    r = _mm_to_px(1.0)
    out = np.array(decode_png(add_bleed(array_png(arr), 1.0)))

    assert out[10 + r, 10 + r, 3] == 0
    window = out[10:13 + 2 * r, 10:13 + 2 * r, 3]
    assert (window == 0).all(), "speck produced alpha in its neighbourhood"

    # Sanity: the real subject is still bled, so the test is not vacuous.
    assert out[100 + r, 100 + r, 3] == 255
    assert out[70 + r - 1, 100 + r, 3] > 0


def test_faint_haze_outside_subject_is_cleared():
    arr = blank(200, 200)
    arr[70:130, 70:130] = (200, 50, 50, 255)
    arr[0:10, 0:10] = (30, 30, 30, 10)  # alpha 10 < ALPHA_THRESHOLD (26)
    r = _mm_to_px(1.0)
    out = np.array(decode_png(add_bleed(array_png(arr), 1.0)))

    haze = out[r:r + 10, r:r + 10, 3]
    assert (haze == 0).all(), "faint haze leaked into output"


def test_bleed_edge_is_anti_aliased():
    arr = blank(200, 200)
    arr[70:130, 70:130] = (200, 50, 50, 255)
    r = _mm_to_px(1.0)
    out = np.array(decode_png(add_bleed(array_png(arr), 1.0)))

    alpha = out[:, :, 3]
    partial = (alpha > 0) & (alpha < 255)
    assert partial.any(), "expected partially transparent bleed edge pixels"
    # Outer bleed boundary (distance == r) has bleed alpha 0.5 -> ~128.
    assert alpha[70, 100 + r] == 128


def test_all_specks_image_output_keeps_input_size():
    arr = blank(120, 160)
    arr[10:13, 10:13] = (255, 0, 0, 255)
    arr[60:63, 100:103] = (255, 0, 0, 255)
    arr[100:103, 20:23] = (255, 0, 0, 255)
    out_img = decode_png(add_bleed(array_png(arr), 2.0))
    assert out_img.size == (160, 120)


def test_all_specks_image_is_returned_unchanged():
    # By design: if cleanup would leave nothing, return the input untouched
    # rather than a blank sticker.
    arr = blank(120, 160)
    arr[10:13, 10:13] = (255, 0, 0, 255)
    out = np.array(decode_png(add_bleed(array_png(arr), 2.0)))
    assert np.array_equal(out, arr)


def test_island_floor_drops_121px_and_keeps_144px_islands():
    # 11x11 = 121 px < 139.5 px floor -> dropped.
    # 12x12 = 144 px >= 139.5 px floor -> kept.
    arr = blank(300, 300)
    arr[100:200, 180:280] = (10, 10, 10, 255)
    arr[5:16, 5:16] = (255, 0, 0, 255)
    arr[250:262, 5:17] = (0, 255, 0, 255)
    r = _mm_to_px(1.0)
    out = np.array(decode_png(add_bleed(array_png(arr), 1.0)))

    dropped = out[5:16 + 2 * r, 5:16 + 2 * r, 3]
    assert (dropped == 0).all(), "11x11 island should be dropped with no bleed"
    assert out[250 + r + 6, 5 + r + 6, 3] == 255, "12x12 island should be kept"


def test_subject_interior_color_preserved_and_bleed_ring_is_white():
    size, square = 200, 100
    pad = (size - square) // 2
    color = (12, 180, 90, 255)
    arr = blank(size, size)
    arr[pad:pad + square, pad:pad + square] = color
    r = _mm_to_px(1.0)
    out = np.array(decode_png(add_bleed(array_png(arr), 1.0)))

    interior = out[pad + r:pad + r + square, pad + r:pad + r + square]
    assert (interior == np.array(color, dtype=np.uint8)).all()

    # One pixel outside the cut line, well inside the bleed radius.
    ring = out[pad - 1 + r, pad + square // 2 + r]
    assert tuple(ring) == (255, 255, 255, 255)
