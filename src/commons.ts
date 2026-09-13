import { cached, HOUR } from './cache.ts';
import type { City } from './config.ts';
import type { View } from './wikidata.ts';

/** An old photograph on Commons with no location yet, offered in the Locate tab. */
export interface LocateCandidate {
  /** Commons MediaInfo id (M…). */
  id: string;
  title: string;
  file: string;
  year: number | null;
  creator: string | null;
}

interface SearchPage {
  pageid: number;
  title: string;
  imageinfo?: { extmetadata?: Record<string, { value: string } | undefined> }[];
}

const API = 'https://commons.wikimedia.org/w/api.php';
const FILE_PATH = 'https://commons.wikimedia.org/wiki/Special:FilePath/';
const YEAR = /\b(1[5-9]\d\d|20[0-2]\d)s?\b/;
/** Search filters for bitmaps with neither a camera nor an object location, as a template or structured data. */
const UNLOCATED =
  'filetype:bitmap -hastemplate:Location -hastemplate:"Object location" -haswbstatement:P1259 -haswbstatement:P9149';
const SEARCH_BATCH = 50;
const CANDIDATES_PER_CATEGORY = 200;
const EDIT_SUMMARY = 'Camera location and heading from imagineWiki #imagineWiki';

export const commonsThumb = (file: string, width: number) => `${FILE_PATH}${encodeURIComponent(file)}?width=${width}`;

export const commonsPage = (file: string) =>
  `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replaceAll(' ', '_'))}`;

/** The file's edit page on Commons, with the edit summary filled in. */
export const commonsEditUrl = (file: string) =>
  `https://commons.wikimedia.org/w/index.php?${new URLSearchParams({ title: `File:${file}`, action: 'edit', summary: EDIT_SUMMARY })}`;

/** The {{Location}} template for a camera position, which Commons uses to geocode the file. */
export function locationTemplate({ lat, lon, heading }: { lat: number; lon: number; heading: number }) {
  return `{{Location|${lat.toFixed(5)}|${lon.toFixed(5)}|heading:${Math.round(heading) % 360}}}`;
}

/** First plausible year (1500–2029) in a piece of text; a decade such as "1920s" counts as its first year. */
export function yearIn(text: string): number | null {
  const match = text.match(YEAR);
  return match ? Number(match[1]) : null;
}

/**
 * Year of a Commons DateTimeOriginal value, or null when the date only describes the digital file
 * (Exif data or a full timestamp) rather than when the picture was made.
 */
export function commonsDateYear(html: string): number | null {
  // Drop the hidden QuickStatements payload that {{Other date}} renders after the readable text.
  const text = html.replace(/<[^>]*>/g, ' ').split('date QS:')[0];
  if (/exif|\d\d:\d\d/i.test(text)) return null;
  return yearIn(text);
}

/** Text content of a Commons metadata value, which may contain HTML. */
export function plainText(html: string | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<[^>]*>/g, ' ')
    // Drop the hidden QuickStatements payloads that {{Artwork}} and {{Other date}} render after the visible text.
    .split(/\b(?:label|date) QS:/)[0]
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  // Some templates render a name twice, once visibly and once in a hidden span.
  const words = text.split(' ');
  const half = words.length / 2;
  if (Number.isInteger(half) && words.slice(0, half).join(' ') === words.slice(half).join(' ')) {
    return words.slice(0, half).join(' ') || null;
  }
  return text || null;
}

/** Photographs found only on Commons, collected ahead of time by scripts/snapshot-commons.ts. */
export async function loadCommonsViews(city: City): Promise<View[]> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/commons-views-${city.id}.json`);
    return res.ok ? ((await res.json()) as View[]) : [];
  } catch (error) {
    console.warn(`No Commons photographs for ${city.name}`, error);
    return [];
  }
}

/** Photographs in the city's Commons categories that have no location, oldest first. */
export const loadLocateCandidates = (city: City) =>
  // Short-lived, so photographs that were just located drop off the list soon.
  cached(`candidates:${city.id}`, HOUR, async () => {
    const found = new Map<string, LocateCandidate>();
    for (const category of city.photoCategories) {
      for (const candidate of await searchUnlocated(category)) found.set(candidate.id, candidate);
    }
    return [...found.values()].sort(
      (a, b) => (a.year ?? Infinity) - (b.year ?? Infinity) || a.title.localeCompare(b.title),
    );
  });

async function searchUnlocated(category: string): Promise<LocateCandidate[]> {
  const candidates: LocateCandidate[] = [];
  let offset: number | undefined;
  do {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      origin: '*',
      generator: 'search',
      gsrnamespace: '6',
      gsrlimit: String(SEARCH_BATCH),
      gsrsearch: `incategory:"${category}" ${UNLOCATED}`,
      prop: 'imageinfo',
      iiprop: 'extmetadata',
      iiextmetadatafilter: 'DateTimeOriginal|ObjectName|Artist',
    });
    if (offset) params.set('gsroffset', String(offset));
    const res = await fetch(`${API}?${params}`);
    if (!res.ok) throw new Error(`Commons search failed (HTTP ${res.status})`);
    const json = (await res.json()) as { continue?: { gsroffset: number }; query?: { pages: SearchPage[] } };

    for (const page of json.query?.pages ?? []) {
      const meta = page.imageinfo?.[0]?.extmetadata ?? {};
      const file = page.title.replace(/^File:/, '');
      candidates.push({
        id: `M${page.pageid}`,
        title: plainText(meta.ObjectName?.value) ?? file.replace(/\.[a-z0-9]+$/i, ''),
        file,
        year: meta.DateTimeOriginal ? commonsDateYear(meta.DateTimeOriginal.value) : null,
        creator: plainText(meta.Artist?.value),
      });
    }
    offset = json.continue?.gsroffset;
  } while (offset && candidates.length < CANDIDATES_PER_CATEGORY);
  return candidates;
}
