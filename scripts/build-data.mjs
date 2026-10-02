#!/usr/bin/env node
// Data pipeline: scrape the Lolo NF travel-management page, download every
// MVUM/OSVUM GeoPDF, tile each one to PMTiles with GDAL, and snapshot the USFS
// MVUM roads/trails API so the app works fully offline.
//
// Usage: node scripts/build-data.mjs [--skip-tiles] [--force] [--dpi=250]
// Requires: gdalinfo, gdalwarp, gdal_translate, gdaladdo, ogr2ogr, pmtiles

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchLayer, fetchWithRetry, MVUM_SERVICE, FOREST_WHERE } from '../src/lib/usfs.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'data/cache');
const PUBLIC_DATA = join(ROOT, 'public/data');
const PUBLIC_MAPS = join(ROOT, 'public/maps');

const PAGE_URL = 'https://www.fs.usda.gov/r01/lolo/maps-guides/travel-management-maps';
const SITE = 'https://www.fs.usda.gov';

const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const SKIP_TILES = args.has('--skip-tiles');
const DPI = Number([...args].find((a) => a.startsWith('--dpi='))?.split('=')[1] ?? 250);

for (const d of [CACHE, join(CACHE, 'pdf'), join(CACHE, 'api'), join(CACHE, 'work'), PUBLIC_DATA, PUBLIC_MAPS]) {
  mkdirSync(d, { recursive: true });
}

const log = (...m) => console.log('[build-data]', ...m);
const run = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 28, ...opts }).toString();

async function fetchOk(url, init) {
  const res = await fetchWithRetry(url, { headers: { 'User-Agent': 'mvum-pwa-build/1.0' }, redirect: 'follow', ...init });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}

const slugify = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// --- 1. Discover maps from the travel-management page -----------------------
async function discoverMaps() {
  const html = await (await fetchOk(PAGE_URL)).text();
  writeFileSync(join(CACHE, 'page.html'), html);
  const maps = [];
  const seen = new Set();
  for (const m of html.matchAll(/<a href="(\/media\/(\d+))">([^<]+)<\/a>/g)) {
    const [, path, mediaId, rawTitle] = m;
    if (seen.has(mediaId)) continue;
    seen.add(mediaId);
    const title = rawTitle.replace(/&amp;/g, '&').trim();
    const kind = /OSVUM/i.test(title) ? 'osvum' : 'mvum';
    maps.push({ id: `${kind}-${slugify(title.replace(/\b(MVUM|OSVUM)\b/gi, ''))}`, title, kind, mediaId, source: SITE + path });
  }
  if (!maps.length) throw new Error('No map links found; page layout may have changed.');
  log(`found ${maps.length} maps`);
  return maps;
}

// --- 2. Download PDFs --------------------------------------------------------
async function downloadPdf(map) {
  const file = join(CACHE, 'pdf', `${map.id}.pdf`);
  if (FORCE || !existsSync(file)) {
    log(`download ${map.title}`);
    const buf = Buffer.from(await (await fetchOk(map.source)).arrayBuffer());
    if (buf.subarray(0, 4).toString() !== '%PDF') throw new Error(`${map.source} is not a PDF`);
    writeFileSync(file, buf);
  }
  copyFileSync(file, join(PUBLIC_MAPS, `${map.id}.pdf`));
  return file;
}

