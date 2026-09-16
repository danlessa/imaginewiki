import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import type { HistoricMap } from './config.ts';
import type { Landmark, View } from './wikidata.ts';

/** Year given to undated features so year-range filters exclude them. */
export const UNDATED = -99999;
/** End year given to features that still exist. */
export const ONGOING = 99999;

const CONE_FOV = 60;
const CONE_RANGE_METRES = 120;
const CONE_STEPS = 8;
const METRES_PER_DEGREE = 111_320;

type Collection = FeatureCollection<Geometry>;

// Feature ids are array indices so feature-state and list items can refer to the same record.

/** Feature ids are indices into the whole list, so photographs and paintings share one numbering. */
export function viewPoints(views: View[], kind: View['kind'] = 'photograph'): Collection {
  const features: Feature[] = [];
  views.forEach((v, i) => {
    if ((v.kind ?? 'photograph') !== kind) return;
    features.push({
      type: 'Feature',
      id: i,
      properties: { year: v.year ?? UNDATED },
      geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
    });
  });
  return { type: 'FeatureCollection', features };
}

export function viewCones(views: View[]): Collection {
  const features: Feature[] = [];
  views.forEach((v, i) => {
    if (v.heading == null || (v.kind ?? 'photograph') !== 'photograph') return;
    features.push({
      type: 'Feature',
      id: i,
      properties: { year: v.year ?? UNDATED },
      geometry: { type: 'Polygon', coordinates: [cone(v.lon, v.lat, v.heading)] },
    });
  });
  return { type: 'FeatureCollection', features };
}

export function landmarkPoints(landmarks: Landmark[]): Collection {
  return {
    type: 'FeatureCollection',
    features: landmarks.map((l, i) => ({
      type: 'Feature',
      id: i,
      properties: { title: l.title, start: l.start, end: l.end ?? ONGOING },
      geometry: { type: 'Point', coordinates: [l.lon, l.lat] },
    })),
  };
}

export function mapFootprints(maps: HistoricMap[]): Collection {
  return {
    type: 'FeatureCollection',
    features: maps.map((m, i) => {
      const [w, s, e, n] = m.bbox;
      return {
        type: 'Feature',
        id: i,
        properties: {},
        geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
      };
    }),
  };
}

/** A field-of-view wedge in front of the camera, with the heading measured clockwise from north. */
export function cone(lon: number, lat: number, heading: number, range = CONE_RANGE_METRES): Position[] {
  const metresPerDegreeLon = METRES_PER_DEGREE * Math.cos((lat * Math.PI) / 180);
  const ring: Position[] = [[lon, lat]];
  for (let step = 0; step <= CONE_STEPS; step++) {
    const angle = ((heading - CONE_FOV / 2 + (CONE_FOV * step) / CONE_STEPS) * Math.PI) / 180;
    ring.push([
      lon + (range * Math.sin(angle)) / metresPerDegreeLon,
      lat + (range * Math.cos(angle)) / METRES_PER_DEGREE,
    ]);
  }
  ring.push([lon, lat]);
  return ring;
}
