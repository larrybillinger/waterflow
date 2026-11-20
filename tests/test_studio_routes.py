"""Check integration link contracts when the GPU bundle is built or absent."""
from fastapi.testclient import TestClient
from server.app import ROOT, STUDIO_DIST, app


def test_classic_launcher_and_studio_return():
    classic = (ROOT / "web" / "index.html").read_text()
    studio = (ROOT / "studio" / "index.html").read_text()
    assert 'id="advanced-launch"' in classic
    assert 'id="classic-return"' in studio


def test_studio_route_is_explicit_about_build_artifacts():
    with TestClient(app) as client:
        response = client.get("/studio/")
    if STUDIO_DIST.is_dir():
        assert response.status_code == 200
        assert 'id="viewport"' in response.text
    else:
        assert response.status_code == 503
        assert "not built" in response.text.lower()
