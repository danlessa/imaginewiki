import type { IControl, Map, RasterSourceSpecification } from 'maplibre-gl';
import type { RasterLayer } from './config.ts';
import { el } from './dom.ts';

type PaintProperty = Parameters<Map['setPaintProperty']>[1];
type PaintValue = Parameters<Map['setPaintProperty']>[2];

/** Stack id of the OpenHistoricalMap basemap, which is a whole vector style rather than one raster layer. */
const BASEMAP = 'openhistoricalmap';
const DEFAULT_OPACITY = 0.85;
const STORAGE_PREFIX = 'imaginewiki:layers:v1:';

/** Opacity paint properties per style layer type, used to fade the whole basemap. */
const OPACITY_PROPERTIES: Record<string, PaintProperty[]> = {
  background: ['background-opacity'],
  fill: ['fill-opacity'],
  line: ['line-opacity'],
  symbol: ['icon-opacity', 'text-opacity'],
  circle: ['circle-opacity', 'circle-stroke-opacity'],
  raster: ['raster-opacity'],
  'fill-extrusion': ['fill-extrusion-opacity'],
};

const LAYERS_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M12 3 2 8l10 5 10-5-10-5Z"/><path d="m2 13 10 5 10-5"/><path d="m2 18 10 5 10-5"/></svg>';

interface Entry {
  id: string;
  title: string;
  visible: boolean;
  opacity: number;
  /** Absent for the basemap. */
  layer?: RasterLayer;
  /** Added from Maps & Plans; leaves the stack again when hidden. */
  temporary: boolean;
}

interface BasemapLayer {
  id: string;
  visibility: 'visible' | 'none';
  /** Each opacity paint property with the value the style gave it. */
  opacity: [property: PaintProperty, value: unknown][];
}

interface Saved {
  order: string[];
  visible: Record<string, boolean>;
  opacity: Record<string, number>;
}

const mapLayerId = (id: string) => `layer-${id}`;

/**
 * The map's layer panel: every raster layer and the OpenHistoricalMap basemap in one stack, top of the list drawn
 * on top, each with visibility and opacity. Order and settings persist per city in this browser.
 */
export class LayerStack implements IControl {
  /** Called after layers are shown, hidden or reordered, so lists showing layer state can refresh. */
  onChange: () => void = () => {};

  private readonly map: Map;
  private readonly storageKey: string;
  /** Lowest imagineWiki data layer; raster layers above the basemap go right under it. */
  private readonly dataBottom: string;
  private readonly defaults: Entry[];
  private readonly basemapLayers: BasemapLayer[];
  /** Top of the stack first. */
  private entries: Entry[];
  private panel: HTMLElement | null = null;
  private toggle: HTMLButtonElement | null = null;

  constructor(map: Map, options: { key: string; layers: RasterLayer[]; basemapTitle: string; dataBottom: string }) {
    this.map = map;
    this.storageKey = STORAGE_PREFIX + options.key;
    this.dataBottom = options.dataBottom;
    // Built before imagineWiki adds its own layers, so every style layer so far belongs to the basemap.
    this.basemapLayers = map.getStyle().layers.map(
      (layer): BasemapLayer => ({
        id: layer.id,
        visibility: layer.layout?.visibility === 'none' ? 'none' : 'visible',
        opacity: (OPACITY_PROPERTIES[layer.type] ?? []).map((property) => [property, map.getPaintProperty(layer.id, property)]),
      }),
    );
    this.defaults = [
      ...options.layers.map((layer) => ({
        id: layer.id,
        title: layer.title,
        visible: false,
        opacity: layer.opacity ?? DEFAULT_OPACITY,
        layer,
        temporary: false,
      })),
      { id: BASEMAP, title: options.basemapTitle, visible: true, opacity: 1, temporary: false },
    ];
    this.entries = this.restore();
  }

  isVisible(id: string) {
    return this.entries.some((entry) => entry.id === id && entry.visible);
  }

  opacityOf(id: string) {
    return this.entries.find((entry) => entry.id === id)?.opacity ?? DEFAULT_OPACITY;
  }

  /** Shows a layer, adding it to the top of the stack if it isn't there yet. */
  show(layer: RasterLayer) {
    const entry = this.entries.find((e) => e.id === layer.id);
    if (entry) {
      entry.visible = true;
    } else {
      this.entries.unshift({
        id: layer.id,
        title: layer.title,
        visible: true,
        opacity: layer.opacity ?? DEFAULT_OPACITY,
        layer,
        temporary: true,
      });
    }
    this.update();
  }

  hide(id: string) {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    if (entry.temporary) {
      this.entries = this.entries.filter((e) => e !== entry);
      this.removeFromMap(entry);
    } else {
      entry.visible = false;
    }
    this.update();
  }

