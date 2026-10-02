<script lang="ts">
  import { allowances, formatWindows, statusToday } from './dates';
  import type { RouteProps } from './types';

  interface Props {
    route: RouteProps;
    /** Distance from the user, when the route was matched by location. */
    meters?: number;
    pinned: boolean;
    onclear: () => void;
  }

  let { route, meters, pinned, onclear }: Props = $props();

  const rows = $derived(allowances(route));
  const status = $derived(statusToday(route));
  const label = { open: 'Open today', closed: 'Closed today', partial: 'Open to some vehicles today' };
</script>

<section class="card">
  <header>
    <div>
      <h2>
        {route.kind === 'road' ? 'Road' : 'Trail'}
        {route.id}
        {#if route.name}<span class="name">{route.name}</span>{/if}
      </h2>
      <p class="meta">
        {#if meters !== undefined}~{Math.round(meters * 3.281)} ft away ·{/if}
        {route.districtname ?? ''}
        {#if route.bmp !== undefined && route.emp !== undefined}· MP {route.bmp.toFixed(2)}–{route.emp.toFixed(2)}{/if}
      </p>
    </div>
    <span class="badge {status}">{label[status]}</span>
  </header>

  {#if rows.length}
    <table>
      <tbody>
        {#each rows as row (row.dates)}
          <tr class:closed={!row.openToday}>
            <td class="dates">{formatWindows(row.dates)}</td>
            <td>{row.vehicles.join(', ')}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {:else}
    <p class="meta">No motor vehicle dates listed for this route.</p>
  {/if}

  {#if route.trailclass || route.surfacetype || route.operationalmaintlevel}
    <p class="meta">{[route.trailclass, route.surfacetype, route.operationalmaintlevel].filter(Boolean).join(' · ')}</p>
  {/if}

  {#if pinned}
    <button class="link" onclick={onclear}>Back to my location</button>
  {/if}
</section>

<style>
  .card {
    display: grid;
    gap: 0.5rem;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: start;
    gap: 0.75rem;
  }
  h2 {
    margin: 0;
    font-size: 1.15rem;
  }
  .name {
    font-weight: 400;
    color: var(--muted);
    margin-left: 0.35rem;
  }
  .meta {
    margin: 0.15rem 0 0;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .badge {
    flex: none;
    padding: 0.25rem 0.6rem;
    border-radius: 999px;
    font-size: 0.8rem;
    font-weight: 600;
    color: #fff;
  }
  .badge.open {
    background: var(--open);
  }
  .badge.closed {
    background: var(--closed);
  }
  .badge.partial {
    background: var(--partial);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  td {
    padding: 0.3rem 0;
    border-top: 1px solid var(--line);
    vertical-align: top;
  }
  td.dates {
    white-space: nowrap;
    font-weight: 600;
    padding-right: 0.75rem;
  }
  tr.closed {
    color: var(--muted);
    text-decoration: line-through;
  }
  .link {
    justify-self: start;
  }
</style>
