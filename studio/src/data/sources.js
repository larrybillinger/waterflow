/**
 * Every external data endpoint in one file.
 *
 * Risk R-003 is that a public endpoint changes or disappears. Keeping all of them here
 * means that is a one-line fix rather than a hunt. None of these require an API key,
 * an account, or a payment. That is requirement N-01.
 */

import { tileProxy } from '../config.js';

/**
 * Elevation. Terrarium-encoded PNG terrain tiles from the AWS Open Data programme,
 * originally the Mapzen / Tilezen terrain tile service.
 *
 * Encoding, from the Tilezen specification: values are positive with a 32768 offset,
 * split across the red, green and blue channels, 16 bits of integer and 8 bits of
 * fraction, in Web Mercator (EPSG:3857). Decoded in src/data/terrarium.js.
 *
 * Underlying data is a composite. In the United States it is largely USGS 3DEP at
 * 1/3 arc-second, roughly 10 m. Elsewhere it is mostly SRTM at 1 to 3 arc-seconds, plus
 * national datasets where available and ETOPO1 and bathymetry offshore. That composite
 * is why the app reports the tile zoom and cell size rather than claiming a resolution.
 */
export const ELEVATION = {
  terrarium: {
    id: 'terrarium',
    label: 'AWS Terrain Tiles (Terrarium)',
    url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    tileSize: 256,
    minZoom: 0,
    maxZoom: 15,
    encoding: 'terrarium',
    attribution:
      'Elevation: AWS Terrain Tiles (Mapzen / Tilezen), derived from USGS 3DEP, SRTM, ' +
      'GMTED2010 and national datasets. Public domain / open data.',
  },
};

/**
 * Imagery to drape over the terrain. Ordered by preference. If one fails the loader
 * tries the next, and if all fail the terrain renders with hillshade and hypsometric
 * colour instead, which is requirement AC-03.
 *
 * Note the differing y-axis convention: ArcGIS MapServer tile URLs are {z}/{y}/{x},
 * while XYZ services are {z}/{x}/{y}. The scheme field records which.
 */
export const IMAGERY = {
  usgsImagery: {
    id: 'usgsImagery',
    label: 'USGS Imagery',
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
    tileSize: 256,
    maxZoom: 16,
    attribution: 'Imagery: USGS National Map, public domain.',
  },
  usgsTopo: {
    id: 'usgsTopo',
    label: 'USGS Topographic',
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
    tileSize: 256,
    maxZoom: 16,
    attribution: 'Topographic basemap: USGS National Map, public domain.',
  },
  esriImagery: {
    id: 'esriImagery',
    label: 'Esri World Imagery',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    tileSize: 256,
    maxZoom: 17,
    attribution: 'Imagery: Esri World Imagery and its contributors.',
  },
  osm: {
    id: 'osm',
    label: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    tileSize: 256,
    maxZoom: 17,
    attribution: 'Map data: OpenStreetMap contributors, ODbL.',
  },
  none: {
    id: 'none',
    label: 'None (hillshade only)',
    url: null,
    tileSize: 256,
    maxZoom: 0,
    attribution: 'Relief shading computed from the elevation grid.',
  },
};

/** Order the imagery loader falls back through when a source fails. */
export const IMAGERY_FALLBACK_ORDER = ['usgsImagery', 'esriImagery', 'osm', 'usgsTopo', 'none'];

/**
 * Fill a {z}/{x}/{y} URL template.
 *
 * ArcGIS MapServer templates put y before x, which the template itself encodes, so
 * substitution by name is correct for both conventions.
 *
 * @param {string} template URL with {z}, {x} and {y} placeholders
 * @param {number} z zoom level
 * @param {number} x tile column
 * @param {number} y tile row
 * @returns {string} the resolved URL, routed through the proxy when one is configured
 */
export function tileUrl(template, z, x, y) {
  const direct = template
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));

  if (!tileProxy) return direct;
  return `${tileProxy}?u=${encodeURIComponent(direct)}`;
}

/**
 * A small catalogue of real reservoir sites, so the app opens on something interesting
 * and so a reviewer can reproduce a result without hunting for coordinates.
 *
 * These are starting viewpoints only. Dam heights and storage figures are deliberately
 * NOT included: the app derives volume and height from the elevation grid and the user's
 * own dam placement, and carrying a half-remembered published figure here would invite
 * someone to treat it as authoritative. See the Accuracy Honesty Rule.
 */
export const SITE_CATALOG = [
  {
    name: 'Tuttle Creek Lake, Kansas',
    lat: 39.2447,
    lon: -96.5944,
    domainMeters: 26000,
    note: 'Big Blue River valley above Manhattan. Broad floodplain downstream.',
  },
  {
    name: 'Kanopolis Lake, Kansas',
    lat: 38.6208,
    lon: -97.9711,
    domainMeters: 22000,
    note: 'Smoky Hill River. Closest catalogued site to Salina.',
  },
  {
    name: 'Milford Lake, Kansas',
    lat: 39.0744,
    lon: -96.8958,
    domainMeters: 24000,
    note: 'Republican River above Junction City.',
  },
  {
    name: 'Glen Canyon, Arizona',
    lat: 36.9375,
    lon: -111.4836,
    domainMeters: 20000,
    note: 'Deep, narrow canyon. Good test of confined routing.',
  },
  {
    name: 'Hungry Horse, Montana',
    lat: 48.3419,
    lon: -114.0,
    domainMeters: 18000,
    note: 'Steep mountain valley, strong relief.',
  },
  {
    name: 'Oroville, California',
    lat: 39.5394,
    lon: -121.4858,
    domainMeters: 22000,
    note: 'Tall embankment dam in foothill terrain.',
  },
];

export default { ELEVATION, IMAGERY, IMAGERY_FALLBACK_ORDER, tileUrl, SITE_CATALOG };
