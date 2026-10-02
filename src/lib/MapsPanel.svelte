<script lang="ts">
  import { deleteMap, downloadMap, getFile } from './store';
  import type { Manifest, MapEntry, RouteData } from './types';

  interface Props {
    manifest: Manifest;
    current: MapEntry | null;
    /** Maps that contain the user's position. */
    here: Set<string>;
    stored: Set<string>;
    routeData: RouteData;
    refreshing: boolean;
    onpick: (map: MapEntry) => void;
    onstoredchange: () => void;
    onrefresh: () => void;
    onclose: () => void;
  }

  let { manifest, current, here, stored, routeData, refreshing, onpick, onstoredchange, onrefresh, onclose }: Props =
    $props();

  let progress = $state<Record<string, number>>({});
  let error = $state('');

  const mb = (n: number) => `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`;
  const isStored = (m: MapEntry) => !!m.pmtiles && stored.has(m.pmtiles) && stored.has(m.pdf);
  const remaining = $derived(manifest.maps.filter((m) => !isStored(m)));
  const remainingBytes = $derived(remaining.reduce((s, m) => s + m.pmtilesBytes + m.pdfBytes, 0));

  async function download(m: MapEntry) {
    error = '';
    try {
      await downloadMap(m, (loaded, total) => (progress[m.id] = loaded / total));
    } catch (e) {
      error = `${m.title}: ${(e as Error).message}`;
    } finally {
      delete progress[m.id];
      onstoredchange();
    }
  }

  async function downloadAll() {
    for (const m of remaining) await download(m);
  }

  async function remove(m: MapEntry) {
    await deleteMap(m);
    onstoredchange();
  }

  async function openPdf(m: MapEntry) {
    const blob = await getFile(m.pdf);
    window.open(blob ? URL.createObjectURL(blob) : m.pdf, '_blank');
  }

  const groups = $derived([
    { title: 'Motor Vehicle Use Maps', maps: manifest.maps.filter((m) => m.kind === 'mvum') },
    { title: 'Over-Snow Vehicle Use Maps', maps: manifest.maps.filter((m) => m.kind === 'osvum') },
  ]);
</script>

<div class="panel">
  <header>
    <h2>Maps</h2>
    <button class="link" onclick={onclose}>Close</button>
  </header>

  <div class="offline">
    {#if remaining.length}
      <button class="primary" onclick={downloadAll} disabled={Object.keys(progress).length > 0}>
        Download all for offline ({mb(remainingBytes)})
      </button>
    {:else}
      <p>✓ All maps are stored for offline use.</p>
    {/if}
    {#if error}<p class="error">{error}</p>{/if}
  </div>

  {#each groups as g (g.title)}
    <h3>{g.title}</h3>
    <ul>
      {#each g.maps as m (m.id)}
        <li class:current={current?.id === m.id}>
          <button class="pick" onclick={() => onpick(m)} disabled={!m.pmtiles}>
            <strong>{m.title}</strong>
            {#if here.has(m.id)}<span class="here">You are here</span>{/if}
            <small>
              {mb(m.pmtilesBytes + m.pdfBytes)}
              {#if !m.pmtiles}· not tiled{/if}
            </small>
          </button>
          <div class="actions">
            {#if progress[m.id] !== undefined}
              <progress value={progress[m.id]}></progress>
            {:else if isStored(m)}
              <span class="ok" title="Stored offline">✓ Offline</span>
              <button class="link" onclick={() => remove(m)}>Remove</button>
            {:else if m.pmtiles}
              <button class="link" onclick={() => download(m)}>Download</button>
            {/if}
            <button class="link" onclick={() => openPdf(m)}>PDF</button>
          </div>
        </li>
      {/each}
    </ul>
  {/each}

  <h3>Road &amp; trail dates</h3>
  <p class="small">
    {routeData.roads.features.length} roads, {routeData.trails.features.length} trails from the USFS MVUM service,
    retrieved {new Date(routeData.fetchedAt).toLocaleDateString()} ({routeData.source === 'live' ? 'refreshed on this device' : 'bundled with app'}).
  </p>
  <button onclick={onrefresh} disabled={refreshing || !navigator.onLine}>
    {refreshing ? 'Refreshing…' : 'Refresh from USFS now'}
  </button>
  <p class="small">
    Source: <a href={manifest.sourcePage} target="_blank" rel="noreferrer">Lolo NF travel management maps</a>. Maps are
    the official MVUMs; always obey posted signs and closure orders.
  </p>
</div>

<style>
  .panel {
    display: grid;
    gap: 0.5rem;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  h2,
  h3 {
    margin: 0;
  }
  h3 {
    margin-top: 0.75rem;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0;
    border-top: 1px solid var(--line);
  }
  li.current .pick strong {
    color: var(--accent);
  }
  .pick {
    all: unset;
    cursor: pointer;
    display: grid;
    min-width: 0;
  }
  .pick small {
    color: var(--muted);
  }
  .here {
    font-size: 0.75rem;
    color: var(--open);
    font-weight: 600;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex: none;
  }
  .ok {
    color: var(--open);
    font-size: 0.85rem;
  }
  progress {
    width: 5rem;
  }
  .small {
    font-size: 0.8rem;
    color: var(--muted);
    margin: 0;
  }
  .error {
    color: var(--closed);
    margin: 0;
  }
  .offline p {
    margin: 0;
  }
</style>
