import type { FeatureCollection, LineString, MultiLineString, Polygon, MultiPolygon } from 'geojson';

export interface MapEntry {
  id: string;
  title: string;
  kind: 'mvum' | 'osvum';
  mediaId: string;
  source: string;
  pdf: string;
  pdfBytes: number;
  pmtiles: string | null;
  pmtilesBytes: number;
  footprint: Polygon | MultiPolygon;
}

export interface Manifest {
  generatedAt: string;
  sourcePage: string;
  api: { service: string; where: string };
  maps: MapEntry[];
}

export interface RouteProps {
  kind: 'road' | 'trail';
  id: string;
  name?: string;
  bmp?: number;
  emp?: number;
  seasonal?: 'seasonal' | 'yearlong';
  mvum_symbol_name?: string;
  districtname?: string;
  surfacetype?: string;
  operationalmaintlevel?: string;
  trailclass?: string;
  [key: string]: string | number | undefined;
}

export type Routes = FeatureCollection<LineString | MultiLineString, RouteProps>;

export interface RouteData {
  roads: Routes;
  trails: Routes;
  /** When the USFS API was queried for this copy of the data. */
  fetchedAt: string;
  source: 'bundled' | 'live';
}
