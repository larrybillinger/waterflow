import {describe,it,expect} from 'vitest';
import {initialLocation} from '../src/data/initialLocation.js';
const fallback={lat:39.2447,lon:-96.5944};

describe('engine location handoff',()=>{
  it('uses defaults without parameters',()=>expect(initialLocation('',fallback)).toEqual(fallback));
  it('accepts correctly signed Kansas coordinates',()=>expect(initialLocation('?lat=38.8403&lon=-97.6114',fallback)).toEqual({lat:38.8403,lon:-97.6114}));
  it('rejects a latitude outside loaded DEM bounds',()=>expect(initialLocation('?lat=91&lon=50',fallback)).toEqual(fallback));
  it('rejects invalid and partial coordinates',()=>{
    expect(initialLocation('?lat=nan&lon=-97',fallback)).toEqual(fallback);
    expect(initialLocation('?lat=40',fallback)).toEqual(fallback);
  });
  it('accepts 0,0',()=>expect(initialLocation('?lat=0&lon=0',fallback)).toEqual({lat:0,lon:0}));
});
