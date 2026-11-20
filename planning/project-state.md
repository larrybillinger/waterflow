# Project State — 2026-11-19

Version v0.3.0 (experimental). Sprint 003 is active on feature/integrate-advanced-studio-v0.3.

The original Classic Terrain Lab v0.2 (MapLibre global 3D map, terrain editing, Worker point-release model and raft marker) remains at /. Claude's independent Three.js/WebGL2 GPU flood-simulator branch is integrated at /studio/ as Advanced Dam Studio. Its strengths include DEM-based reservoir construction, dam placement, progressive breach, detailed water shader, terrain undo, valley station routing and five camera modes. Geographic location passes between tools; numerical state does not.

Production Vite assets compile in Docker and are served through the same FastAPI process. Fixed-provider tile proxy, deliberate offline synthetic-demo choice and permanent DEM warning address data fidelity and CORS concerns. Studio license metadata is corrected to GPL-3.0.

Classic Python/Node tests and Studio test/lint/build are expected in CI. Integrated Docker routes, real DEM sources and live browser/WebGL scene have **not** yet been verified here; hydraulic measurements are not calibrated.
