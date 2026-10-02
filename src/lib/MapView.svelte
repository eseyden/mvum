<script lang="ts" module>
  import * as maplibregl from 'maplibre-gl';
  import { FileSource, PMTiles, Protocol } from 'pmtiles';
  // MapLibre 6 locates its worker relative to its own module, which breaks once bundled;
  // let Vite bundle the worker and hand MapLibre the resulting URL.
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

  maplibregl.setWorkerUrl(workerUrl);
  /** Zoom used around the user's position: ~26 m/px at this latitude, about 10 km across a phone. */
  const LOCAL_ZOOM = 11;

  const protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
</script>

<script lang="ts">
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { onMount, untrack } from 'svelte';
  import type { FeatureCollection } from 'geojson';
  import { getFile } from './store';
  import { mapsAt, type LngLat } from './geo';
  import type { MapEntry } from './types';

  interface Props {
    map: MapEntry | null;
    /** Roads + trails with `key` and `status` properties added. */
    routes: FeatureCollection;
    selectedKey: string | null;
    /** Start centered here (e.g. a simulated position) instead of fitting the map. */
    initialCenter?: LngLat | null;
    /** Screen space covered by overlaid UI, kept clear when framing the map. */
    insets: { top: number; bottom: number };
    /** Current position (real or simulated) to mark on the map. */
    position: LngLat | null;
    onposition: (at: LngLat, accuracy: number) => void;
    onlocationerror: (message: string) => void;
    /** The locate button was pressed. */
    onlocate: () => void;
    onselect: (key: string | null) => void;
    ontileerror: (map: MapEntry) => void;
  }

  let { map, routes, selectedKey, initialCenter = null, insets, position, onposition, onlocationerror, onlocate, onselect, ontileerror }: Props =
    $props();

  let container: HTMLDivElement;
  let mlMap = $state<maplibregl.Map>();
  /**
   * Whether the camera follows the user's position. MapLibre's GeolocateControl isn't used for
   * this: it keeps its camera lock through any move that changes zoom (such as fitting a map the
   * user isn't on), so the next GPS fix would pull the view back to the user.
   */
  let followCamera = true;
  /** Simulated positions are already centered on; real ones get centered on the first fix. */
  let centeredOnFix = untrack(() => !!initialCenter);
  let locateButton: HTMLButtonElement | undefined;
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
      zoom: initialCenter ? LOCAL_ZOOM : 8,
      attributionControl: { compact: true, customAttribution: 'USDA Forest Service MVUM' },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    m.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');
    m.addControl(locateControl(), 'top-right');
    m.on('dragstart', () => setFollowCamera(false));
    const watchId = navigator.geolocation?.watchPosition(
      (p) => onposition([p.coords.longitude, p.coords.latitude], p.coords.accuracy),
      (err) => onlocationerror(err.message),
      { enableHighAccuracy: true, maximumAge: 10_000 },
    );

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
    });

    return () => {
      if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
      m.remove();
    };
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

  // Keep the user in view while following. Only the center moves, so the user's zoom is kept.
  $effect(() => {
    const m = mlMap;
    const at = position;
    if (!m || !at || !followCamera || m.isMoving()) return;
    if (!centeredOnFix) {
      centeredOnFix = true;
      // First fix: show the area around the user if they're on this map, else leave the map framed.
      const entry = untrack(() => map); // react to position only, not map switches
      if (entry && mapsAt([entry], at).length) m.easeTo({ center: at, zoom: LOCAL_ZOOM });
      else setFollowCamera(false);
    } else {
      m.easeTo({ center: at, duration: 500 });
    }
  });

  $effect(() => {
    (mlMap?.getSource('routes') as maplibregl.GeoJSONSource | undefined)?.setData(routes);
  });

  $effect(() => {
    mlMap?.setFilter('routes-selected', ['==', ['get', 'key'], selectedKey ?? '']);
  });

  /** Bring the camera back to the user and follow them again. */
  export function recenter() {
    setFollowCamera(true);
    centeredOnFix = true;
    if (mlMap && position) mlMap.flyTo({ center: position, zoom: LOCAL_ZOOM });
  }

  function setFollowCamera(on: boolean) {
    followCamera = on;
    locateButton?.classList.toggle('maplibregl-ctrl-geolocate-active', on);
  }

  /** Locate button styled like MapLibre's GeolocateControl. */
  function locateControl(): maplibregl.IControl {
    const group = document.createElement('div');
    group.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    locateButton = document.createElement('button');
    locateButton.type = 'button';
    locateButton.className = 'maplibregl-ctrl-geolocate maplibregl-ctrl-geolocate-active';
    locateButton.title = locateButton.ariaLabel = 'Show my location';
    locateButton.innerHTML = '<span class="maplibregl-ctrl-icon" aria-hidden="true"></span>';
    locateButton.disabled = !('geolocation' in navigator);
    locateButton.onclick = () => onlocate();
    group.append(locateButton);
    return { onAdd: () => group, onRemove: () => group.remove() };
  }

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

    if (position && mapsAt([entry], position).length) {
      // On this map: show the area around the user and follow them.
      setFollowCamera(true);
      centeredOnFix = true;
      m.easeTo({ center: position, zoom: LOCAL_ZOOM });
    } else {
      // Not on this map: show all of it, and stop following so GPS updates don't pull the view away.
      setFollowCamera(false);
      const ring = entry.footprint.type === 'Polygon' ? entry.footprint.coordinates[0] : entry.footprint.coordinates[0][0];
      const b = new maplibregl.LngLatBounds();
      ring.forEach(([x, y]) => b.extend([x, y]));
      m.fitBounds(b, { padding: framePadding(), duration: 0 });
    }
  }

  function framePadding() {
    // The bottom sheet can still measure as the open Maps panel right after a pick; cap it at
    // the closed sheet's max height (45vh).
    const bottom = Math.min(insets.bottom, window.innerHeight * 0.45);
    return { top: insets.top + 16, bottom: bottom + 16, left: 16, right: 56 };
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
