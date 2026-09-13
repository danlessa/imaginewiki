import { filterByDate } from '@openhistoricalmap/maplibre-gl-dates';
import type { Map } from 'maplibre-gl';

const PAPER = '#f3efe6';
const WATER = '#c5d6db';

/** Shows only OpenHistoricalMap features that existed at some point during `year`. */
export function applyDateFilter(map: Map, year: number) {
  filterByDate(map, String(year));
}

/** Tones the OHM style down to a paper-and-ink palette so photographs and overlays stand out. */
export function softenBasemap(map: Map) {
  const paint = (layer: string, property: Parameters<Map['setPaintProperty']>[1], value: string) => {
    if (map.getLayer(layer)) map.setPaintProperty(layer, property, value);
  };
  paint('background', 'background-color', WATER);
  paint('land', 'fill-color', PAPER);
  for (const layer of ['water_areas', 'water_areas_ne', 'landuse_areas_z12_watercover']) {
    paint(layer, 'fill-color', WATER);
  }
}

/** A font stack the style's glyph server can serve. */
export function styleFont(map: Map): string[] {
  for (const layer of map.getStyle().layers) {
    const font = layer.type === 'symbol' ? layer.layout?.['text-font'] : undefined;
    if (Array.isArray(font) && font.every((f) => typeof f === 'string')) return font as string[];
  }
  return ['OpenHistorical Bold'];
}
