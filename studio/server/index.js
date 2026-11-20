/**
 * Optional static server and tile cache.
 *
 * Waterflow runs as a plain static site and does not need this. It exists for
 * self-hosted deployments, where it does two things:
 *
 *   1. Serves the built site from dist/.
 *   2. Proxies and disk-caches map tiles, which makes repeat visits fast and removes any
 *      dependence on a third party's CORS headers.
 *
 * Enable the proxy by setting VITE_TILE_PROXY=/api/tiles before building the client.
 *
 * The proxy only fetches hosts on an allowlist. That restriction is load-bearing: without
 * it this is an open proxy that will fetch whatever URL it is handed. If a new tile source
 * is added to src/data/sources.js, add its host here too rather than removing the check.
 * See docs/permissions.md.
 */

import express from 'express';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat, readdir, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const PORT = Number(process.env.APP_PORT ?? 8098);
const CACHE_DIR = resolve(root, process.env.TILE_CACHE_DIR ?? 'server/cache');
const CACHE_MAX_BYTES = Number(process.env.TILE_CACHE_MAX_MB ?? 2048) * 1024 * 1024;
const CACHE_TTL_MS = Number(process.env.TILE_CACHE_TTL_DAYS ?? 90) * 24 * 60 * 60 * 1000;

/** Hosts the proxy is permitted to fetch. Must match src/data/sources.js. */
const ALLOWED_HOSTS = new Set([
  's3.amazonaws.com',
  'basemap.nationalmap.gov',
  'services.arcgisonline.com',
  'tile.openstreetmap.org',
]);

const app = express();
app.disable('x-powered-by');

await mkdir(CACHE_DIR, { recursive: true });

/**
 * Cache path for a URL. Sharded by the first two hex characters so a single directory
 * never holds hundreds of thousands of files, which some filesystems handle badly.
 *
 * @param {string} url
 * @returns {{dir: string, file: string}}
 */
function cachePath(url) {
  const hash = createHash('sha256').update(url).digest('hex');
  const dir = join(CACHE_DIR, hash.slice(0, 2));
  return { dir, file: join(dir, hash) };
}

/**
 * Total bytes held in the cache, and the oldest entries first.
 *
 * @returns {Promise<{total: number, entries: Array<{path: string, size: number, atime: number}>}>}
 */
async function surveyCache() {
  const entries = [];
  let total = 0;

  for (const shard of await readdir(CACHE_DIR, { withFileTypes: true })) {
    if (!shard.isDirectory()) continue;
    const shardDir = join(CACHE_DIR, shard.name);

    for (const name of await readdir(shardDir)) {
      const path = join(shardDir, name);
      try {
        const info = await stat(path);
        entries.push({ path, size: info.size, atime: info.atimeMs });
        total += info.size;
      } catch {
        // Raced with an eviction. Nothing to do.
      }
    }
  }

  entries.sort((a, b) => a.atime - b.atime);
  return { total, entries };
}

/** Evict least-recently-used entries until the cache is back under its limit. */
async function evictIfNeeded() {
  const { total, entries } = await surveyCache();
  if (total <= CACHE_MAX_BYTES) return;

  let freed = 0;
  for (const entry of entries) {
    if (total - freed <= CACHE_MAX_BYTES * 0.9) break;
    try {
      await unlink(entry.path);
      freed += entry.size;
    } catch {
      // Already gone.
    }
  }

  console.info(`[waterflow] tile cache evicted ${(freed / 1024 / 1024).toFixed(1)} MB`);
}

let evictionTimer = null;
function scheduleEviction() {
  if (evictionTimer) return;
  evictionTimer = setTimeout(() => {
    evictionTimer = null;
    evictIfNeeded().catch((error) => {
      console.error('[waterflow] tile cache eviction failed:', error.message);
    });
  }, 30000);
  evictionTimer.unref?.();
}

app.get('/api/tiles', async (request, response) => {
  const target = request.query.u;

  if (typeof target !== 'string' || target.length === 0) {
    response.status(400).type('text/plain').send(
      'Missing the "u" query parameter. Expected /api/tiles?u=<encoded tile URL>.',
    );
    return;
  }

  let url;
  try {
    url = new URL(target);
  } catch {
    response.status(400).type('text/plain').send(`Not a valid URL: ${target}`);
    return;
  }

  if (url.protocol !== 'https:') {
    response.status(400).type('text/plain').send('Only https tile URLs are proxied.');
    return;
  }

  if (!ALLOWED_HOSTS.has(url.hostname)) {
    response
      .status(403)
      .type('text/plain')
      .send(
        `Host "${url.hostname}" is not on this proxy's allowlist. Add it to ALLOWED_HOSTS ` +
          'in server/index.js if it is a tile source this deployment should serve.',
      );
    return;
  }

  const { dir, file } = cachePath(url.href);

  try {
    const info = await stat(file);
    if (Date.now() - info.mtimeMs < CACHE_TTL_MS) {
      const body = await readFile(file);
      response.set('Content-Type', 'image/png');
      response.set('Cache-Control', 'public, max-age=86400');
      response.set('X-Waterflow-Cache', 'hit');
      response.send(body);
      return;
    }
  } catch {
    // Not cached, or unreadable. Fetch it.
  }

  try {
    const upstream = await fetch(url.href, {
      headers: {
        // Some tile services reject requests without one, and it is polite to say who
        // is asking.
        'User-Agent': 'Waterflow/0.1.0 (self-hosted flood simulator)',
        Accept: 'image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5',
      },
    });

    if (!upstream.ok) {
      response
        .status(upstream.status)
        .type('text/plain')
        .send(`Upstream tile request failed: ${upstream.status} for ${url.href}`);
      return;
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());

    await mkdir(dir, { recursive: true });
    await writeFile(file, buffer);
    scheduleEviction();

    response.set('Content-Type', upstream.headers.get('content-type') ?? 'image/png');
    response.set('Cache-Control', 'public, max-age=86400');
    response.set('X-Waterflow-Cache', 'miss');
    response.send(buffer);
  } catch (error) {
    console.error(`[waterflow] tile proxy failed for ${url.href}:`, error.message);
    response
      .status(502)
      .type('text/plain')
      .send(
        `Could not reach ${url.hostname}. The upstream tile service may be down or this ` +
          `server may have no outbound network access. Cause: ${error.message}`,
      );
  }
});

app.get('/healthz', (_request, response) => {
  response.json({ status: 'ok', version: '0.1.0' });
});

app.use(
  express.static(resolve(root, 'dist'), {
    maxAge: '1h',
    setHeaders(response, path) {
      // Hashed asset filenames can be cached hard; index.html must not be.
      if (path.endsWith('.html')) response.setHeader('Cache-Control', 'no-cache');
      else if (path.includes('/assets/')) {
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }),
);

app.use((_request, response) => {
  response.status(404).type('text/plain').send(
    'Not found. If this is a fresh deployment, run "npm run build" first so that dist/ exists.',
  );
});

app.listen(PORT, () => {
  console.info(`[waterflow] serving on http://0.0.0.0:${PORT}`);
  console.info(`[waterflow] tile cache at ${CACHE_DIR}, limit ${CACHE_MAX_BYTES / 1024 / 1024} MB`);
});
