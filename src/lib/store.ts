// Offline storage. Map files (PMTiles + original PDFs) are kept as Blobs in
// IndexedDB; the app shell and bundled data are precached by the service worker.

import { openDB, type DBSchema } from 'idb';
import type { Manifest, MapEntry, RouteData } from './types';

interface MvumDB extends DBSchema {
  files: { key: string; value: { blob: Blob; storedAt: string } };
  kv: { key: string; value: unknown };
}

const dbPromise = openDB<MvumDB>('mvum', 1, {
  upgrade(db) {
    db.createObjectStore('files');
    db.createObjectStore('kv');
  },
});

export async function getFile(path: string): Promise<Blob | undefined> {
  return (await (await dbPromise).get('files', path))?.blob;
}

export async function storedFiles(): Promise<Set<string>> {
  return new Set(await (await dbPromise).getAllKeys('files'));
}

export async function deleteFile(path: string) {
  await (await dbPromise).delete('files', path);
}

async function getKv<T>(key: string): Promise<T | undefined> {
  return (await (await dbPromise).get('kv', key)) as T | undefined;
}

async function setKv(key: string, value: unknown) {
  await (await dbPromise).put('kv', value, key);
}

/** Download a file with progress and keep it in IndexedDB. */
export async function downloadFile(path: string, onProgress?: (loaded: number) => void): Promise<Blob> {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok || !res.body) throw new Error(`${res.status} fetching ${path}`);
  const reader = res.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.(loaded);
  }
  const blob = new Blob(chunks, { type: res.headers.get('content-type') ?? 'application/octet-stream' });
  await (await dbPromise).put('files', { blob, storedAt: new Date().toISOString() }, path);
  return blob;
}

/** Store both files for a map. Progress is reported in bytes across both. */
export async function downloadMap(map: MapEntry, onProgress?: (loaded: number, total: number) => void) {
  const total = map.pmtilesBytes + map.pdfBytes;
  let done = 0;
  for (const path of [map.pmtiles, map.pdf]) {
    if (!path) continue;
    await downloadFile(path, (n) => onProgress?.(done + n, total));
    done += path === map.pdf ? map.pdfBytes : map.pmtilesBytes;
  }
  await navigator.storage?.persist?.();
}

export async function deleteMap(map: MapEntry) {
  await Promise.all([map.pmtiles, map.pdf].filter((p): p is string => !!p).map(deleteFile));
}

/** Manifest: network first so new map editions are picked up, else the last stored copy. */
export async function loadManifest(): Promise<Manifest> {
  try {
    const res = await fetch('data/manifest.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const manifest = (await res.json()) as Manifest;
    await setKv('manifest', manifest);
    return manifest;
  } catch (err) {
    const stored = await getKv<Manifest>('manifest');
    if (stored) return stored;
    throw err;
  }
}

/** Road/trail data: a live API refresh stored in IndexedDB wins over the bundled snapshot if newer. */
export async function loadRouteData(manifest: Manifest): Promise<RouteData> {
  const live = await getKv<RouteData>('routes');
  if (live && live.fetchedAt > manifest.generatedAt) return live;
  const [roads, trails] = await Promise.all(
    ['data/roads.geojson', 'data/trails.geojson'].map(async (p) => {
      const res = await fetch(p);
      if (!res.ok) throw new Error(`${res.status} fetching ${p}`);
      return res.json();
    }),
  );
  return { roads, trails, fetchedAt: manifest.generatedAt, source: 'bundled' };
}

export async function saveRouteData(data: RouteData) {
  await setKv('routes', data);
}
