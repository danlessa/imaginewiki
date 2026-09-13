declare module '@openhistoricalmap/maplibre-gl-dates' {
  import type { Map } from 'maplibre-gl';

  export function filterByDate(map: Map, date: string | Date): void;
}
