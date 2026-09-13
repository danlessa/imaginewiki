export const MIN_YEAR = 1502;
export const MAX_YEAR = new Date().getFullYear();
export const DEFAULT_YEAR = 1900;

export interface City {
  id: string;
  name: string;
  center: [number, number];
  zoom: number;
  /** West, south, east, north. Photographs, landmarks and maps are limited to this box. */
  bbox: [number, number, number, number];
}

/** The first city is the default. */
export const CITIES: City[] = [
  {
    id: 'sao-paulo',
    name: 'São Paulo',
    center: [-46.634, -23.548],
    zoom: 14,
    bbox: [-46.85, -24.01, -46.36, -23.35],
  },
  {
    id: 'rio',
    name: 'Rio de Janeiro',
    center: [-43.1822, -22.9068],
    zoom: 14,
    // Covers the city plus the bay, so whole-city maps fit inside it.
    bbox: [-43.85, -23.2, -42.9, -22.6],
  },
];

export const DEFAULT_CITY = CITIES[0];

export const OHM_STYLE = 'https://www.openhistoricalmap.org/map-styles/main/main.json';

export const LANG = navigator.language.toLowerCase().startsWith('pt') ? 'pt' : 'en';
export const LABEL_LANGUAGES = LANG === 'pt' ? 'pt,en,mul' : 'en,pt,mul';
