// Finds historical photographs that are geotagged on Wikimedia Commons inside each city but not used by a
// Wikidata item, and saves them to public/data/commons-views-<city>.json for the app to load.
// Commons cannot filter geotagged files by date, so this walks every geotagged file in the city's bounding
// box. That takes hundreds of API requests, which is why it runs ahead of time instead of in the browser.
// Run with `npm run snapshot:commons`, optionally followed by city ids to refresh only those.
import { mkdir, writeFile } from 'node:fs/promises';
import { commonsDateYear, plainText } from '../src/commons.ts';
import { CITIES, type City } from '../src/config.ts';
import { fetchViews, type View } from '../src/wikidata.ts';

/** Pictures dated this year or later are treated as contemporary and skipped. */
const HISTORICAL_BEFORE = 1970;
/** Earlier dates on geotagged files belong to photographed artworks, not to photographs. */
const FIRST_PHOTOGRAPH_YEAR = 1839;

const API = 'https://commons.wikimedia.org/w/api.php';
const HEADERS = { 'User-Agent': 'imaginewiki/0.1 (https://github.com/danlessa/imaginewiki)' };
/** Geosearch returns at most this many files per box and cannot continue, so full boxes are split. */
const GEOSEARCH_LIMIT = 500;
const START_TILE_DEGREES = 0.05;
const MIN_TILE_DEGREES = 0.0005;
const BATCH = 50;
const CONCURRENCY = 2;
const MAX_RETRIES = 5;
const IMAGE_FILE = /\.(jpe?g|png|tiff?|webp)$/i;
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** South, west, north, east. */
type Tile = [number, number, number, number];

interface GeoHit {
  pageid: number;
  title: string;
  lat: number;
  lon: number;
}

interface Page {
  pageid: number;
  title: string;
  imageinfo?: { extmetadata?: Record<string, { value: string } | undefined> }[];
  revisions?: { slots: { main: { content: string } } }[];
}

interface ApiResponse {
  error?: { code: string; info: string };
  query?: { geosearch?: GeoHit[]; pages?: Page[] };
}

const requested = process.argv.slice(2);
const cities = requested.length ? CITIES.filter((c) => requested.includes(c.id)) : CITIES;

await mkdir('public/data', { recursive: true });
for (const city of cities) {
  const onWikidata = new Set((await fetchViews(city, { headers: HEADERS })).map((v) => v.file));
  const hits = [...(await geotaggedFiles(city)).values()].filter(
    (hit) => IMAGE_FILE.test(hit.title) && !onWikidata.has(fileOf(hit)),
  );
  console.log(`${city.name}: ${hits.length} geotagged images not on Wikidata, reading their dates…`);

  const views = (await historicalPhotographs(hits)).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  const path = `public/data/commons-views-${city.id}.json`;
  // One photograph per line keeps diffs of refreshed snapshots readable.
  await writeFile(path, `[\n${views.map((v) => JSON.stringify(v)).join(',\n')}\n]\n`);
  console.log(`${city.name}: saved ${views.length} photographs dated before ${HISTORICAL_BEFORE} to ${path}`);
}

/** Every file with coordinates inside the city, found by splitting the bounding box until no tile is full. */
async function geotaggedFiles(city: City): Promise<Map<number, GeoHit>> {
  const [west, south, east, north] = city.bbox;
  const tiles: Tile[] = [];
  // The epsilon stops floating-point steps from adding a zero-height or zero-width tile at the edge.
  for (let s = south; s < north - 1e-9; s += START_TILE_DEGREES) {
    for (let w = west; w < east - 1e-9; w += START_TILE_DEGREES) {
      tiles.push([s, w, Math.min(s + START_TILE_DEGREES, north), Math.min(w + START_TILE_DEGREES, east)]);
    }
  }

  const hits = new Map<number, GeoHit>();
  let requests = 0;
  await drain(tiles, async (tile) => {
    const [s, w, n, e] = tile;
    const json = await api(
      { action: 'query', list: 'geosearch', gsnamespace: '6', gslimit: String(GEOSEARCH_LIMIT), gsbbox: `${n}|${w}|${s}|${e}` },
      { allowErrors: true },
    );
    if (++requests % 50 === 0) console.log(`  ${requests} geosearch requests, ${hits.size} files so far`);
    // GeoData's size limit isn't a fixed number of degrees, so a rejected box is split like a full one.
    const tooBig = /too big/i.test(json.error?.info ?? '');
    if (json.error && !tooBig) throw new Error(`Commons API error: ${json.error.info}`);
    const results = json.query?.geosearch ?? [];
    if (tooBig || results.length >= GEOSEARCH_LIMIT) {
      if (n - s > MIN_TILE_DEGREES) {
        tiles.push(...split(tile));
        return;
      }
      console.warn(`  over ${GEOSEARCH_LIMIT} files at ${s},${w}; the rest are skipped`);
    }
    for (const hit of results) hits.set(hit.pageid, hit);
  });
  return hits;
}

