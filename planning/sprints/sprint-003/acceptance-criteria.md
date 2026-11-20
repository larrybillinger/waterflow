# Sprint 003 acceptance criteria

- [ ] Classic MapLibre site keeps globe, release-point model, edits, stations and cinematic raft.
- [ ] Studio route builds and displays dam, reservoir, breach, advanced terrain and water, station analysis, 3D rafting.
- [ ] Both routes served on one origin in Docker.
- [ ] Geographic centre handoff works in both directions.
- [ ] No hydraulic or terrain-edit state is silently shared.
- [ ] Real elevation failure stops normal Studio rather than displaying fictional terrain.
- [ ] Only ?demo=1 permits generated terrain and permanently labels it.
- [ ] Tile proxy refuses non-allowlisted hosts, paths, coordinates, credentials and redirects.
- [ ] Studio package metadata matches GPL-3.0 LICENSE.
- [ ] Classic Python and JS tests, Studio lint/tests/build pass in CI.
- [ ] Live 3D browser, real provider and Docker tests are completed before a production claim.

- [x] Automated Docker HTTP smoke test verifies both frontends, a bundled Studio JS asset and rejection of an unapproved tile proxy request (v0.3.1).
