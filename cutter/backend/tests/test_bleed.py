from io import BytesIO
from PIL import Image
import numpy as np
import pytest

from bleed import add_bleed, BleedError


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