async function historicalPhotographs(hits: GeoHit[]): Promise<View[]> {
  const batches: GeoHit[][] = [];
  for (let i = 0; i < hits.length; i += BATCH) batches.push(hits.slice(i, i + BATCH));

  const views: View[] = [];
  await drain(batches, async (batch) => {
    const byId = new Map(batch.map((hit) => [hit.pageid, hit]));
    const metadata = await api({
      action: 'query',
      pageids: batch.map((hit) => hit.pageid).join('|'),
      prop: 'imageinfo',
      iiprop: 'extmetadata',
      iiextmetadatafilter: 'DateTimeOriginal|ObjectName|Artist',
    });

    const old: View[] = [];
    for (const page of metadata.query?.pages ?? []) {
      const meta = page.imageinfo?.[0]?.extmetadata ?? {};
      const year = meta.DateTimeOriginal ? commonsDateYear(meta.DateTimeOriginal.value) : null;
      const hit = byId.get(page.pageid);
      if (!hit || year == null || year < FIRST_PHOTOGRAPH_YEAR || year >= HISTORICAL_BEFORE) continue;
      const file = fileOf(hit);
      old.push({
        id: `M${page.pageid}`,
        title: plainText(meta.ObjectName?.value) ?? file.replace(IMAGE_FILE, ''),
        file,
        year,
        lon: round(hit.lon),
        lat: round(hit.lat),
        heading: null,
        creator: plainText(meta.Artist?.value),
        collection: null,
        iiif: null,
      });
    }
    if (!old.length) return;

    // Headings are only written in the {{Location}} template, so read the wikitext of the old ones.
    const wikitext = await api({
      action: 'query',
      pageids: old.map((v) => v.id.slice(1)).join('|'),
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
    });
    const headings = new Map(
      (wikitext.query?.pages ?? []).map((page) => [`M${page.pageid}`, headingIn(page.revisions?.[0]?.slots.main.content ?? '')]),
    );
    for (const view of old) view.heading = headings.get(view.id) ?? null;
    views.push(...old);
  });
  return views;
}

/** Camera heading from a {{Location}} or {{Camera location}} template, given in degrees or as a compass point. */
function headingIn(wikitext: string): number | null {
  const match = wikitext.match(
    /\{\{\s*(?:location(?: dec)?|camera location)\s*\|[^}]*?heading:\s*(-?\d+(?:\.\d+)?|[NESW]{1,3})\b/i,
  );
  if (!match) return null;
  const compass = COMPASS.indexOf(match[1].toUpperCase());
  if (compass >= 0) return compass * 22.5;
  return ((Number(match[1]) % 360) + 360) % 360;
}

async function api(params: Record<string, string>, { allowErrors = false } = {}): Promise<ApiResponse> {
  const query = new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params });
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}?${query}`, { headers: HEADERS });
    const json = res.ok ? ((await res.json()) as ApiResponse) : null;
    const retry = res.status === 429 || res.status >= 500 || json?.error?.code === 'maxlag';
    if (retry && attempt < MAX_RETRIES) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (!json) throw new Error(`Commons API request failed (HTTP ${res.status})`);
    if (json.error && !allowErrors) throw new Error(`Commons API error: ${json.error.info}`);
    return json;
  }
}

/** Runs `work` over a queue that the work itself may extend, with limited concurrency. */
async function drain<T>(queue: T[], work: (item: T) => Promise<void>) {
  let active = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length || active) {
        const item = queue.pop();
        if (item === undefined) {
          await sleep(50);
          continue;
        }
        active++;
        try {
          await work(item);
        } finally {
          active--;
        }
      }
    }),
  );
}

function split([s, w, n, e]: Tile): Tile[] {
  const midLat = (s + n) / 2;
  const midLon = (w + e) / 2;
  return [
    [s, w, midLat, midLon],
    [s, midLon, midLat, e],
    [midLat, w, n, midLon],
    [midLat, midLon, n, e],
  ];
}

// Helpers below are function declarations so the top-level loop above can use them before this point.

function fileOf(hit: GeoHit) {
  return hit.title.replace(/^File:/, '');
}

function round(degrees: number) {
  return Math.round(degrees * 1e6) / 1e6;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