  /** Changes opacity without re-rendering, so a slider being dragged keeps working. */
  setOpacity(id: string, opacity: number) {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    entry.opacity = opacity;
    if (entry.layer) this.paintRaster(entry);
    else this.fadeBasemap(opacity);
    this.save();
    for (const control of this.panel?.querySelectorAll<HTMLElement>(`[data-layer="${CSS.escape(id)}"]`) ?? []) {
      const percent = Math.round(opacity * 100);
      if (control instanceof HTMLInputElement && document.activeElement !== control) control.value = String(percent);
      if (control instanceof HTMLOutputElement) control.textContent = `${percent}%`;
    }
  }

  /** Brings the map in line with the stack: raster order, visibility and opacity, and the basemap's. */
  apply() {
    if (!this.map.getLayer(this.dataBottom)) return;
    const basemapBottom = this.basemapLayers[0]?.id;
    let aboveBasemap = false;
    // Walking up from the bottom, each raster moves right under a fixed anchor, which keeps the stack order:
    // under the basemap's lowest layer until the basemap is passed, then under imagineWiki's data layers.
    for (const entry of [...this.entries].reverse()) {
      if (!entry.layer) {
        aboveBasemap = true;
        this.applyBasemap(entry);
        continue;
      }
      if (entry.visible) this.addToMap(entry);
      const id = mapLayerId(entry.id);
      if (!this.map.getLayer(id)) continue;
      this.map.moveLayer(id, aboveBasemap || !basemapBottom ? this.dataBottom : basemapBottom);
      this.map.setLayoutProperty(id, 'visibility', entry.visible ? 'visible' : 'none');
      this.paintRaster(entry);
    }
  }

