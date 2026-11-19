"""Public Terrarium DEM retrieval and scenario-local edited terrain tiles.

This module always uses a fixed provider URL. It never accepts a remote URL
from a request. DEM failures abort rather than substituting generated terrain.
"""
from __future__ import annotations

import io
import math
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from functools import lru_cache
from threading import RLock
from uuid import uuid4

import numpy as np
from PIL import Image

PROVIDER = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium"
MAX_SESSIONS = 12
SESSION_TTL = 3600
lock = RLock()
scenarios: dict[str, "Scenario"] = {}


def bounds_for(lat: float, lon: float, extent: int) -> list[float]:
    """West, south, east, north in WGS84; local tangent-plane approximation."""
    lat_half = (extent / 2) / 111_320.0
    lon_half = (extent / 2) / (111_320.0 * math.cos(math.radians(lat)))
    return [lon - lon_half, lat - lat_half, lon + lon_half, lat + lat_half]


def dem_zoom(lat: float, extent: int, resolution: int) -> int:
    cell_width = extent / resolution
    meters_per_pixel = 156543.03392 * math.cos(math.radians(lat))
    return max(9, min(14, math.ceil(math.log2(meters_per_pixel / cell_width))))


def decode_terrarium(rgb: np.ndarray) -> np.ndarray:
    r, g, b = [rgb[..., i].astype(np.float64) for i in range(3)]
    return r * 256.0 + g + b / 256.0 - 32768.0


def encode_terrarium(heights: np.ndarray) -> np.ndarray:
    units = np.clip(np.rint((heights.astype(np.float64) + 32768) * 256), 0, 16777215).astype(np.uint32)
    return np.stack(((units >> 16) & 255, (units >> 8) & 255, units & 255), axis=-1).astype(np.uint8)


def mercator_tile_x(lon: np.ndarray | float, zoom: int) -> np.ndarray:
    return (np.asarray(lon) + 180.0) / 360.0 * (2**zoom)


def mercator_tile_y(lat: np.ndarray | float, zoom: int) -> np.ndarray:
    rad = np.radians(np.clip(lat, -85.0, 85.0))
    return (1 - np.arcsinh(np.tan(rad)) / np.pi) * 0.5 * (2**zoom)


@lru_cache(maxsize=256)
def get_tile(zoom: int, x: int, y: int) -> bytes:
    if not 0 <= zoom <= 15 or not 0 <= x < 2**zoom or not 0 <= y < 2**zoom:
        raise ValueError("Invalid DEM tile")
    request = urllib.request.Request(
        f"{PROVIDER}/{zoom}/{x}/{y}.png",
        headers={"User-Agent": "Waterflow-Prototype/0.1 (public DEM research)"},
    )
    with urllib.request.urlopen(request, timeout=12) as response:
        data = response.read(1_500_001)
    if len(data) > 1_500_000:
        raise ValueError("Terrain tile exceeds configured size")
    return data


def get_rgb(zoom: int, x: int, y: int) -> np.ndarray:
    with Image.open(io.BytesIO(get_tile(zoom, x, y))) as image:
        if image.size != (256, 256):
            raise ValueError("Unexpected tile dimensions")
        return np.asarray(image.convert("RGB"))


def sample_dem(bounds: list[float], size: int, zoom: int) -> np.ndarray:
    west, south, east, north = bounds
    lons = west + (np.arange(size) + 0.5) * (east - west) / size
    lats = north - (np.arange(size) + 0.5) * (north - south) / size
    mx = mercator_tile_x(lons, zoom)
    my = mercator_tile_y(lats, zoom)
    grid_x, grid_y = np.meshgrid(mx, my)
    tile_x = np.floor(grid_x).astype(int)
    tile_y = np.floor(grid_y).astype(int)
    output = np.zeros((size, size), dtype=np.float32)
    for x, y in set(zip(tile_x.ravel(), tile_y.ravel())):
        mask = (tile_x == x) & (tile_y == y)
        px = np.minimum(255, np.maximum(0, ((grid_x[mask] - x) * 256).astype(int)))
        py = np.minimum(255, np.maximum(0, ((grid_y[mask] - y) * 256).astype(int)))
        output[mask] = decode_terrarium(get_rgb(zoom, int(x), int(y))[py, px]).astype(np.float32)
    if not np.isfinite(output).all():
        raise ValueError("DEM contains invalid elevations")
    return output


@dataclass
class Scenario:
    lat: float
    lon: float
    extent: int
    size: int
    bounds: list[float]
    zoom: int
    base: np.ndarray
    id: str = field(default_factory=lambda: uuid4().hex)
    delta: np.ndarray = field(init=False)
    revision: int = 0
    last_access: float = field(default_factory=time.monotonic)

    def __post_init__(self) -> None:
        self.delta = np.zeros_like(self.base)

    @property
    def elevation(self) -> np.ndarray:
        return self.base + self.delta


def create_scenario(lat: float, lon: float, extent: int, size: int) -> Scenario:
    b = bounds_for(lat, lon, extent)
    z = dem_zoom(lat, extent, size)
    heights = sample_dem(b, size, z)
    scenario = Scenario(lat=lat, lon=lon, extent=extent, size=size, bounds=b, zoom=z, base=heights)
    with lock:
        now = time.monotonic()
        for key, value in list(scenarios.items()):
            if now - value.last_access > SESSION_TTL:
                del scenarios[key]
        if len(scenarios) >= MAX_SESSIONS:
            del scenarios[min(scenarios, key=lambda key: scenarios[key].last_access)]
        scenarios[scenario.id] = scenario
    return scenario


def get_scenario(scenario_id: str) -> Scenario | None:
    with lock:
        scenario = scenarios.get(scenario_id)
        if scenario and time.monotonic() - scenario.last_access <= SESSION_TTL:
            scenario.last_access = time.monotonic()
            return scenario
        scenarios.pop(scenario_id, None)
    return None


def edited_tile(scenario: Scenario, z: int, x: int, y: int) -> bytes:
    source = get_tile(z, x, y)
    with lock:
        delta = scenario.delta.copy()
        bounds = scenario.bounds
    if not np.any(delta):
        return source

    n = 2**z
    # Match pixel centers to the same WGS84 location used by MapLibre DEM tiles.
    xcoords = x + (np.arange(256) + 0.5) / 256.0
    ycoords = y + (np.arange(256) + 0.5) / 256.0
    lons = (xcoords / n * 360.0) - 180.0
    lats = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * ycoords / n))))
    west, south, east, north = bounds
    valid_x = (lons >= west) & (lons < east)
    valid_y = (lats >= south) & (lats < north)
    if not np.any(valid_x) or not np.any(valid_y):
        return source
    ix = np.clip(((lons - west) / (east - west) * scenario.size).astype(int), 0, scenario.size - 1)
    iy = np.clip(((north - lats) / (north - south) * scenario.size).astype(int), 0, scenario.size - 1)
    adjustment = delta[iy[:, None], ix[None, :]]
    adjustment *= valid_y[:, None] & valid_x[None, :]
    if not np.any(adjustment):
        return source

    rgb = get_rgb(z, x, y)
    height = decode_terrarium(rgb) + adjustment
    edited = encode_terrarium(height)
    image = Image.fromarray(edited, mode="RGB")
    data = io.BytesIO()
    image.save(data, format="PNG", optimize=False)
    return data.getvalue()
