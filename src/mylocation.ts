import { Geolocation, type Position } from '@capacitor/geolocation';
import { Marker, type IControl, type Map as MapLibreMap } from 'maplibre-gl';
import { CITIES, type City } from './config.ts';
import { el } from './dom.ts';

const NOTICE_MS = 12000;
const MIN_ZOOM = 16;

const LOCATION_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/></svg>';

const contains = ([west, south, east, north]: City['bbox'], [lng, lat]: [number, number]) =>
  lng >= west && lng <= east && lat >= south && lat <= north;

/**
 * Shows the reader's position on the map. Native apps ask through the system location prompt;
 * the website falls back to the browser's. The position never leaves the device.
 */
export class MyLocationControl implements IControl {
  private map: MapLibreMap | null = null;
  private button: HTMLButtonElement | null = null;
  private notice: HTMLElement | null = null;
  private noticeTimer = 0;
  private marker: Marker | null = null;
  private watchId: string | null = null;
  /** Each start gets a new number, so a fix that arrives after stopping is ignored. */
  private session = 0;

  private readonly city: City;
  /** Reopens the atlas on another city, centred on the reader. */
  private readonly switchCity: (city: City, at: [number, number]) => void;

  constructor(city: City, switchCity: (city: City, at: [number, number]) => void) {
    this.city = city;
    this.switchCity = switchCity;
  }

  onAdd(map: MapLibreMap): HTMLElement {
    this.map = map;
    map.on('mousedown', this.hideNotice);
    map.on('touchstart', this.hideNotice);
    this.button = el('button', { type: 'button', class: 'my-location-toggle', title: 'Show my location', 'aria-label': 'Show my location', 'aria-pressed': 'false' });
    this.button.innerHTML = LOCATION_ICON;
    this.button.addEventListener('click', () => (this.watchId != null || this.button?.classList.contains('pending') ? this.stop() : void this.start()));
    this.notice = el('div', { class: 'my-location-notice', role: 'status', hidden: true });
    return el('div', { class: 'maplibregl-ctrl my-location-control' }, el('div', { class: 'maplibregl-ctrl-group' }, this.button), this.notice);
  }

  onRemove() {
    this.stop();
    this.map?.off('mousedown', this.hideNotice);
    this.map?.off('touchstart', this.hideNotice);
    this.button?.closest('.my-location-control')?.remove();
    this.map = this.button = this.notice = null;
  }

  private async start() {
    const session = ++this.session;
    this.setState('pending');
    let first = true;
    try {
      const id = await Geolocation.watchPosition({ enableHighAccuracy: true }, (position, error) => {
        if (session !== this.session) return;
        if (!position) return this.fail(error);
        this.update(position, first);
        first = false;
      });
      if (session === this.session) this.watchId = id;
      else void Geolocation.clearWatch({ id });
    } catch (error) {
      if (session === this.session) this.fail(error);
    }
  }

  private stop() {
    this.session++;
    if (this.watchId != null) void Geolocation.clearWatch({ id: this.watchId });
    this.watchId = null;
    this.marker?.remove();
    this.marker = null;
    this.setState('off');
  }

  private update(position: Position, first: boolean) {
    const at: [number, number] = [position.coords.longitude, position.coords.latitude];
    if (first && !contains(this.city.bbox, at)) {
      this.stop();
      const other = CITIES.find((c) => contains(c.bbox, at));
      if (other) {
        this.showNotice(
          `You're in ${other.name}. `,
          el('button', { type: 'button', class: 'link-btn', onclick: () => this.switchCity(other, at) }, `Switch to ${other.name}`),
        );
      } else {
        this.showNotice(`You're outside the atlas, which covers ${CITIES.map((c) => c.name).join(' and ')} so far.`);
      }
      return;
    }
    if (this.marker) this.marker.setLngLat(at);
    else this.marker = new Marker({ element: el('div', { class: 'my-location-dot', 'aria-label': 'Your location' }) }).setLngLat(at).addTo(this.map!);
    if (first) {
      this.setState('on');
      this.map?.flyTo({ center: at, zoom: Math.max(this.map.getZoom(), MIN_ZOOM) });
    }
  }

  private fail(error: unknown) {
    console.warn('Location unavailable', error);
    this.stop();
    this.showNotice("Couldn't find your location. Check that location is turned on and that imagineWiki may use it.");
  }

  private setState(state: 'off' | 'pending' | 'on') {
    if (!this.button) return;
    this.button.classList.toggle('pending', state === 'pending');
    this.button.classList.toggle('active', state === 'on');
    this.button.setAttribute('aria-pressed', String(state !== 'off'));
  }

  private showNotice(...content: (string | HTMLElement)[]) {
    if (!this.notice) return;
    this.notice.replaceChildren(...content);
    this.notice.hidden = false;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(this.hideNotice, NOTICE_MS);
  }

  private hideNotice = () => {
    if (this.notice) this.notice.hidden = true;
  };
}
