/* Passive surface marker transport. Not a navigability or safety model.
 * Flow velocities are inferred from the solver's depth-integrated face flux.
 * Units: tracer x/y are grid-cell coordinates; q is m²/s; h is meters.
 */
(function (root) {
  'use strict';
  const WET_THRESHOLD = 0.1;
  const MAX_SPEED = 20; // Prevents numerical spikes in shallow, uncalibrated cells.

  function indexAt(x, y, width, height) {
    if (!Number.isFinite(x) || !Number.isFinite(y) ||
        x < 0 || y < 0 || x >= width || y >= height) return -1;
    return Math.floor(y) * width + Math.floor(x);
  }

  function sample(x, y, depth, east, south, width, height) {
    const center = indexAt(x, y, width, height);
    if (center < 0) return {status:'exited', u:0, v:0, depth:0, speed:0};
    const localDepth = depth[center];
    if (!Number.isFinite(localDepth) || localDepth < WET_THRESHOLD) {
      return {status:'stranded', u:0, v:0, depth:Math.max(0, localDepth || 0), speed:0};
    }
    // Bilinear interpolation of cell-center velocities. Dry neighbors have
    // zero speed; this tapers motion near the flood front and channel edges.
    const fx = x - 0.5, fy = y - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    let u = 0, v = 0;
    for (let iy = 0; iy <= 1; iy++) for (let ix = 0; ix <= 1; ix++) {
      const cx = x0 + ix, cy = y0 + iy;
      if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
      const i = cy * width + cx, h = depth[i];
      if (h < WET_THRESHOLD) continue;
      const weight = (ix ? tx : 1 - tx) * (iy ? ty : 1 - ty);
      // q on east/south faces is signed, positive toward east/south.
      const qEast = cx < width - 1 ? east[i] : 0;
      const qWest = cx > 0 ? east[i - 1] : 0;
      const qSouth = cy < height - 1 ? south[i] : 0;
      const qNorth = cy > 0 ? south[i - width] : 0;
      u += weight * (qWest + qEast) / (2 * h);
      v += weight * (qNorth + qSouth) / (2 * h);
    }
    if (!Number.isFinite(u) || !Number.isFinite(v)) return {status:'stranded',u:0,v:0,depth:localDepth,speed:0};
    const rawSpeed = Math.hypot(u, v);
    if (rawSpeed > MAX_SPEED) { u *= MAX_SPEED / rawSpeed; v *= MAX_SPEED / rawSpeed; }
    return {status:'floating',u,v,depth:localDepth,speed:Math.hypot(u,v)};
  }

  function advect(tracer, dt, depth, east, south, width, height, cellSize) {
    if (!tracer || tracer.status === 'exited') return tracer;
    if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(cellSize) || cellSize <= 0) return tracer;
    const initial = sample(tracer.x,tracer.y,depth,east,south,width,height);
    if (initial.status !== 'floating') {
      tracer.status = initial.status;
      tracer.speed = 0;
      tracer.depth = initial.depth;
      return tracer;
    }
    // Sub-stepping prevents jumps over an entire cell during strong discharge.
    const steps = Math.min(100,Math.max(1,Math.ceil(initial.speed * dt / (cellSize * 0.35))));
    const subdt = dt / steps;
    let moved = 0;
    for(let k=0;k<steps;k++){
      const flow = sample(tracer.x,tracer.y,depth,east,south,width,height);
      if(flow.status !== 'floating'){
        tracer.status=flow.status;tracer.speed=0;tracer.depth=flow.depth;return tracer;
      }
      const nx=tracer.x+flow.u*subdt/cellSize, ny=tracer.y+flow.v*subdt/cellSize;
      if(indexAt(nx,ny,width,height)<0){
        tracer.status='exited';tracer.speed=0;return tracer;
      }
      const next = sample(nx,ny,depth,east,south,width,height);
      if(next.status !== 'floating') {
        tracer.status='stranded';tracer.speed=0;tracer.depth=flow.depth;return tracer;
      }
      moved+=Math.hypot(nx-tracer.x,ny-tracer.y)*cellSize;
      tracer.x=nx;tracer.y=ny;
      if(flow.speed>0.04)tracer.heading=(Math.atan2(flow.u,-flow.v)*180/Math.PI+360)%360;
      tracer.speed=flow.speed;
      tracer.depth=next.depth;
      tracer.status='floating';
    }
    tracer.distance+=moved;
    return tracer;
  }

  const api={indexAt,sample,advect,WET_THRESHOLD};
  if(typeof module==='object' && module.exports)module.exports=api;
  else root.FlowTracer=api;
})(typeof self === 'object' ? self : globalThis);