  onAdd(): HTMLElement {
    this.toggle = el('button', { type: 'button', class: 'layer-toggle', title: 'Layers', 'aria-label': 'Layers', 'aria-expanded': 'false' });
    this.toggle.innerHTML = LAYERS_ICON;
    this.toggle.addEventListener('click', () => this.setOpen(Boolean(this.panel?.hidden)));
    this.panel = el('div', { class: 'layer-panel', hidden: true });
    this.panel.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      this.setOpen(false);
      this.toggle?.focus();
    });
    this.render();
    return el('div', { class: 'maplibregl-ctrl layer-control' }, el('div', { class: 'maplibregl-ctrl-group' }, this.toggle), this.panel);
  }

  onRemove() {
    this.toggle?.closest('.layer-control')?.remove();
    this.toggle = null;
    this.panel = null;
  }

  private setOpen(open: boolean) {
    if (!this.panel || !this.toggle) return;
    this.panel.hidden = !open;
    this.toggle.setAttribute('aria-expanded', String(open));
  }

  private setVisible(id: string, visible: boolean) {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    if (!visible && entry.temporary) return this.hide(id);
    entry.visible = visible;
    this.update();
  }

  private move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= this.entries.length) return;
    const moved = this.entries[index];
    [this.entries[index], this.entries[target]] = [this.entries[target], moved];
    this.update();
    // Re-rendering drops focus; put it back on the arrow just used, or the other one at either end.
    const buttons = this.panel?.querySelectorAll<HTMLButtonElement>(`button[data-move][data-layer="${CSS.escape(moved.id)}"]`);
    const [up, down] = [...(buttons ?? [])];
    (delta < 0 ? (up?.disabled ? down : up) : down?.disabled ? up : down)?.focus();
  }

  private resetOrder() {
    const permanent = this.defaults.map((d) => this.entries.find((e) => e.id === d.id)!);
    this.entries = [...this.entries.filter((e) => e.temporary), ...permanent];
    this.update();
  }

  private update() {
    this.apply();
    this.save();
    this.render();
    this.onChange();
  }

  private addToMap({ id, layer }: Entry) {
    const mapId = mapLayerId(id);
    if (!layer || this.map.getSource(mapId)) return;
    const source: RasterSourceSpecification = {
      type: 'raster',
      tiles: [layer.tiles],
      tileSize: 256,
      scheme: layer.scheme ?? 'xyz',
      attribution: layer.attribution,
    };
    if (layer.bbox) source.bounds = layer.bbox;
    if (layer.minzoom != null) source.minzoom = layer.minzoom;
    if (layer.maxzoom != null) source.maxzoom = layer.maxzoom;
    this.map.addSource(mapId, source);
    this.map.addLayer({ id: mapId, type: 'raster', source: mapId, layout: { visibility: 'none' } }, this.dataBottom);
  }

  private removeFromMap({ id }: Entry) {
    const mapId = mapLayerId(id);
    if (this.map.getLayer(mapId)) this.map.removeLayer(mapId);
    if (this.map.getSource(mapId)) this.map.removeSource(mapId);
  }

  private paintRaster(entry: Entry) {
    const id = mapLayerId(entry.id);
    if (this.map.getLayer(id)) this.map.setPaintProperty(id, 'raster-opacity', entry.opacity);
  }

  private applyBasemap(entry: Entry) {
    for (const layer of this.basemapLayers) {
      this.map.setLayoutProperty(layer.id, 'visibility', entry.visible ? layer.visibility : 'none');
    }
    this.fadeBasemap(entry.opacity);
  }

  private fadeBasemap(opacity: number) {
    for (const layer of this.basemapLayers) {
      for (const [property, original] of layer.opacity) {
        const faded = scaleOpacity(original, opacity);
        if (faded !== undefined) this.map.setPaintProperty(layer.id, property, faded as PaintValue);
      }
    }
  }

  private render() {
    if (!this.panel) return;
    const last = this.entries.length - 1;
    const rows = this.entries.map((entry, index) => {
      const percent = Math.round(entry.opacity * 100);
      const slider = el('input', {
        type: 'range',
        min: 0,
        max: 100,
        step: 5,
        value: percent,
        'data-layer': entry.id,
        'aria-label': `${entry.title} opacity`,
      });
      slider.addEventListener('input', () => this.setOpacity(entry.id, Number(slider.value) / 100));
      const moveButton = (delta: -1 | 1) =>
        el(
          'button',
          {
            type: 'button',
            'data-move': delta < 0 ? 'up' : 'down',
            'data-layer': entry.id,
            title: delta < 0 ? 'Move up' : 'Move down',
            'aria-label': `Move ${entry.title} ${delta < 0 ? 'up' : 'down'}`,
            disabled: delta < 0 ? index === 0 : index === last,
            onclick: () => this.move(index, delta),
          },
          delta < 0 ? '↑' : '↓',
        );
      return el(
        'li',
        { class: `layer-row${entry.visible ? '' : ' off'}` },
        el(
          'div',
          { class: 'layer-head' },
          el(
            'label',
            { class: 'layer-name' },
            el('input', {
              type: 'checkbox',
              checked: entry.visible,
              onchange: (e: Event) => this.setVisible(entry.id, (e.target as HTMLInputElement).checked),
            }),
            el('span', {}, entry.title),
          ),
          el('div', { class: 'layer-move' }, moveButton(-1), moveButton(1)),
        ),
        el('div', { class: 'layer-opacity' }, slider, el('output', { 'data-layer': entry.id }, `${percent}%`)),
      );
    });
    this.panel.replaceChildren(
      el('h3', {}, 'Layers'),
      el('p', { class: 'layer-hint' }, 'Layers higher in the list are drawn on top.'),
      el('ul', { class: 'layer-list' }, ...rows),
      el('div', { class: 'layer-footer' }, el('button', { type: 'button', class: 'text-btn', onclick: () => this.resetOrder() }, 'Reset order')),
    );
  }

  /** Saved settings over the defaults: the saved order first, layers added since then at their default position. */
  private restore(): Entry[] {
    const entries = this.defaults.map((entry) => ({ ...entry }));
    let saved: Saved | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(this.storageKey) ?? 'null') as Saved | null;
    } catch {
      // Storage unavailable or corrupt entry.
    }
    if (!saved) return entries;
    for (const entry of entries) {
      entry.visible = saved.visible?.[entry.id] ?? entry.visible;
      entry.opacity = saved.opacity?.[entry.id] ?? entry.opacity;
    }
    const known = new Set(entries.map((entry) => entry.id));
    const order = (saved.order ?? []).filter((id, i, all) => known.has(id) && all.indexOf(id) === i);
    entries.forEach((entry, index) => {
      if (!order.includes(entry.id)) order.splice(Math.min(index, order.length), 0, entry.id);
    });
    return order.map((id) => entries.find((entry) => entry.id === id)!);
  }

  private save() {
    const permanent = this.entries.filter((entry) => !entry.temporary);
    const saved: Saved = {
      order: permanent.map((entry) => entry.id),
      visible: Object.fromEntries(permanent.map((entry) => [entry.id, entry.visible])),
      opacity: Object.fromEntries(permanent.map((entry) => [entry.id, entry.opacity])),
    };
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(saved));
    } catch {
      // Quota exceeded or storage blocked.
    }
  }
}

/**
 * A style opacity value multiplied by `factor`: plain numbers, zoom curves stop by stop and legacy stop functions.
 * Returns undefined for expressions it can't scale safely, which are then left as they are.
 */
function scaleOpacity(value: unknown, factor: number): unknown {
  if (value === undefined) return factor;
  if (typeof value === 'number') return value * factor;
  if (Array.isArray(value) && (value[0] === 'interpolate' || value[0] === 'step')) {
    // interpolate: [op, curve, input, stop, output, …]; step: [op, input, output, stop, output, …]
    const firstOutput = value[0] === 'interpolate' ? 4 : 2;
    return value.map((item, i) => (i >= firstOutput && (i - firstOutput) % 2 === 0 ? (scaleOpacity(item, factor) ?? item) : item));
  }
  if (value && typeof value === 'object' && Array.isArray((value as { stops?: unknown }).stops)) {
    const fn = value as { stops: [unknown, unknown][] };
    return { ...fn, stops: fn.stops.map(([stop, output]) => [stop, typeof output === 'number' ? output * factor : output]) };
  }
  return undefined;
}
