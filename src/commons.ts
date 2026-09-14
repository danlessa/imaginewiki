import { cached, HOUR } from './cache.ts';
import type { City } from './config.ts';
import type { View } from './wikidata.ts';

/** A Commons file offered to contributors, to locate (photographs) or georeference (maps). */
export interface CommonsFile {
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
  coordinates?: { lat: number; lon: number }[];
  revisions?: { slots: { main: { content: string } } }[];
}

const API = 'https://commons.wikimedia.org/w/api.php';
const FILE_PATH = 'https://commons.wikimedia.org/wiki/Special:FilePath/';
const YEAR = /\b(1[5-9]\d\d|20[0-2]\d)s?\b/;
const IMAGE_EXTENSION = /\.[a-z0-9]+$/i;
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
/** Search filters for bitmaps with neither a camera nor an object location, as a template or structured data. */
const UNLOCATED =
  'filetype:bitmap -hastemplate:Location -hastemplate:"Object location" -haswbstatement:P1259 -haswbstatement:P9149';
/** Search filter for bitmaps with a camera location template. */
const LOCATED = 'filetype:bitmap hastemplate:Location';
/** Search filter for maps that aren't georeferenced yet; Commons tags warped maps with this category. */
const NOT_GEOREFERENCED = 'filetype:bitmap -incategory:"Georeferenced_maps_in_Wikimaps_Warper"';
const SEARCH_BATCH = 50;
const FILES_PER_CATEGORY = 200;
const EDIT_SUMMARY = 'Camera location and heading from imagineWiki #imagineWiki';

export const commonsThumb = (file: string, width: number) => `${FILE_PATH}${encodeURIComponent(file)}?width=${width}`;

export const commonsPage = (file: string) =>
  `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replaceAll(' ', '_'))}`;

/** The file's edit page on Commons, with the edit summary filled in. */
export const commonsEditUrl = (file: string) =>
  `https://commons.wikimedia.org/w/index.php?${new URLSearchParams({ title: `File:${file}`, action: 'edit', summary: EDIT_SUMMARY })}`;

/** Wikimaps Warper's import page for a Commons map, where contributors georeference it. */
export const warperImportUrl = (file: CommonsFile) => `https://warper.wmflabs.org/wikimaps/new?pageid=${file.id.slice(1)}`;

/** The {{Location}} template for a camera position, which Commons uses to geocode the file. */
export function locationTemplate({ lat, lon, heading }: { lat: number; lon: number; heading: number }) {
  return `{{Location|${lat.toFixed(5)}|${lon.toFixed(5)}|heading:${Math.round(heading) % 360}}}`;
}

/** Camera heading from a {{Location}} or {{Camera location}} template, given in degrees or as a compass point. */
export function headingIn(wikitext: string): number | null {
  const match = wikitext.match(
    /\{\{\s*(?:location(?: dec)?|camera location)\s*\|[^}]*?heading:\s*(-?\d+(?:\.\d+)?|[NESW]{1,3})\b/i,
  );
  if (!match) return null;
  const compass = COMPASS.indexOf(match[1].toUpperCase());
  if (compass >= 0) return compass * 22.5;
  return ((Number(match[1]) % 360) + 360) % 360;
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

// Search results are cached briefly, so work contributors just finished shows up, or drops off lists, soon.

/** Photographs in the city's Commons categories that have no location, oldest first. */
export const loadLocateCandidates = (city: City) =>
  cached(`candidates:${city.id}`, HOUR, () => searchCategories(city.photoCategories, UNLOCATED));

/** Maps in the city's Commons categories that aren't on Wikimaps Warper yet, oldest first. */
export const loadGeoreferenceCandidates = (city: City) =>
  cached(`map-candidates:${city.id}`, HOUR, () => searchCategories(city.mapCategories, NOT_GEOREFERENCED));

/**
 * Photographs in the city's Commons categories that have a camera location, read live so locations added
 * through the Locate tab appear without waiting for the next Commons snapshot.
 */
export const loadLocatedViews = (city: City) =>
  cached(`located:${city.id}`, HOUR, async () => {
    const views = new Map<string, View>();
    for (const category of city.photoCategories) {
      for (const view of await searchLocated(`incategory:"${category}" ${LOCATED}`)) views.set(view.id, view);
    }
    return [...views.values()];
  });

async function searchCategories(categories: string[], filters: string): Promise<CommonsFile[]> {
  const found = new Map<string, CommonsFile>();
  for (const category of categories) {
    for (const page of await searchPages(`incategory:"${category}" ${filters}`)) {
      const meta = page.imageinfo?.[0]?.extmetadata ?? {};
      const file = page.title.replace(/^File:/, '');
      found.set(`M${page.pageid}`, {
        id: `M${page.pageid}`,
        title: plainText(meta.ObjectName?.value) ?? file.replace(IMAGE_EXTENSION, ''),
        file,
        year: fileYear(meta, file),
        creator: plainText(meta.Artist?.value),
      });
    }
  }
  return [...found.values()].sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity) || a.title.localeCompare(b.title));
}

async function searchLocated(query: string): Promise<View[]> {
  const pages = await searchPages(query, {
    prop: 'imageinfo|coordinates|revisions',
    coprimary: 'primary',
    colimit: 'max',
    rvprop: 'content',
    rvslots: 'main',
  });
  return pages.flatMap((page): View[] => {
    const position = page.coordinates?.[0];
    if (!position) return [];
    const meta = page.imageinfo?.[0]?.extmetadata ?? {};
    const file = page.title.replace(/^File:/, '');
    return [
      {
        id: `M${page.pageid}`,
        title: plainText(meta.ObjectName?.value) ?? file.replace(IMAGE_EXTENSION, ''),
        file,
        year: fileYear(meta, file),
        lon: position.lon,
        lat: position.lat,
        heading: headingIn(page.revisions?.[0]?.slots.main.content ?? ''),
        creator: plainText(meta.Artist?.value),
        collection: null,
        iiif: null,
      },
    ];
  });
}

/** Files matching a Commons search, with their metadata and any extra `props` requested. */
async function searchPages(query: string, props: Record<string, string> = {}): Promise<SearchPage[]> {
  const pages: SearchPage[] = [];
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
      gsrsearch: query,
      prop: 'imageinfo',
      iiprop: 'extmetadata',
      iiextmetadatafilter: 'DateTimeOriginal|ObjectName|Artist',
      ...props,
    });
    if (offset) params.set('gsroffset', String(offset));
    const res = await fetch(`${API}?${params}`);
    if (!res.ok) throw new Error(`Commons search failed (HTTP ${res.status})`);
    const json = (await res.json()) as { continue?: { gsroffset?: number }; query?: { pages: SearchPage[] } };
    pages.push(...(json.query?.pages ?? []));
    offset = json.continue?.gsroffset;
  } while (offset && pages.length < FILES_PER_CATEGORY);
  return pages;
}

/** Old files are often dated only in the file name, e.g. "Planta da Cidade de S. Paulo (1810)". */
function fileYear(meta: Record<string, { value: string } | undefined>, file: string) {
  return (meta.DateTimeOriginal ? commonsDateYear(meta.DateTimeOriginal.value) : null) ?? yearIn(file);
}
