'use strict';
const assert = require('node:assert/strict');
const tracer = require('../web/flow-tracker.js');
const film = require('../web/movie.js');

const w=10,h=10,n=w*h,dx=20;
const wet=new Float32Array(n).fill(2);
const east=new Float64Array(n).fill(4); // q=4 m²/s at h=2 m -> about 2 m/s east.
const south=new Float64Array(n);
const p={x:3.5,y:4.5,distance:0,depth:2,speed:0,heading:0,status:'floating'};
const first=tracer.sample(p.x,p.y,wet,east,south,w,h);
assert.equal(first.status,'floating');
assert(Math.abs(first.u-2)<1e-6);
assert.equal(first.v,0);
tracer.advect(p,2,wet,east,south,w,h,dx);
assert.equal(p.status,'floating');
assert(p.x>3.5 && p.x<4,'tag moves east according to face flux');
assert(Math.abs(p.heading-90)<1e-6,'east-bound heading points 90°');
assert(p.distance>3 && p.distance<5,'distance is approximately 4m');
assert.equal(p.y,4.5);

const shallow=wet.slice();
shallow[4*w+4]=0;
const edge={x:4.5,y:4.5,distance:0,depth:0,speed:0,heading:0,status:'floating'};
tracer.advect(edge,1,shallow,east,south,w,h,dx);
assert.equal(edge.status,'stranded','dry cell cannot transport raft');
assert.equal(edge.x,4.5,'stranded position does not move');

assert.equal(tracer.indexAt(-0.1,1,w,h),-1);
assert.equal(tracer.indexAt(10,1,w,h),-1);
assert.equal(tracer.indexAt(NaN,1,w,h),-1);
const exiting={x:9.9,y:5.5,distance:0,depth:2,speed:0,heading:90,status:'floating'};
tracer.advect(exiting,10,wet,east,south,w,h,dx);
assert.equal(exiting.status,'exited','tracks stop at grid boundary');

const a={x:0,y:2,heading:350,time:10,speed:1,depth:1,distance:4,status:'floating'};
const b={x:10,y:4,heading:10,time:20,speed:3,depth:2,distance:14,status:'floating'};
const midpoint=film.interpolate(a,b,0.5);
assert.equal(midpoint.x,5);
assert.equal(midpoint.time,15);
assert.equal(midpoint.distance,9);
assert(Math.abs(midpoint.heading)<1e-9 || Math.abs(midpoint.heading-360)<1e-9,
  'headings interpolate across north without 180° spin');
assert.equal(midpoint.depth,1.5);
const scenario={bounds:[-97.5,38.0,-97.0,38.5],width:100,height:100};
assert.deepEqual(film.locationOf({x:50,y:50},scenario),[-97.25,38.25]);
console.log('Flow-tracker transport, boundary and movie interpolation tests passed');
