// MVUM "dates open" strings look like "05/16-10/14", may wrap the new year
// ("06/16-03/31"), and may list several windows separated by commas.

import type { RouteProps } from './types';

export interface DateWindow {
  start: [month: number, day: number];
  end: [month: number, day: number];
}

export function parseWindows(value: string | undefined): DateWindow[] {
  if (!value) return [];
  return [...value.matchAll(/(\d{1,2})\/(\d{1,2})\s*-\s*(\d{1,2})\/(\d{1,2})/g)].map((m) => ({
    start: [+m[1], +m[2]],
    end: [+m[3], +m[4]],
  }));
}

const ordinal = ([m, d]: [number, number]) => m * 100 + d;

export function inWindow(w: DateWindow, date: Date): boolean {
  const today = (date.getMonth() + 1) * 100 + date.getDate();
  const s = ordinal(w.start);
  const e = ordinal(w.end);
  return s <= e ? today >= s && today <= e : today >= s || today <= e;
}

export const VEHICLE_CLASSES: Record<string, string> = {
  passengervehicle_datesopen: 'Passenger vehicle',
  highclearancevehicle_datesopen: 'High-clearance vehicle',
  truck_datesopen: 'Truck',
  bus_datesopen: 'Bus',
  motorhome_datesopen: 'Motorhome',
  fourwd_gt50_datesopen: '4WD > 50"',
  twowd_gt50_datesopen: '2WD > 50"',
  tracked_ohv_gt50_datesopen: 'Tracked OHV > 50"',
  other_ohv_gt50_datesopen: 'Other OHV > 50"',
  atv_datesopen: 'ATV',
  motorcycle_datesopen: 'Motorcycle',
  otherwheeled_ohv_datesopen: 'Other wheeled OHV',
  tracked_ohv_lt50_datesopen: 'Tracked OHV < 50"',
  other_ohv_lt50_datesopen: 'Other OHV < 50"',
};

export interface Allowance {
  /** Raw dates string from the USFS data, e.g. "05/16-10/14". */
  dates: string;
  vehicles: string[];
  openToday: boolean;
}

/** Group vehicle classes that share the same dates open. */
export function allowances(props: RouteProps, date = new Date()): Allowance[] {
  const byDates = new Map<string, string[]>();
  for (const [field, label] of Object.entries(VEHICLE_CLASSES)) {
    const dates = props[field];
    if (typeof dates !== 'string') continue;
    byDates.set(dates, [...(byDates.get(dates) ?? []), label]);
  }
  return [...byDates].map(([dates, vehicles]) => ({
    dates,
    vehicles,
    openToday: parseWindows(dates).some((w) => inWindow(w, date)),
  }));
}

export type RouteStatus = 'open' | 'closed' | 'partial';

export function statusToday(props: RouteProps, date = new Date()): RouteStatus {
  const a = allowances(props, date);
  if (a.length && a.every((x) => x.openToday)) return 'open';
  if (a.some((x) => x.openToday)) return 'partial';
  return 'closed';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatWindows(dates: string): string {
  const ws = parseWindows(dates);
  if (ws.length === 1 && ordinal(ws[0].start) === 101 && ordinal(ws[0].end) === 1231) return 'Yearlong';
  return ws.map((w) => `${MONTHS[w.start[0] - 1]} ${w.start[1]} – ${MONTHS[w.end[0] - 1]} ${w.end[1]}`).join(', ') || dates;
}
