import { cached, DAY } from './cache.ts';
import { commonsDateYear, yearIn } from './commons.ts';
import type { City } from './config.ts';

/** A Commons map georeferenced on Wikimaps Warper. */
export interface HistoricMap {
  id: string;
  title: string;
  year: number | null;
  bbox: [number, number, number, number];
  tiles: string;
  /** Commons file name, without the File: prefix. */
  file: string;
  commons: string;
}

interface WarperMap {
  id: string;
  attributes: { title: string; status: string; bbox: string | null; source_uri: string };
  links: { tiles: string };
}

interface CommonsPage {
  title: string;
  imageinfo?: { extmetadata?: { DateTimeOriginal?: { value: string } } }[];
}

const WARPER_API = 'https://warper.wmflabs.org/api/v1/maps';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const COMMONS_BATCH = 50;

/** Live maps from Warper, falling back to the city's snapshot in public/data when Warper is unreachable. */
export const loadHistoricMaps = (city: City) =>
  cached(`maps:${city.id}`, DAY, async () => {
    try {
      return await fetchHistoricMaps(city.bbox);
    } catch (error) {
      console.warn('Warper unavailable, using snapshot', error);
      const res = await fetch(`${import.meta.env.BASE_URL}data/warper-maps-${city.id}.json`);
      if (!res.ok) throw error;
      return (await res.json()) as HistoricMap[];
    }
  });

/** Warped maps lying entirely inside `bbox` (west, south, east, north). */
export async function fetchHistoricMaps(bbox: City['bbox'], init: RequestInit = {}): Promise<HistoricMap[]> {
  const url = `${WARPER_API}?format=json&per_page=100&operation=within&bbox=${bbox.join(',')}`;
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Warper request failed (HTTP ${res.status})`);
  const { data } = (await res.json()) as { data: WarperMap[] };

  const warped = data.filter((m) => m.attributes.status === 'warped' && m.attributes.bbox);
  const dates = await commonsYears(
    warped.map((m) => m.attributes.title),
    init,
  );

  return warped
    .map((m) => ({
      id: m.id,
      title: m.attributes.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''),
      // A year in the file name is usually the map's own date; Commons metadata is the fallback.
      year: yearIn(m.attributes.title) ?? dates.get(m.attributes.title) ?? null,
      bbox: m.attributes.bbox!.split(',').map(Number) as HistoricMap['bbox'],
      tiles: m.links.tiles,
      file: m.attributes.title.replace(/^File:/, ''),
      commons: m.attributes.source_uri,
    }))
    .sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity) || a.title.localeCompare(b.title));
}

async function commonsYears(titles: string[], init: RequestInit): Promise<Map<string, number>> {
  const years = new Map<string, number>();
  for (let i = 0; i < titles.length; i += COMMONS_BATCH) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      origin: '*',
      prop: 'imageinfo',
      iiprop: 'extmetadata',
      iiextmetadatafilter: 'DateTimeOriginal',
      titles: titles.slice(i, i + COMMONS_BATCH).join('|'),
    });
    const res = await fetch(`${COMMONS_API}?${params}`, init);
    if (!res.ok) continue;
    const json = (await res.json()) as {
      query?: { normalized?: { from: string; to: string }[]; pages?: Record<string, CommonsPage> };
    };
    const originalTitle = new Map(json.query?.normalized?.map((n) => [n.to, n.from]));
    for (const page of Object.values(json.query?.pages ?? {})) {
      const raw = page.imageinfo?.[0]?.extmetadata?.DateTimeOriginal?.value;
      const year = raw ? commonsDateYear(raw) : null;
      if (year != null) years.set(originalTitle.get(page.title) ?? page.title, year);
    }
  }
  return years;
}
