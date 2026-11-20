# Sprint 003 acceptance criteria

- [x] Provenance and comparative feature review documented.
- [x] Claude's GPU project imported without discarding Classic source, movie mode or API.
- [x] Classic shows a navigable Studio link and Studio includes a Classic return link.
- [x] Docker builds the Studio and makes its dist bundle available to FastAPI at /studio/.
- [x] Missing local Studio bundle returns an actionable error.
- [x] Studio's synthetic terrain fallback retains a persistent notice.
- [x] Separate Studio lint/unit/build and Classic tests are configured in CI.
- [ ] Live browser checks exercise all UI paths and real terrain providers under /studio/.
- [x] Docker smoke test in GitHub Actions successfully built and fetched Classic, Studio and the Studio JavaScript bundle.
- [ ] Identical-terrain numerical benchmark and observed-flood comparison completed.
- [ ] Cross-engine scenario compatibility defined (explicitly deferred beyond v0.3).

Completed boxes refer to source implementation and CI configuration; not a claimed browser-validated release.
