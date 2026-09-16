import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch
from io import BytesIO
from PIL import Image
from bleed import _mm_to_px

# Import app lazily so it doesn't break before main.py exists
@pytest.fixture
def app():
    from main import app as _app
    return _app

@pytest.mark.asyncio
async def test_health(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def make_test_png() -> bytes:
    """Create a tiny valid RGBA PNG for testing."""
    img = Image.new("RGBA", (4, 4), (255, 0, 0, 128))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def make_solid_png(size=20, color=(0, 200, 0, 255)) -> bytes:
    img = Image.new("RGBA", (size, size), color)
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.mark.asyncio
async def test_remove_bg_returns_png(app):
    result_png = make_test_png()
    with patch("main.remove", return_value=result_png):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            res = await client.post(
                "/remove-bg",
                files={"file": ("photo.jpg", BytesIO(make_test_png()), "image/jpeg")},
            )
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/png"
    assert len(res.content) > 0


@pytest.mark.asyncio
async def test_remove_bg_missing_file_returns_422(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post("/remove-bg")
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_add_bleed_returns_png_with_padding_header(app):
    src = make_solid_png(size=20)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(
            "/add-bleed",
            params={"offset_mm": 1.0},
            files={"file": ("img.png", BytesIO(src), "image/png")},
        )
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/png"
    expected_r = _mm_to_px(1.0)
    assert res.headers["x-bleed-px"] == str(expected_r)
    out = Image.open(BytesIO(res.content)).convert("RGBA")
    assert out.size == (20 + 2 * expected_r, 20 + 2 * expected_r)


@pytest.mark.asyncio
async def test_add_bleed_invalid_offset(app):
    src = make_solid_png()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res_low = await client.post(
            "/add-bleed",
            params={"offset_mm": -1.0},
            files={"file": ("img.png", BytesIO(src), "image/png")},
        )
        res_high = await client.post(
            "/add-bleed",
            params={"offset_mm": 11.0},
            files={"file": ("img.png", BytesIO(src), "image/png")},
        )
    assert res_low.status_code == 422
    assert res_high.status_code == 422


@pytest.mark.asyncio
async def test_add_bleed_rejects_non_image(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(
            "/add-bleed",
            params={"offset_mm": 1.0},
            files={"file": ("note.txt", BytesIO(b"hello"), "text/plain")},
        )
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_add_bleed_missing_offset(app):
    src = make_solid_png()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.post(
            "/add-bleed",
            files={"file": ("img.png", BytesIO(src), "image/png")},
        )
    assert res.status_code == 422
