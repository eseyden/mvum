// USFS MVUM ArcGIS service access, shared by the build pipeline (Node) and the
// app (browser) so both produce identical road/trail GeoJSON.

export const MVUM_SERVICE = 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_02/MapServer';
export const FOREST_WHERE = "FORESTNAME LIKE 'Lolo%'";
export const LAYERS = /** @type {const} */ ({ roads: 1, trails: 2 });

const PAGE_SIZE = 1000;

// Attributes worth shipping to the client; everything else is dropped to keep the payload small.
const KEEP_PROPS =
  /^(id|name|bmp|emp|seasonal|mvum_symbol_name|districtname|surfacetype|operationalmaintlevel|trailclass|.*_datesopen|e_bike_class\d(_dur)?)$/;

/** @param {number} layer @param {number} offset */
export function layerQueryUrl(layer, offset) {
  const q = new URLSearchParams({
    where: FOREST_WHERE,
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    geometryPrecision: '6',
    orderByFields: 'objectid',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    f: 'geojson',
  });
  return `${MVUM_SERVICE}/${layer}/query?${q}`;
}

/**
 * Fetch every Lolo feature for a layer, paging through the service limit.
 * @param {'roads' | 'trails'} name
 * @param {(url: string, json: any) => void} [onPage] called with each raw response
 */
export async function fetchLayer(name, onPage) {
  const features = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = layerQueryUrl(LAYERS[name], offset);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    const json = await res.json();
    if (json.error) throw new Error(`${name}: ${JSON.stringify(json.error)}`);
    onPage?.(url, json);
    features.push(...json.features);
    if (json.features.length < PAGE_SIZE) break;
  }
  return {
    type: 'FeatureCollection',
    features: features.map((f) => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        kind: name === 'roads' ? 'road' : 'trail',
        ...Object.fromEntries(
          Object.entries(f.properties).filter(([k, v]) => v != null && v !== '' && KEEP_PROPS.test(k)),
        ),
      },
    })),
  };
}
