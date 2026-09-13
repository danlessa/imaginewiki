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
  /** Commons categories of old photographs of the city, offered in the Locate tab when they lack a location. */
  photoCategories: string[];
}

/** The first city is the default. */
export const CITIES: City[] = [
  {
    id: 'sao-paulo',
    name: 'São Paulo',
    center: [-46.634, -23.548],
    zoom: 14,
    bbox: [-46.85, -24.01, -46.36, -23.35],
    photoCategories: [
      'Photographs of São Paulo by Guilherme Gaensly',
      'Álbum Comparativo da Cidade de S. Paulo 1862-1887',
      'Photographs by Aurélio Becherini in the Museu da Cidade de São Paulo',
    ],
  },
  {
    id: 'rio',
    name: 'Rio de Janeiro',
    center: [-43.1822, -22.9068],
    zoom: 14,
    // Covers the city plus the bay, so whole-city maps fit inside it.
    bbox: [-43.85, -23.2, -42.9, -22.6],
    photoCategories: ['Photographs by Augusto Malta', 'Photographs by Marc Ferrez'],
  },
];

export const DEFAULT_CITY = CITIES[0];

export const OHM_STYLE = 'https://www.openhistoricalmap.org/map-styles/main/main.json';

export const LANG = navigator.language.toLowerCase().startsWith('pt') ? 'pt' : 'en';
export const LABEL_LANGUAGES = LANG === 'pt' ? 'pt,en,mul' : 'en,pt,mul';
