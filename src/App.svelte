<script lang="ts">
  import { onMount } from 'svelte';
  import type { FeatureCollection } from 'geojson';
  import MapView from './lib/MapView.svelte';
  import MapsPanel from './lib/MapsPanel.svelte';
  import RouteCard from './lib/RouteCard.svelte';
  import { statusToday } from './lib/dates';
  import { indexRoutes, mapsAt, nearestRoute, type LngLat } from './lib/geo';
  import { loadManifest, loadRouteData, saveRouteData, storedFiles } from './lib/store';
  import { fetchLayer } from './lib/usfs.js';
  import type { Manifest, MapEntry, RouteData, Routes } from './lib/types';

  const STALE_MS = 7 * 24 * 3600 * 1000;

  let manifest = $state<Manifest>();
  let routeData = $state<RouteData>();
  let stored = $state(new Set<string>());
  let loadError = $state('');

  let position = $state<LngLat | null>(null);
  let accuracy = $state(0);
  let locationError = $state('');
  let current = $state<MapEntry | null>(null);
  let preferredKind = $state<'mvum' | 'osvum'>('mvum');
  /** Auto-switch to the map under the user; off after they pick a map they aren't on. */
  let follow = $state(true);
  let mapView = $state<ReturnType<typeof MapView>>();
  let barHeight = $state(0);
  let sheetHeight = $state(0);
  let pinnedKey = $state<string | null>(null);
  let panelOpen = $state(false);
  let refreshing = $state(false);
  let notice = $state('');
  let online = $state(navigator.onLine);

  const index = $derived(routeData ? indexRoutes(routeData.roads, routeData.trails) : []);
  const routesFC = $derived<FeatureCollection>({
    type: 'FeatureCollection',
    features: index.map((r) => ({
      ...r.feature,
      properties: { ...r.feature.properties, key: r.key, status: statusToday(r.feature.properties) },
    })),
  });
  const here = $derived(manifest && position ? mapsAt(manifest.maps, position) : []);
  // Match radius follows GPS accuracy, within sane bounds.
  const nearest = $derived(position ? nearestRoute(index, position, Math.min(Math.max(accuracy, 40), 120)) : null);
  const pinned = $derived(pinnedKey ? index.find((r) => r.key === pinnedKey) : undefined);

  onMount(() => {
    const setOnline = () => (online = navigator.onLine);
    addEventListener('online', setOnline);
    addEventListener('offline', setOnline);
    // `#at=lat,lng` simulates a position (testing, or checking a spot before a trip).
    const at = location.hash.match(/at=(-?[\d.]+),(-?[\d.]+)/);
    if (at) {
      position = [+at[2], +at[1]];
      accuracy = 10;
    }
    init();
    return () => {
      removeEventListener('online', setOnline);
      removeEventListener('offline', setOnline);
    };
  });

  async function init() {
    try {
      manifest = await loadManifest();
      routeData = await loadRouteData(manifest);
      stored = await storedFiles();
      current ??= manifest.maps.find((m) => m.pmtiles) ?? null;
      if (!stored.size) panelOpen = true;
      if (navigator.onLine && Date.now() - Date.parse(routeData.fetchedAt) > STALE_MS) refresh();
    } catch (e) {
      loadError = `Could not load map data: ${(e as Error).message}`;
    }
  }

  // Follow the user onto whichever map covers their position.
  $effect(() => {
    if (!follow || !here.length || (current && here.some((m) => m.id === current!.id))) return;
    current = here.find((m) => m.kind === preferredKind && m.pmtiles) ?? here.find((m) => m.pmtiles) ?? current;
  });

  function pick(m: MapEntry) {
    current = m;
    preferredKind = m.kind;
    follow = here.some((h) => h.id === m.id);
    panelOpen = false;
  }

  function showMyMap() {
    follow = true;
    mapView?.recenter();
  }

  async function refresh() {
    refreshing = true;
    try {
      const [roads, trails] = (await Promise.all([fetchLayer('roads'), fetchLayer('trails')])) as Routes[];
      routeData = { roads, trails, fetchedAt: new Date().toISOString(), source: 'live' };
      await saveRouteData($state.snapshot(routeData));
    } catch (e) {
      notice = `Road data refresh failed: ${(e as Error).message}`;
    } finally {
      refreshing = false;
    }
  }

  function tileError(m: MapEntry) {
    if (!stored.has(m.pmtiles ?? '') && !navigator.onLine) notice = `${m.title} isn't downloaded for offline use.`;
  }
