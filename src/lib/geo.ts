import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import pointToLineDistance from '@turf/point-to-line-distance';
import { lineString, point } from '@turf/helpers';
import type { Feature, LineString, MultiLineString, Position } from 'geojson';
import type { MapEntry, RouteProps, Routes } from './types';

export type LngLat = [lng: number, lat: number];

export function mapsAt(maps: MapEntry[], at: LngLat): MapEntry[] {
  const p = point(at);
  return maps.filter((m) => booleanPointInPolygon(p, m.footprint));
}

type Bbox = [number, number, number, number];
type RouteFeature = Feature<LineString | MultiLineString, RouteProps>;

export interface IndexedRoute {
  feature: RouteFeature;
  bbox: Bbox;
  /** Index into the source collection; stable key for map highlighting. */
  key: string;
}

export function indexRoutes(...collections: Routes[]): IndexedRoute[] {
  const out: IndexedRoute[] = [];
  for (const fc of collections) {
    fc.features.forEach((feature, i) => {
      if (!feature.geometry) return;
      const lines: Position[][] =
        feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      const bbox: Bbox = [Infinity, Infinity, -Infinity, -Infinity];
      for (const line of lines)
        for (const [x, y] of line) {
          bbox[0] = Math.min(bbox[0], x);
          bbox[1] = Math.min(bbox[1], y);
          bbox[2] = Math.max(bbox[2], x);
          bbox[3] = Math.max(bbox[3], y);
        }
      out.push({ feature, bbox, key: `${feature.properties.kind}:${i}` });
    });
  }
  return out;
}

export interface NearestRoute {
  route: IndexedRoute;
  meters: number;
}

/** Closest road/trail within maxMeters of the point, using a bbox prefilter. */
export function nearestRoute(index: IndexedRoute[], at: LngLat, maxMeters: number): NearestRoute | null {
  const [lng, lat] = at;
  const dLat = maxMeters / 111_320;
  const dLng = dLat / Math.cos((lat * Math.PI) / 180);
  const p = point(at);
  let best: NearestRoute | null = null;
  for (const r of index) {
    const [x0, y0, x1, y1] = r.bbox;
    if (lng < x0 - dLng || lng > x1 + dLng || lat < y0 - dLat || lat > y1 + dLat) continue;
    const g = r.feature.geometry;
    const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
    for (const line of lines) {
      if (line.length < 2) continue;
      const meters = pointToLineDistance(p, lineString(line), { units: 'meters' });
      if (meters <= maxMeters && (!best || meters < best.meters)) best = { route: r, meters };
    }
  }
  return best;
}
