"""Strictly scoped proxy for public map tiles used by the Advanced Studio.

Never use a client-controlled arbitrary URL as an HTTP fetch destination.
Require both an exact HTTPS host and an exact supported tile path shape.
Only image responses are cached; no redirects, credentials or URL queries.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from collections import OrderedDict
from threading import RLock
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException, Query
from fastapi.responses import Response

logger = logging.getLogger("waterflow.tiles")
MAX_TILE_BYTES = 4 * 1024 * 1024
CACHE_LIMIT_BYTES = 64 * 1024 * 1024
CACHE_TTL_SECONDS = 3600
MAX_CONCURRENT_UPSTREAM = 8

# Exact routes only. Each pattern ends in z/y/x or z/x/y numeric tiles.
SOURCE_PATTERNS = {
    "s3.amazonaws.com": re.compile(r"^/elevation-tiles-prod/terrarium/(\d{1,2})/(\d+)/(\d+)\.png$"),
    "basemap.nationalmap.gov": re.compile(
        r"^/arcgis/rest/services/(?:USGSImageryOnly|USGSTopo)/MapServer/tile/(\d{1,2})/(\d+)/(\d+)$"
    ),
    "services.arcgisonline.com": re.compile(
        r"^/ArcGIS/rest/services/World_Imagery/MapServer/tile/(\d{1,2})/(\d+)/(\d+)$"
    ),
    "tile.openstreetmap.org": re.compile(r"^/(\d{1,2})/(\d+)/(\d+)\.png$"),
}
CacheEntry = tuple[float, bytes, str]
_cache: OrderedDict[str, CacheEntry] = OrderedDict()
_cache_bytes = 0
_lock = RLock()
_upstream_limit = asyncio.Semaphore(MAX_CONCURRENT_UPSTREAM)


def validate_tile_url(url: str) -> str:
    """Accept only the exact public imagery/DEM tile URLs in our source catalog."""
    if len(url) > 550:
        raise ValueError("Tile URL is too long")
    try:
        parsed = urlsplit(url)
        host = parsed.hostname
        port = parsed.port
    except ValueError as exc:
        raise ValueError("Invalid tile URL") from exc
    if (parsed.scheme != "https" or parsed.username or parsed.password or
            port is not None or not host or host not in SOURCE_PATTERNS or
            parsed.query or parsed.fragment):
        raise ValueError("Only approved HTTPS tile endpoints are permitted")
    if re.search(r"%(?:2e|2f|5c)", parsed.path, flags=re.I):
        raise ValueError("Encoded path traversal or separators are not allowed")
    match = SOURCE_PATTERNS[host].fullmatch(parsed.path)
    if match is None:
        raise ValueError("Unsupported tile endpoint path")
    zoom = int(match.group(1))
    if zoom < 0 or zoom > 18:
        raise ValueError("Tile zoom is out of range")
    # Clamp based on integer index range, regardless of x/y axis order.
    if any(int(raw) >= 2**zoom for raw in match.groups()[1:]):
        raise ValueError("Tile coordinate is out of range")
    return url


def _get_cached(url: str) -> tuple[bytes, str] | None:
    with _lock:
        cached = _cache.get(url)
        if cached is None:
            return None
        expiry, blob, content_type = cached
        if expiry <= time.monotonic():
            global _cache_bytes
            _cache.pop(url, None)
            _cache_bytes -= len(blob)
            return None
        _cache.move_to_end(url)
        return blob, content_type


def _store(url: str, blob: bytes, content_type: str) -> None:
    global _cache_bytes
    with _lock:
        if url in _cache:
            _, old, _ = _cache.pop(url)
            _cache_bytes -= len(old)
        _cache[url] = (time.monotonic() + CACHE_TTL_SECONDS, blob, content_type)
        _cache_bytes += len(blob)
        while _cache_bytes > CACHE_LIMIT_BYTES and _cache:
            _, (_, expired, _) = _cache.popitem(last=False)
            _cache_bytes -= len(expired)


async def tile_proxy(u: str = Query(min_length=1, max_length=550)) -> Response:
    """Fetch a fixed-provider public tile while bounding memory and concurrent load."""
    try:
        url = validate_tile_url(u)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    cached = _get_cached(url)
    if cached:
        blob, content_type = cached
        return Response(blob, media_type=content_type,
                        headers={"Cache-Control": "public, max-age=3600", "X-Waterflow-Cache": "hit"})

    try:
        async with _upstream_limit:
            async with httpx.AsyncClient(timeout=12, follow_redirects=False) as client:
                response = await client.get(
                    url, headers={"User-Agent": "Waterflow/0.3 (public map tile viewer)"}
                )
    except (httpx.HTTPError, TimeoutError) as exc:
        logger.warning("Upstream tile failed %s: %s", url, exc)
        raise HTTPException(status_code=502, detail="Public tile provider could not be reached") from exc

    if response.status_code != 200:
        logger.warning("Public tile responded %s: %s", response.status_code, url)
        raise HTTPException(status_code=502, detail="Public tile provider did not return an image")
    content_type = response.headers.get("content-type", "").split(";")[0].lower().strip()
    if content_type not in {"image/png", "image/jpeg", "image/webp", "image/jpg"}:
        raise HTTPException(status_code=502, detail="Upstream response was not an image tile")
    body = response.content
    if not body or len(body) > MAX_TILE_BYTES:
        raise HTTPException(status_code=502, detail="Upstream image tile had invalid size")
    _store(url, body, content_type)
    return Response(body, media_type=content_type,
                    headers={"Cache-Control": "public, max-age=3600", "X-Waterflow-Cache": "miss"})
