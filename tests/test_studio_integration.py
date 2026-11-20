"""Check the mounted GPU Studio route and the visible engine-navigation contract."""
from pathlib import Path

from fastapi.testclient import TestClient

from server.app import ROOT, STUDIO_DIST, app


def test_classic_ui_exposes_gpu_mode():
    html = (ROOT / "web" / "index.html").read_text()
    assert 'href="/studio/"' in html
    assert 'id="open-studio"' in html


def test_gpu_mode_exposes_classic_link():
    studio_hud = (ROOT / "studio" / "src" / "ui" / "Hud.js").read_text()
    assert "className: 'mode-switch'" in studio_hud
    assert "href: '/'" in studio_hud


def test_gpu_studio_build_contract():
    """A developer needs a clear error until npm run build creates assets."""
    with TestClient(app) as client:
        response = client.get("/studio/")
    if STUDIO_DIST.is_dir():
        assert response.status_code == 200
        assert 'id="viewport"' in response.text
    else:
        assert response.status_code == 503
        assert "not been built" in response.text