// --- 3. GeoPDF -> footprint + PMTiles ---------------------------------------
function tileMap(map, pdf) {
  const work = join(CACHE, 'work', map.id);
  mkdirSync(work, { recursive: true });
  const out = join(PUBLIC_MAPS, `${map.id}.pmtiles`);
  const footprintFile = join(work, 'footprint.geojson');

  const info = JSON.parse(run('gdalinfo', ['-json', pdf]));
  const neatline = info.metadata?.['']?.NEATLINE;
  const srsWkt = info.coordinateSystem?.wkt;
  if (!srsWkt) throw new Error(`${map.id}: PDF has no georeferencing`);
  const srsFile = join(work, 'src.wkt');
  writeFileSync(srsFile, srsWkt);

  // Footprint polygon in WGS84 (falls back to the raster extent without a neatline).
  const cutline = join(work, 'neatline.csv');
  const poly = neatline ?? `POLYGON((${info.cornerCoordinates.upperLeft.join(' ')},${info.cornerCoordinates.upperRight.join(' ')},${info.cornerCoordinates.lowerRight.join(' ')},${info.cornerCoordinates.lowerLeft.join(' ')},${info.cornerCoordinates.upperLeft.join(' ')}))`;
  writeFileSync(cutline, `WKT\n"${poly}"\n`);
  rmSync(footprintFile, { force: true });
  run('ogr2ogr', ['-f', 'GeoJSON', '-s_srs', srsFile, '-t_srs', 'EPSG:4326', '-lco', 'COORDINATE_PRECISION=6', footprintFile, cutline]);
  const footprint = JSON.parse(readFileSync(footprintFile, 'utf8')).features[0].geometry;

  if (SKIP_TILES) return { footprint, tiles: existsSync(out) };
  if (!FORCE && existsSync(out) && statSync(out).mtimeMs > statSync(pdf).mtimeMs) {
    log(`tiles up to date: ${map.id}`);
    return { footprint, tiles: true };
  }

  log(`tiling ${map.id} at ${DPI} dpi`);
  const warped = join(work, 'warped.tif');
  const mbtiles = join(work, 'tiles.mbtiles');
  rmSync(warped, { force: true });
  rmSync(mbtiles, { force: true });
  // Render the page, clip to the map neatline, reproject to Web Mercator.
  run('gdalwarp', [
    '-oo', `DPI=${DPI}`,
    // The WGS84 footprint carries its own CRS (-cutline_srs needs GDAL >= 3.9).
    '-cutline', footprintFile, '-crop_to_cutline',
    '-t_srs', 'EPSG:3857', '-r', 'bilinear', '-dstalpha',
    '-co', 'COMPRESS=DEFLATE', '-co', 'TILED=YES', '-co', 'BIGTIFF=IF_SAFER',
    '-multi', '-wo', 'NUM_THREADS=ALL_CPUS',
    pdf, warped,
  ]);
  run('gdal_translate', ['-of', 'MBTiles', '-co', 'TILE_FORMAT=WEBP', '-co', 'QUALITY=80', '-co', `NAME=${map.title}`, warped, mbtiles]);
  run('gdaladdo', ['-r', 'average', mbtiles, '2', '4', '8', '16', '32', '64']);
  rmSync(out, { force: true });
  run('pmtiles', ['convert', mbtiles, out]);
  rmSync(warped, { force: true });
  return { footprint, tiles: true };
}

// --- 4. Snapshot the MVUM roads/trails API -----------------------------------
async function snapshotLayer(name) {
  const calls = [];
  const fc = await fetchLayer(name, (url, json) => {
    writeFileSync(join(CACHE, 'api', `${name}-${calls.length}.json`), JSON.stringify(json));
    calls.push(url);
  });
  writeFileSync(join(PUBLIC_DATA, `${name}.geojson`), JSON.stringify(fc));
  log(`${name}: ${fc.features.length} features`);
  return { count: fc.features.length, calls };
}

// --- main --------------------------------------------------------------------
const maps = await discoverMaps();
const roads = await snapshotLayer('roads');
const trails = await snapshotLayer('trails');

const manifestMaps = [];
for (const map of maps) {
  const pdf = await downloadPdf(map);
  const { footprint, tiles } = tileMap(map, pdf);
  manifestMaps.push({
    ...map,
    pdf: `maps/${map.id}.pdf`,
    pdfBytes: statSync(join(PUBLIC_MAPS, `${map.id}.pdf`)).size,
    pmtiles: tiles ? `maps/${map.id}.pmtiles` : null,
    pmtilesBytes: tiles ? statSync(join(PUBLIC_MAPS, `${map.id}.pmtiles`)).size : 0,
    footprint,
  });
}

const manifest = {
  generatedAt: new Date().toISOString(),
  sourcePage: PAGE_URL,
  api: { service: MVUM_SERVICE, where: FOREST_WHERE, roads, trails },
  maps: manifestMaps,
};
writeFileSync(join(PUBLIC_DATA, 'manifest.json'), JSON.stringify(manifest, null, 2));
log('wrote public/data/manifest.json');
