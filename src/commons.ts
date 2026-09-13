import type { City } from './config.ts';
import type { View } from './wikidata.ts';

const FILE_PATH = 'https://commons.wikimedia.org/wiki/Special:FilePath/';
const YEAR = /\b(1[5-9]\d\d|20[0-2]\d)s?\b/;

export const commonsThumb = (file: string, width: number) => `${FILE_PATH}${encodeURIComponent(file)}?width=${width}`;

export const commonsPage = (file: string) =>
  `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replaceAll(' ', '_'))}`;

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
