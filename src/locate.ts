import { Marker, type GeoJSONSource, type Map, type MapMouseEvent } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { el } from './dom.ts';
import { cone } from './geo.ts';

/** A camera position, with the heading in degrees clockwise from north. */
export interface Placement {
  lon: number;
  lat: number;
  heading: number;
}

const SOURCE = 'placement';
const COLOR = '#c8553d';
/** Screen distance between the camera and the aiming handle, so the handle stays easy to grab at any zoom. */
const HANDLE_DISTANCE_PX = 80;
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** A draggable camera and aiming handle for choosing where a photograph was taken from. */
export class PlacementTool {
  active = false;
  private readonly map: Map;
  private camera: Marker | null = null;
  private handle: Marker | null = null;
  private heading = 0;
  private onChange: (placement: Placement) => void = () => {};

  constructor(map: Map) {
    this.map = map;
  }

  /** Waits for a map click to place the camera, then reports every change to the position or heading. */
  start(onChange: (placement: Placement) => void) {
    this.stop();
    this.active = true;
    this.heading = 0;
    this.onChange = onChange;
    if (!this.map.getSource(SOURCE)) {
      this.map.addSource(SOURCE, { type: 'geojson', data: EMPTY });
      this.map.addLayer({ id: SOURCE, type: 'fill', source: SOURCE, paint: { 'fill-color': COLOR, 'fill-opacity': 0.3 } });
      this.map.addLayer({
        id: `${SOURCE}-outline`,
        type: 'line',
        source: SOURCE,
        paint: { 'line-color': COLOR, 'line-width': 2 },
      });
    }
    this.map.getCanvas().style.cursor = 'crosshair';
    this.map.on('click', this.onMapClick);
    this.map.on('zoom', this.refresh);
    this.map.on('rotate', this.refresh);
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.map.off('click', this.onMapClick);
    this.map.off('zoom', this.refresh);
    this.map.off('rotate', this.refresh);
    this.camera?.remove();
    this.handle?.remove();
    this.camera = null;
    this.handle = null;
    (this.map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(EMPTY);
    this.map.getCanvas().style.cursor = '';
  }

  setHeading(heading: number) {
    this.heading = ((heading % 360) + 360) % 360;
    this.moveHandle();
    this.changed();
  }

  private onMapClick = (e: MapMouseEvent) => {
    // Markers sit above the canvas, so releasing a drag on one also reaches the map.
    if ((e.originalEvent.target as Element).closest('.maplibregl-marker')) return;
    if (this.camera) {
      this.camera.setLngLat(e.lngLat);
    } else {
      this.camera = new Marker({ element: el('div', { class: 'camera-marker' }), draggable: true })
        .setLngLat(e.lngLat)
        .addTo(this.map);
      this.handle = new Marker({ element: el('div', { class: 'aim-marker' }), draggable: true })
        .setLngLat(e.lngLat)
        .addTo(this.map);
      this.camera.on('drag', () => {
        this.moveHandle();
        this.changed();
      });
      this.handle.on('drag', this.aim);
      this.handle.on('dragend', this.refresh);
    }
    this.moveHandle();
    this.changed();
  };

  /** Turns the camera towards the handle while it is dragged. */
  private aim = () => {
    if (!this.camera || !this.handle) return;
    const camera = this.map.project(this.camera.getLngLat());
    const handle = this.map.project(this.handle.getLngLat());
    const screenAngle = (Math.atan2(handle.x - camera.x, camera.y - handle.y) * 180) / Math.PI;
    this.heading = (((screenAngle + this.map.getBearing()) % 360) + 360) % 360;
    this.changed();
  };

  private refresh = () => {
    this.moveHandle();
    this.draw();
  };

  /** Puts the handle at a fixed screen distance from the camera, along the heading. */
  private moveHandle() {
    if (!this.camera || !this.handle) return;
    const camera = this.map.project(this.camera.getLngLat());
    const angle = ((this.heading - this.map.getBearing()) * Math.PI) / 180;
    this.handle.setLngLat(
      this.map.unproject([camera.x + HANDLE_DISTANCE_PX * Math.sin(angle), camera.y - HANDLE_DISTANCE_PX * Math.cos(angle)]),
    );
  }

  /** Draws the view cone out to the handle. */
  private draw() {
    if (!this.camera || !this.handle) return;
    const position = this.camera.getLngLat();
    (this.map.getSource(SOURCE) as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [cone(position.lng, position.lat, this.heading, position.distanceTo(this.handle.getLngLat()))],
          },
        },
      ],
    });
  }

  private changed() {
    if (!this.camera) return;
    this.draw();
    const { lng, lat } = this.camera.getLngLat();
    this.onChange({ lon: lng, lat, heading: this.heading });
  }
}
