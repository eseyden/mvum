<script lang="ts" module>
  import * as maplibregl from 'maplibre-gl';
  import { FileSource, PMTiles, Protocol } from 'pmtiles';
  // MapLibre 6 locates its worker relative to its own module, which breaks once bundled;
  // let Vite bundle the worker and hand MapLibre the resulting URL.
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

  maplibregl.setWorkerUrl(workerUrl);
  const protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
</script>

<script lang="ts">
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { onMount, untrack } from 'svelte';
  import type { FeatureCollection } from 'geojson';
  import { getFile } from './store';
  import type { LngLat } from './geo';
  import type { MapEntry } from './types';

  interface Props {
    map: MapEntry | null;
    /** Roads + trails with `key` and `status` properties added. */
    routes: FeatureCollection;
    selectedKey: string | null;
    /** Start centered here (e.g. a simulated position) instead of fitting the map. */
    initialCenter?: LngLat | null;
    /** Current position (real or simulated) to mark on the map. */
    position: LngLat | null;
    onposition: (at: LngLat, accuracy: number) => void;
    onselect: (key: string | null) => void;
    ontileerror: (map: MapEntry) => void;
  }

  let { map, routes, selectedKey, initialCenter = null, position, onposition, onselect, ontileerror }: Props = $props();

  let container: HTMLDivElement;
  let mlMap = $state<maplibregl.Map>();
  let hasPosition = untrack(() => !!initialCenter);
  let shownId: string | null = null;

  onMount(() => {
    const m = new maplibregl.Map({
      container,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#ece8dc' } }],
      },
      center: initialCenter ?? [-114.0, 46.9],
      zoom: initialCenter ? 13 : 8,
      attributionControl: { compact: true, customAttribution: 'USDA Forest Service MVUM' },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    m.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');
    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      // The app draws its own marker so simulated positions are shown the same way.
      showUserLocation: false,
      showAccuracyCircle: false,
    });
    m.addControl(geolocate, 'top-right');
    geolocate.on('geolocate', (e) => {
      hasPosition = true;
      onposition([e.coords.longitude, e.coords.latitude], e.coords.accuracy);
    });

    m.on('load', () => {
      m.addSource('routes', { type: 'geojson', data: routes });
      // Status overlay for seasonal routes only; the map image already draws every route.
      m.addLayer({
        id: 'routes-status',
        type: 'line',
        source: 'routes',
        filter: ['==', ['get', 'seasonal'], 'seasonal'],
        paint: {
          'line-color': ['match', ['get', 'status'], 'open', '#1f9d55', 'partial', '#d69e2e', '#d64545'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 15, 4],
          'line-opacity': 0.55,
          'line-dasharray': [2, 1.5],
        },
      });
      m.addLayer({
        id: 'routes-selected',
        type: 'line',
        source: 'routes',
        filter: ['==', ['get', 'key'], ''],
        paint: { 'line-color': '#2563eb', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 15, 9], 'line-opacity': 0.75 },
      });
      m.addLayer({
        id: 'routes-hit',
        type: 'line',
        source: 'routes',
        paint: { 'line-color': '#000', 'line-width': 18, 'line-opacity': 0 },
      });
      m.on('click', (e) => {
        const hit = m.queryRenderedFeatures(e.point, { layers: ['routes-hit'] })[0];
        onselect((hit?.properties?.key as string) ?? null);
      });
      m.on('mouseenter', 'routes-hit', () => (m.getCanvas().style.cursor = 'pointer'));
      m.on('mouseleave', 'routes-hit', () => (m.getCanvas().style.cursor = ''));
      m.on('error', (e) => {
        if (map && 'sourceId' in e && e.sourceId === 'mvum') ontileerror(map);
      });
      mlMap = m;
      geolocate.trigger();
    });

    return () => m.remove();
  });

  $effect(() => {
    const m = mlMap;
    const entry = map;
    if (!m || !entry || entry.id === shownId) return;
    shownId = entry.id;
    showMap(m, entry);
  });

  let marker: maplibregl.Marker | undefined;
  $effect(() => {
    if (!mlMap || !position) return;
    if (!marker) {
      const el = document.createElement('div');
      el.className = 'you-are-here';
      marker = new maplibregl.Marker({ element: el }).setLngLat(position).addTo(mlMap);
    } else marker.setLngLat(position);
  });

  $effect(() => {
    (mlMap?.getSource('routes') as maplibregl.GeoJSONSource | undefined)?.setData(routes);
  });

  $effect(() => {
    mlMap?.setFilter('routes-selected', ['==', ['get', 'key'], selectedKey ?? '']);
  });

  async function showMap(m: maplibregl.Map, entry: MapEntry) {
    if (m.getLayer('mvum')) m.removeLayer('mvum');
    if (m.getSource('mvum')) m.removeSource('mvum');
    if (!entry.pmtiles) return;

    // Prefer the copy stored for offline use; fall back to streaming over HTTP range requests.
    let url = new URL(entry.pmtiles, location.href).href;
    const blob = await getFile(entry.pmtiles);
    if (blob) {
      const name = `local/${entry.id}.pmtiles`;
      if (!protocol.get(name)) protocol.add(new PMTiles(new FileSource(new File([blob], name))));
      url = name;
    }
    if (shownId !== entry.id) return; // switched again while loading

    m.addSource('mvum', { type: 'raster', url: `pmtiles://${url}`, tileSize: 256 });
    m.addLayer({ id: 'mvum', type: 'raster', source: 'mvum' }, 'routes-status');

    if (!hasPosition) {
      const ring = entry.footprint.type === 'Polygon' ? entry.footprint.coordinates[0] : entry.footprint.coordinates[0][0];
      const b = new maplibregl.LngLatBounds();
      ring.forEach(([x, y]) => b.extend([x, y]));
      m.fitBounds(b, { padding: 20, duration: 0 });
    }
  }
</script>

<div class="map" bind:this={container}></div>

<style>
  .map :global(.you-are-here) {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #2563eb;
    border: 3px solid #fff;
    box-shadow: 0 0 0 6px rgb(37 99 235 / 0.25), 0 1px 4px rgb(0 0 0 / 0.4);
  }
  .map {
    position: absolute;
    inset: 0;
  }
</style>
