# Data sources

Every source is public, keyless and free. That is requirement N-01, and it is why the app
works as a plain static site with no account behind it.

All endpoints live in one file, `src/data/sources.js`, so a URL change is a one-line fix.
See risk R-003.

## Elevation

**AWS Open Data Terrain Tiles**, Terrarium encoding.

```text
https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
```

Originally the Mapzen / Tilezen terrain tile service, now hosted under the AWS Open Data
programme as a static bucket with standard z/x/y URLs and no authentication.

### Encoding

From the Tilezen specification:

> Terrarium format PNG tiles contain raw elevation data in metres, in Web Mercator
> projection (EPSG:3857). All values are positive with a 32,768 offset, split into the
> red, green and blue channels, with 16 bits of integer and 8 bits of fraction.

```text
elevation = (red * 256 + green + blue / 256) - 32768
```

Red carries the 256s place, green the 1s, blue the fraction in steps of 1/256 m. The
offset is what allows values below sea level. Implemented in `src/data/terrarium.js` and
tested round-trip.

### What the data actually is

A composite, which is why the app reports the tile zoom and the cell size rather than
claiming a single resolution:

- United States: largely USGS 3DEP at 1/3 arc-second, roughly 10 m.
- Elsewhere: mostly SRTM at 1 to 3 arc-seconds, plus national datasets where available.
- Ocean and high latitudes: GMTED2010, ETOPO1 and bathymetry.

Effective horizontal resolution is therefore about 10 m in the United States and coarser
elsewhere. This is the single largest limitation on what Waterflow can resolve, recorded
as risk R-001.

### Choosing a zoom

`pickZoomForCellSize` picks the zoom whose ground resolution is about half the simulation
cell size, so several source pixels are averaged into each cell. Point sampling a DEM
while downsampling aliases ridge lines, and a ridge that lands a few metres wrong changes
which valley the water goes down.

Fetching much finer is waste: each extra zoom level quadruples the tile count.

## Imagery

Cosmetic only. Never affects a simulated number, so a failure here is not fatal: the
loader walks a fallback chain and, if everything fails, the terrain renders with hillshade
and hypsometric colouring instead.

| Source | Endpoint | Notes |
| --- | --- | --- |
| USGS Imagery | `basemap.nationalmap.gov/.../USGSImageryOnly/MapServer/tile/{z}/{y}/{x}` | Public domain. Best for the United States. Default. |
| USGS Topographic | `basemap.nationalmap.gov/.../USGSTopo/MapServer/tile/{z}/{y}/{x}` | Public domain. Useful for reading the landscape. |
| Esri World Imagery | `services.arcgisonline.com/.../World_Imagery/MapServer/tile/{z}/{y}/{x}` | Global. Attribution required. |
| OpenStreetMap | `tile.openstreetmap.org/{z}/{x}/{y}.png` | ODbL. Global. Use sparingly; it is a volunteer-funded service. |

Note the differing axis order: ArcGIS MapServer templates are `{z}/{y}/{x}` while XYZ
services are `{z}/{x}/{y}`. The template itself encodes which, so substitution by name is
correct for both.

Imagery is fetched at a higher zoom than the elevation, because the eye resolves texture
detail far finer than the simulation grid.

## Attribution

Shown in the app and reproduced here:

- **Elevation**: AWS Terrain Tiles (Mapzen / Tilezen), derived from USGS 3DEP, SRTM,
  GMTED2010 and national datasets. Public domain / open data.
- **Imagery**: USGS National Map, public domain; or Esri World Imagery and its
  contributors; or OpenStreetMap contributors, ODbL.

## Being a good citizen

These are free services run by other people. The app:

- Limits concurrent tile fetches to six.
- Caps the tiles any single load may request, and refuses a request above it with an
  explanation rather than hammering the endpoint.
- Picks the coarsest zoom that meets the grid resolution.
- Supports an optional server-side disk cache, so a self-hosted instance fetches each tile
  once rather than on every visit.

If you deploy this somewhere busy, turn the cache on.

## What is deliberately not used

**USGS 3DEP ImageServer**, which could return 10 m or in places 1 m lidar. It needs a
GeoTIFF or LERC decoder in the browser, covers the United States only, and is a slower and
heavier fetch. Deferred as open question Q-003 rather than half-built.

**The National Inventory of Dams.** The app derives dam height and reservoir volume from
the terrain and the user's own dam placement. Carrying published figures for real dams
would invite someone to treat the output as being about that specific dam, which it is
not. The site catalogue in `sources.js` holds viewpoints only, deliberately with no
engineering figures attached.

**OpenStreetMap buildings and roads.** Technically straightforward and would make the tool
far more useful and far more dangerous, because it would turn an estimate into an apparent
statement about named people's homes. Recorded as open question Q-006, not to be built
without a decision written down first.
