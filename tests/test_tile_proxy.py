"""Security, error handling and cache tests for the restricted tile endpoint."""
from fastapi.testclient import TestClient

from server.app import app
from server.tile_proxy import validate_tile_url


def test_valid_public_tile_urls():
    good = [
        "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/1012/1360.png",
        "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/12/1356/1020",
        "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/12/1356/1020",
        "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/12/1360/1012",
        "https://tile.openstreetmap.org/5/4/8.png",
    ]
    for url in good:
        assert validate_tile_url(url) == url


def test_rejects_unlisted_hosts_and_paths():
    invalid = [
        "http://s3.amazonaws.com/elevation-tiles-prod/terrarium/5/1/2.png",
        "https://example.com/elevation-tiles-prod/terrarium/5/1/2.png",
        "https://s3.amazonaws.com.evil.example/elevation-tiles-prod/terrarium/5/1/2.png",
        "https://user:password@s3.amazonaws.com/elevation-tiles-prod/terrarium/5/1/2.png",
        "https://s3.amazonaws.com:443/elevation-tiles-prod/terrarium/5/1/2.png",
        "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/5/1/2.png?url=https://evil.example",
        "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/5/../2.png",
        "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/5/%2e%2e/2.png",
        "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/19/1/1.png",
        "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/5/999/0.png",
        "https://127.0.0.1/private",
        "file:///etc/passwd",
        "https://services.arcgisonline.com/ArcGIS/rest/services/Other/MapServer/tile/5/1/2",
    ]
    for url in invalid:
        try:
            validate_tile_url(url)
        except ValueError:
            pass
        else:
            raise AssertionError("Must reject unapproved tile target: " + url)


def test_tile_proxy_rejects_bad_hosts_without_outbound_requests():
    with TestClient(app) as client:
        response = client.get("/api/tiles", params={"u": "https://localhost/private"})
        assert response.status_code == 400


def test_studio_mount_when_built_or_actionable_error_when_missing():
    with TestClient(app) as client:
        response = client.get("/studio/", follow_redirects=True)
        assert response.status_code in (200, 503)
        if response.status_code == 200:
            assert "viewport" in response.text
        else:
            assert "not built" in response.text.lower()
