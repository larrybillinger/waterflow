# Sprint 003 blueprint

1. Compare main and claude/flood-simulator at their known head commits; document feature and numerical differences.
2. Import Claude's complete Git tree under studio/ preserving its shader/document/test graph and source provenance.
3. Multi-stage Node 22 studio build emits studio/dist. Python Docker copies generated bundle; FastAPI conditionally mounts /studio with html index fallback. Missing local bundle produces a helpful 503 rather than a 404.
4. Expose a prominent GPU Studio link in Classic; add a Classic return link within Studio's brand component. Keep controls accessible with keyboard and compact at mobile sizes.
5. Keep Classic backend, MapLibre app, and movie mode untouched beyond UI navigation.
6. Label synthetic DEM fallback throughout Studio rather than only during a transient toast.
7. GitHub CI runs Classic tests and Studio npm lint/test/build on PRs. Document remaining browser, numerical and provider checks before any operational claim.
