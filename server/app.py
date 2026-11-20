"""Waterflow API, bounded terrain workloads and static single-page frontend."""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import terrain
from .tile_proxy import tile_proxy

logger = logging.getLogger("waterflow")
ROOT = Path(__file__).resolve().parent.parent
app = FastAPI(title="Waterflow Terrain Lab", version="0.3.0", docs_url=None, redoc_url=None)
app.add_middleware(GZipMiddleware, minimum_size=1024)


class CreateRequest(BaseModel):
    lat: float = Field(ge=-80, le=80)
    lon: float = Field(ge=-180, le=180)
    extent: int = Field(default=4000, ge=1000, le=12000)
    resolution: int = Field(default=160, ge=64, le=256)


class CellEdit(BaseModel):
    index: int = Field(ge=0)
    delta: float = Field(ge=-60, le=60)


class EditRequest(BaseModel):
    cells: list[CellEdit] = Field(min_length=1, max_length=12000)


@app.get("/api/tiles")
async def public_tile_proxy(u: str) -> Response:
    return await tile_proxy(u)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": "0.3.0"}


@app.post("/api/scenarios")
def new_scenario(body: CreateRequest) -> dict:
    if body.resolution not in (64, 96, 128, 160, 192, 256):
        raise HTTPException(422, "Resolution must be one of 64, 96, 128, 160, 192 or 256")
    try:
        scenario = terrain.create_scenario(body.lat, body.lon, body.extent, body.resolution)
    except Exception as exc:
        logger.exception("DEM retrieval failed for lat=%s lon=%s", body.lat, body.lon)
        raise HTTPException(502, "Elevation source unavailable. Try a smaller area or retry later.") from exc
    heights = scenario.base.ravel().round(2).tolist()
    return {
        "id": scenario.id, "bounds": scenario.bounds, "width": scenario.size,
        "height": scenario.size, "extent": scenario.extent, "zoom": scenario.zoom,
        "cellSize": scenario.extent / scenario.size, "elevation": heights,
        "min": float(scenario.base.min()), "max": float(scenario.base.max()),
        "dataSource": "Mapzen Terrain Tiles on AWS (Terrarium)",
    }


@app.post("/api/scenarios/{scenario_id}/edit")
def edit_scenario(scenario_id: str, body: EditRequest) -> dict[str, int]:
    scenario = terrain.get_scenario(scenario_id)
    if scenario is None:
        raise HTTPException(404, "Scenario expired; reload terrain")
    with terrain.lock:
        for cell in body.cells:
            if cell.index >= scenario.size * scenario.size:
                raise HTTPException(422, "Cell index outside scenario")
        for cell in body.cells:
            scenario.delta.flat[cell.index] = cell.delta
        scenario.revision += 1
        revision = scenario.revision
    return {"revision": revision}


@app.get("/api/scenarios/{scenario_id}/dem/{z}/{x}/{y}.png")
def dem_tile(scenario_id: str, z: int, x: int, y: int) -> Response:
    scenario = terrain.get_scenario(scenario_id)
    if scenario is None:
        raise HTTPException(404, "Scenario expired")
    try:
        if not 0 <= z <= 15 or not 0 <= x < 2**z or not 0 <= y < 2**z:
            raise HTTPException(400, "Invalid tile coordinate")
        content = terrain.edited_tile(scenario, z, x, y)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Elevation tile failed: %s", exc)
        raise HTTPException(502, "Elevation tile unavailable") from exc
    return Response(content, media_type="image/png", headers={"Cache-Control": "no-store"})


# Both simulation engines are hosted on one origin. Advanced Studio is built
# from studio/ by the Docker multi-stage builder; in local development run
# "npm --prefix studio run build" before starting uvicorn.
STUDIO_DIST = ROOT / "studio" / "dist"
if STUDIO_DIST.is_dir():
    app.mount("/studio", StaticFiles(directory=STUDIO_DIST, html=True), name="studio")
else:
    @app.get("/studio/")
    def studio_not_built() -> JSONResponse:
        return JSONResponse({"error": "Advanced Studio assets not built. Run npm --prefix studio ci && npm --prefix studio run build."}, status_code=503)

@app.get("/studio")
def studio_redirect() -> RedirectResponse:
    return RedirectResponse("/studio/", status_code=307)

app.mount("/static", StaticFiles(directory=ROOT / "web"), name="web")


@app.get("/")
def home() -> FileResponse:
    return FileResponse(ROOT / "web" / "index.html")


@app.exception_handler(HTTPException)
async def api_error(request, exc: HTTPException):
    if request.url.path.startswith("/api/"):
        return JSONResponse({"error": str(exc.detail)}, status_code=exc.status_code)
    return JSONResponse({"detail": str(exc.detail)}, status_code=exc.status_code)
