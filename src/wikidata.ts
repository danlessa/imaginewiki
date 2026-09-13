import { cached, DAY } from './cache.ts';
import { LABEL_LANGUAGES, LANG, type City } from './config.ts';

/** A photograph with a known camera position. */
export interface View {
  /** Wikidata QID, or the Commons MediaInfo id (M…) for photographs found only on Commons. */
  id: string;
  title: string;
  file: string;
  year: number | null;
  lon: number;
  lat: number;
  heading: number | null;
  creator: string | null;
  collection: string | null;
  iiif: string | null;
}

/** A place or structure with an image and a start date. */
export interface Landmark {
  id: string;
  title: string;
  file: string;
  type: string | null;
  start: number;
  end: number | null;
  lon: number;
  lat: number;
  article: string | null;
}

type Row = Record<string, string | undefined>;

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const FILE_PATH = 'Special:FilePath/';

/** Restricts ?item to those whose `predicate` coordinates fall inside the city. */
const inBox = ({ bbox: [west, south, east, north] }: City, predicate: string) => `
  SERVICE wikibase:box {
    ?item wdt:${predicate} ?location .
    bd:serviceParam wikibase:cornerSouthWest "Point(${west} ${south})"^^geo:wktLiteral .
    bd:serviceParam wikibase:cornerNorthEast "Point(${east} ${north})"^^geo:wktLiteral .
  }`;

// P1259 coordinates of the point of view (qualified by P7787 heading), P18 image, P571 inception,
// P170 creator, P195 collection, P6108 IIIF manifest.
const viewsQuery = (city: City) => `
SELECT ?item ?itemLabel ?image ?date ?lat ?lon ?heading ?creatorLabel ?collectionLabel ?iiif WHERE {
  ${inBox(city, 'P1259')}
  ?item wdt:P18 ?image; p:P1259 ?position .
  ?position psv:P1259 [ wikibase:geoLatitude ?lat; wikibase:geoLongitude ?lon ] .
  OPTIONAL { ?position pq:P7787 ?heading }
  OPTIONAL { ?item wdt:P571 ?date }
  OPTIONAL { ?item wdt:P170 ?creator }
  OPTIONAL { ?item wdt:P195 ?collection }
  OPTIONAL { ?item wdt:P6108 ?iiif }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${LABEL_LANGUAGES}". }
}`;

// P625 coordinates, P571 inception / P580 start time, P576 dissolved / P582 end time, P31 instance of.
// Photographs (items with a point of view) are already listed as views.
const landmarksQuery = (city: City) => `
SELECT ?item ?itemLabel ?image ?start ?end ?lat ?lon ?typeLabel ?article WHERE {
  ${inBox(city, 'P625')}
  ?item wdt:P18 ?image; p:P625/psv:P625 [ wikibase:geoLatitude ?lat; wikibase:geoLongitude ?lon ] .
  { ?item wdt:P571 ?start } UNION { ?item wdt:P580 ?start }
  OPTIONAL { { ?item wdt:P576 ?end } UNION { ?item wdt:P582 ?end } }
  OPTIONAL { ?item wdt:P31 ?type }
  OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://${LANG}.wikipedia.org/> }
  FILTER NOT EXISTS { ?item wdt:P1259 [] }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${LABEL_LANGUAGES}". }
}`;

export const loadViews = (city: City) => cached(`views:${city.id}:${LABEL_LANGUAGES}`, DAY, () => fetchViews(city));

export const loadLandmarks = (city: City) =>
  cached(`landmarks:${city.id}:${LABEL_LANGUAGES}`, DAY, () => fetchLandmarks(city));

/** `init` lets scripts outside the browser identify themselves; the query service rejects anonymous clients. */
export async function fetchViews(city: City, init: RequestInit = {}): Promise<View[]> {
  const views = new Map<string, View>();
  for (const row of await sparql(viewsQuery(city), init)) {
    const id = entityId(row.item!);
    const lon = Number(row.lon);
    const lat = Number(row.lat);
    // Rows repeat per creator, collection or point of view; keep the first one inside the city.
    if (views.has(id) || !inside(city, lon, lat)) continue;
    const file = fileName(row.image!);
    views.set(id, {
      id,
      title: labelOf(row.itemLabel) ?? fileTitle(file),
      file,
      year: yearOf(row.date),
      lon,
      lat,
      heading: row.heading ? Number(row.heading) : null,
      creator: labelOf(row.creatorLabel),
      collection: labelOf(row.collectionLabel),
      iiif: row.iiif ?? null,
    });
  }
  return [...views.values()];
}

async function fetchLandmarks(city: City): Promise<Landmark[]> {
  const landmarks = new Map<string, Landmark>();
  for (const row of await sparql(landmarksQuery(city))) {
    const start = yearOf(row.start);
    if (start == null) continue;
    const end = yearOf(row.end);
    const id = entityId(row.item!);
    const known = landmarks.get(id);
    if (known) {
      // Items with several start/end statements or types: keep the widest lifespan.
      known.start = Math.min(known.start, start);
      if (end != null && known.end != null) known.end = Math.max(known.end, end);
      known.type ??= labelOf(row.typeLabel);
      continue;
    }
    const file = fileName(row.image!);
    landmarks.set(id, {
      id,
      title: labelOf(row.itemLabel) ?? fileTitle(file),
      file,
      type: labelOf(row.typeLabel),
      start,
      end: end == null ? null : Math.max(start, end),
      lon: Number(row.lon),
      lat: Number(row.lat),
      article: row.article ?? null,
    });
  }
  return [...landmarks.values()];
}

async function sparql(query: string, init: RequestInit = {}): Promise<Row[]> {
  const res = await fetch(`${SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}`, {
    ...init,
    headers: { ...init.headers, Accept: 'application/sparql-results+json' },
  });
  if (!res.ok) throw new Error(`Wikidata query failed (HTTP ${res.status})`);
  const json = (await res.json()) as { results: { bindings: Record<string, { value: string }>[] } };
  return json.results.bindings.map((binding) =>
    Object.fromEntries(Object.entries(binding).map(([key, term]) => [key, term.value])),
  );
}

const entityId = (uri: string) => uri.slice(uri.lastIndexOf('/') + 1);

const fileName = (uri: string) => decodeURIComponent(uri.slice(uri.indexOf(FILE_PATH) + FILE_PATH.length));

const fileTitle = (file: string) => file.replace(/\.[a-z0-9]+$/i, '');

/** Year of an xsd:dateTime; unknown values come back as blank-node URIs and yield null. */
function yearOf(dateTime: string | undefined): number | null {
  const match = dateTime?.match(/^(-?\d+)-/);
  return match ? Number(match[1]) : null;
}

/** The label service falls back to the bare QID when no label exists in the requested languages. */
const labelOf = (label: string | undefined) => (label && !/^Q\d+$/.test(label) ? label : null);

const inside = ({ bbox: [west, south, east, north] }: City, lon: number, lat: number) =>
  lon >= west && lon <= east && lat >= south && lat <= north;