</script>

<main>
  <header class="bar" bind:clientHeight={barHeight}>
    <button class="title" onclick={() => (panelOpen = !panelOpen)}>
      <span>{current?.title ?? 'Lolo MVUM'}</span>
      <small>
        {#if !position}{locationError ? `Location unavailable: ${locationError}` : 'Locating…'}{:else if !here.length}Outside all maps{:else if !here.some((m) => m.id === current?.id)}Not on this map{:else if here.length > 1}Also on {here
            .filter((m) => m.id !== current?.id)
            .map((m) => m.title)
            .join(', ')}{:else}You are on this map{/if}
        {#if !online}· Offline{/if}
      </small>
    </button>
    {#if !follow && position}
      <button class="link" onclick={showMyMap}>Show my map</button>
    {/if}
    <button class="primary" onclick={() => (panelOpen = !panelOpen)}>Maps</button>
  </header>

  {#if manifest && routeData}
    <MapView
      bind:this={mapView}
      map={current}
      routes={routesFC}
      selectedKey={pinned?.key ?? nearest?.route.key ?? null}
      initialCenter={position}
      insets={{ top: barHeight, bottom: sheetHeight }}
      {position}
      onposition={(at, acc) => {
        position = at;
        accuracy = acc;
        locationError = '';
      }}
      onlocationerror={(message) => (locationError = message || 'Location unavailable')}
      onlocate={showMyMap}
      onselect={(key) => (pinnedKey = key)}
      ontileerror={tileError}
    />
  {/if}

  <aside class="sheet" class:open={panelOpen} bind:clientHeight={sheetHeight}>
    {#if loadError}
      <p class="error">{loadError}</p>
    {:else if panelOpen && manifest && routeData}
      <MapsPanel
        {manifest}
        {current}
        here={new Set(here.map((m) => m.id))}
        {stored}
        {routeData}
        {refreshing}
        onpick={pick}
        onstoredchange={async () => (stored = await storedFiles())}
        onrefresh={refresh}
        onclose={() => (panelOpen = false)}
      />
    {:else if pinned}
      <RouteCard route={pinned.feature.properties} pinned onclear={() => (pinnedKey = null)} />
    {:else if nearest}
      <RouteCard route={nearest.route.feature.properties} meters={nearest.meters} pinned={false} onclear={() => {}} />
    {:else}
      <p class="hint">
        {position ? 'Not on a designated road or trail. Tap a route on the map to see its dates.' : 'Waiting for GPS… Tap a route on the map to see its dates.'}
      </p>
    {/if}
    {#if notice}
      <button class="notice" onclick={() => (notice = '')}>{notice} ✕</button>
    {/if}
  </aside>
</main>

<style>
  main {
    position: fixed;
    inset: 0;
  }
  .bar {
    position: absolute;
    z-index: 2;
    top: max(0.5rem, env(safe-area-inset-top));
    left: 0.5rem;
    right: 3.5rem;
    display: flex;
    gap: 0.5rem;
    align-items: center;
    padding: 0.4rem 0.5rem 0.4rem 0.75rem;
    background: var(--surface);
    border-radius: 12px;
    box-shadow: var(--shadow);
  }
  .title {
    all: unset;
    cursor: pointer;
    flex: 1;
    min-width: 0;
    display: grid;
  }
  .title span {
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .title small {
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sheet {
    position: absolute;
    z-index: 2;
    left: 0.5rem;
    right: 0.5rem;
    bottom: max(0.5rem, env(safe-area-inset-bottom));
    max-height: 45vh;
    overflow: auto;
    padding: 0.85rem 1rem;
    background: var(--surface);
    border-radius: 14px;
    box-shadow: var(--shadow);
    display: grid;
    gap: 0.5rem;
  }
  .sheet.open {
    max-height: 75vh;
  }
  @media (min-width: 760px) {
    .sheet {
      left: auto;
      width: 380px;
    }
    .bar {
      right: auto;
      width: 380px;
    }
  }
  .hint,
  .error {
    margin: 0;
    color: var(--muted);
  }
  .error {
    color: var(--closed);
  }
  .notice {
    all: unset;
    cursor: pointer;
    font-size: 0.85rem;
    padding: 0.4rem 0.6rem;
    border-radius: 8px;
    background: var(--partial);
    color: #fff;
  }
</style>
