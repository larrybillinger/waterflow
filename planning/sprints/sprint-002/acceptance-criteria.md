# Sprint 002 acceptance criteria

- [ ] Entry to cinema hides conventional panels but retains fullscreen 3D terrain.
- [ ] Tagging dry or out-of-area water is rejected; a wet point is accepted.
- [ ] Marker moves according to water flux; flow tests show no NaN/teleporting.
- [ ] Raft/rider or dot can be switched without restarting the simulation.
- [ ] Status reflects floating, stranded and exited domain.
- [ ] Chase, aerial and wide views follow the marker; dragging gives free camera.
- [ ] Cinema slows simulated time; normal stepping returns after exit.
- [ ] Recorded path can be replayed and scrubbed independently of last flood shading.
- [ ] Path CSV includes sim time, location, depth, speed, travel distance and status.
- [ ] Changing source/terrain or resetting water removes old route.
- [ ] JS, worker, tracer tests and Python API tests pass in CI.
- [ ] Browser/WebGL and live DEM provider checks are completed before production release.
