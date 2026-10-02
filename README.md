# Lolo MVUM

Offline PWA for the Lolo National Forest
[travel management maps](https://www.fs.usda.gov/r01/lolo/maps-guides/travel-management-maps).
It shows which Motor Vehicle Use Map (MVUM) or Over-Snow Vehicle Use Map (OSVUM) you are on, draws
that map with your GPS position, and matches you to the nearest designated road or trail so it can show the
dates that route is open, by vehicle class.

## How it works

- **Maps.** `scripts/build-data.mjs` scrapes the travel-management page for every map PDF and downloads it.
  GDAL then renders each GeoPDF, clips it to the map's neatline, reprojects it to Web Mercator and writes WebP
  tiles. The `pmtiles` CLI packs those tiles into a single `.pmtiles` file. The neatline polygon becomes the
  map's footprint, which is used to work out which map covers your position.
- **Road dates.** The seasonal-dates table inside each MVUM PDF is a low-resolution raster image. Instead of
  OCRing it, the app uses the same data from the USFS
  [EDW_MVUM_02 ArcGIS service](https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_02/MapServer):
  route ID, mileposts and `*_datesopen` per vehicle class.
- **Offline.**
  - The service worker (vite-plugin-pwa / Workbox) precaches the app shell plus a bundled snapshot of
    `manifest.json`, `roads.geojson` and `trails.geojson`.
  - Map PMTiles and the original PDFs are downloaded on demand from the Maps panel and stored as Blobs in
    IndexedDB. MapLibre reads them through `pmtiles`' `FileSource`.
  - "Refresh from USFS now" re-queries the live API and stores the result in IndexedDB. A refresh also runs
    automatically when online if the data is more than 7 days old. The service worker caches those API
    responses too (NetworkFirst).

## Development

Requires Node 20+ and, for the data pipeline, GDAL and the pmtiles CLI (`brew install gdal pmtiles`).

```bash
npm install
npm run data      # scrape, download, tile, snapshot API -> public/data, public/maps
npm run dev
```

`npm run data -- --force` re-downloads and re-tiles everything. `--dpi=300` renders sharper tiles.
`--skip-tiles` refreshes only the API data and footprints. Raw downloads and API responses are kept in
`data/cache/`.

## Deploying

### GitHub Pages

`.github/workflows/deploy.yml` installs GDAL and pmtiles, runs `npm run data`, builds, and deploys to Pages. It
runs on every push to `main`, weekly (to pick up new map editions and road dates), and on demand from the
Actions tab. Running it manually with **force** re-tiles every map. Downloaded PDFs and generated tiles are kept
in the Actions cache between runs.

One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**. The site is then served
at `https://<user>.github.io/<repo>/`. The build uses relative paths, so any repo name works.

### Other hosts

`npm run build` writes a static site to `dist/`. The host must support HTTP range requests, which most
static hosts do; the app uses them to stream maps that haven't been downloaded. Geolocation needs HTTPS
(localhost is exempt).
