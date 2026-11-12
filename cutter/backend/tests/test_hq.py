import asyncio
import threading
import time
from io import BytesIO
from unittest.mock import patch

import pytest
from httpx import AsyncClient, ASGITransport
from PIL import Image


@pytest.fixture
def app():
    from main import app as _app
    return _app


def make_test_png() -> bytes:
    img = Image.new("RGBA", (4, 4), (255, 0, 0, 128))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(autouse=True)
def reset_hq(monkeypatch):
    """Clear HQ module state before and after every test and keep idle
    timers from firing unless a test asks for them."""
    import main

    def _clear():
        timer = main._hq_timer
        if timer is not None:
            timer.cancel()
        main._hq_timer = None
        main._hq_session = None

    monkeypatch.setattr(main, "HQ_IDLE_SECONDS", 60)
    _clear()
    yield
    _clear()


@pytest.fixture
def standard_session():
    """Stub the standard session so no model is loaded."""
    sentinel = object()
    with patch("main._get_session", return_value=sentinel) as get_session:
        get_session.sentinel = sentinel
        yield get_session


@pytest.fixture
def hq_session():
    """Stub the HQ session factory so no model is loaded."""
    sentinel = object()
    with patch("main._create_hq_session", return_value=sentinel) as create:
        create.sentinel = sentinel
        yield create


async def _post_remove_bg(app, **params):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        return await client.post(
            "/remove-bg",
            params=params,
            files={"file": ("photo.jpg", BytesIO(make_test_png()), "image/jpeg")},
        )


# 1. Default quality uses the standard session.
@pytest.mark.asyncio
async def test_default_quality_uses_standard_session(app, standard_session, hq_session):
    with patch("main.remove", return_value=make_test_png()) as remove:
        res = await _post_remove_bg(app)
    assert res.status_code == 200
    remove.assert_called_once()
    assert remove.call_args.kwargs["session"] is standard_session.sentinel
    hq_session.assert_not_called()


# 2. quality=high uses the HQ session, created only once across calls.
@pytest.mark.asyncio
async def test_high_quality_uses_hq_session_created_once(app, standard_session, hq_session):
    with patch("main.remove", return_value=make_test_png()) as remove:
        first = await _post_remove_bg(app, quality="high")
        second = await _post_remove_bg(app, quality="high")
    assert first.status_code == 200
    assert second.status_code == 200
    assert remove.call_count == 2
    for call in remove.call_args_list:
        assert call.kwargs["session"] is hq_session.sentinel
    assert hq_session.call_count == 1
    standard_session.assert_not_called()


# 3. Invalid quality is rejected before any model work.
@pytest.mark.asyncio
async def test_invalid_quality_returns_422_without_loading(app, standard_session, hq_session):
    with patch("main.remove") as remove:
        res = await _post_remove_bg(app, quality="garbage")
    assert res.status_code == 422
    assert res.json()["detail"] == "quality must be standard or high"
    remove.assert_not_called()
    hq_session.assert_not_called()
    standard_session.assert_not_called()


# 4. Direct _unload_hq() drops the session; the next high call recreates it.
@pytest.mark.asyncio
async def test_unload_hq_drops_session_and_next_call_recreates(app, standard_session, hq_session):
    import main

    with patch("main.remove", return_value=make_test_png()):
        await _post_remove_bg(app, quality="high")
        assert hq_session.call_count == 1
        old_timer = main._hq_timer
        main._unload_hq()
        old_timer.cancel()
        assert main._hq_session is None
        await _post_remove_bg(app, quality="high")
    assert hq_session.call_count == 2


# 5. Idle timer unloads the HQ session after HQ_IDLE_SECONDS.
def test_idle_timer_unloads_hq_session(monkeypatch, hq_session):
    import main

    monkeypatch.setattr(main, "HQ_IDLE_SECONDS", 0.05)
    with patch("main.remove", return_value=b"png"):
        main._run_hq(b"input")
    assert main._hq_session is hq_session.sentinel
    time.sleep(0.3)
    assert main._hq_session is None


# 6. A superseded timer cannot unload a newer schedule.
def test_superseded_timer_does_not_unload(hq_session):
    import main

    with patch("main.remove", return_value=b"png"):
        main._run_hq(b"input")
        t1 = main._hq_timer
        main._run_hq(b"input")
        t2 = main._hq_timer

    assert t1 is not t2
    main._unload_hq(t1)
    assert main._hq_session is hq_session.sentinel

    main._unload_hq(main._hq_timer)
    assert main._hq_session is None


# 7. Review Focus 2: concurrent HQ runs are serialized.
def test_concurrent_hq_runs_are_serialized(hq_session):
    import main

    state_lock = threading.Lock()
    active = 0
    max_active = 0

    def slow_remove(input_bytes, session=None):
        nonlocal active, max_active
        with state_lock:
            active += 1
            max_active = max(max_active, active)
        time.sleep(0.1)
        with state_lock:
            active -= 1
        return b"png"

    results = []
    errors = []

    def worker():
        try:
            results.append(main._run_hq(b"input"))
        except Exception as exc:  # pragma: no cover - surfaced by assertion below
            errors.append(exc)

    with patch("main.remove", side_effect=slow_remove):
        threads = [threading.Thread(target=worker) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(5)
        assert not any(t.is_alive() for t in threads)

    assert errors == []
    assert results == [b"png", b"png"]
    assert max_active == 1


# 8. Review Focus 3: standard requests are not blocked by the HQ lock.
def test_standard_request_not_blocked_by_held_hq_lock(app, standard_session):
    import main

    outcome = {}

    def client_thread():
        async def _do():
            return await _post_remove_bg(app)

        try:
            outcome["res"] = asyncio.run(_do())
        except Exception as exc:  # pragma: no cover - surfaced by assertion below
            outcome["error"] = exc

    with patch("main.remove", return_value=make_test_png()) as remove:
        with main._hq_lock:
            t = threading.Thread(target=client_thread, daemon=True)
            t.start()
            t.join(2)
            still_running = t.is_alive()

    assert not still_running, "standard request blocked while HQ lock held"
    assert "error" not in outcome
    assert outcome["res"].status_code == 200
    remove.assert_called_once()
    assert remove.call_args.kwargs["session"] is standard_session.sentinel
