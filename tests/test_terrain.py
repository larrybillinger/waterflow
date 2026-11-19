import io

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from server import terrain
from server.app import app


def test_terrarium_round_trip():
    original = np.array([[-100.5, 0, 1024.125, 4001.75]], dtype=float)
    rgb = terrain.encode_terrarium(original)
    np.testing.assert_allclose(terrain.decode_terrarium(rgb), original, atol=1 / 256)


def test_sampled_domain_dimensions():
    bounds = terrain.bounds_for(39.0, -97.0, 4000)
    assert len(bounds) == 4 and bounds[0] < bounds[2] and bounds[1] < bounds[3]
    assert 9 <= terrain.dem_zoom(39.0, 4000, 160) <= 14


def test_api_scenario_and_edits(monkeypatch):
    monkeypatch.setattr(terrain, "sample_dem", lambda bounds, size, zoom: np.full((size, size), 400, dtype=np.float32))
    with TestClient(app) as client:
        result = client.post("/api/scenarios", json={"lat": 39, "lon": -97, "extent": 1000, "resolution": 64})
        assert result.status_code == 200
        body = result.json()
        assert len(body["elevation"]) == 64 * 64
        scenario_id = body["id"]
        result = client.post(f"/api/scenarios/{scenario_id}/edit", json={"cells": [{"index": 17, "delta": -5.5}]})
        assert result.status_code == 200
        assert terrain.get_scenario(scenario_id).elevation.flat[17] == 394.5
        bad = client.post(f"/api/scenarios/{scenario_id}/edit", json={"cells": [{"index": 4096, "delta": 1}]})
        assert bad.status_code == 422


def test_upstream_failure_never_generates_fake_dem(monkeypatch):
    def error(*args):
        raise RuntimeError("offline")
    monkeypatch.setattr(terrain, "sample_dem", error)
    with TestClient(app) as client:
        result = client.post("/api/scenarios", json={"lat": 39, "lon": -97})
        assert result.status_code == 502
        assert "unavailable" in result.json()["error"].lower()


def test_tile_encoding_is_png(monkeypatch):
    rgb = terrain.encode_terrarium(np.full((256, 256), 500.0))
    buf = io.BytesIO()
    Image.fromarray(rgb, mode="RGB").save(buf, format="PNG")
    monkeypatch.setattr(terrain, "get_tile", lambda z, x, y: buf.getvalue())
    monkeypatch.setattr(terrain, "get_rgb", lambda z, x, y: rgb)
    scenario = terrain.Scenario(39, -97, 4000, 64, terrain.bounds_for(39, -97, 4000), 13,
                                np.full((64, 64), 500, dtype=np.float32))
    scenario.delta[:] = -2
    edited = terrain.edited_tile(scenario, 13, 1888, 3129)
    assert edited.startswith(b"\x89PNG")
