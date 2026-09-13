import {
  AttributionControl,
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  ScaleControl,
  type ExpressionSpecification,
  type FilterSpecification,
  type GeoJSONSource,
  type LngLatBounds,
  setWorkerUrl,
} from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { FeatureCollection } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import {
  commonsEditUrl,
  commonsPage,
  commonsThumb,
  loadCommonsViews,
  loadLocateCandidates,
  locationTemplate,
  type LocateCandidate,
} from './commons.ts';
import { CITIES, DEFAULT_CITY, DEFAULT_YEAR, MAX_YEAR, MIN_YEAR, OHM_STYLE } from './config.ts';
import { $, el } from './dom.ts';
import { landmarkPoints, mapFootprints, viewCones, viewPoints } from './geo.ts';
import { PlacementTool, type Placement } from './locate.ts';
import { applyDateFilter, softenBasemap, styleFont } from './ohm.ts';
import { loadHistoricMaps, type HistoricMap } from './warper.ts';
import { loadLandmarks, loadViews, type Landmark, type View } from './wikidata.ts';

// MapLibre locates its worker relative to its own module URL, which bundling breaks,
// so let Vite bundle the worker and hand MapLibre the resulting URL.
setWorkerUrl(maplibreWorkerUrl);

type Tab = 'views' | 'maps' | 'landmarks' | 'locate';
type Selection = { kind: 'view' | 'landmark'; index: number };

const TABS: Tab[] = ['views', 'maps', 'landmarks', 'locate'];
const LIST_LIMIT = 150;
const NEAR_YEARS = 25;
const OVERLAY_OPACITY = 0.85;
const HISTOGRAM_BIN = 5;
const PLAY_INTERVAL_MS = 350;
const DATE_FILTER_DELAY_MS = 150;

const VIEW_COLOR = '#c8553d';
const LANDMARK_COLOR = '#2f6690';
const MAP_COLOR = '#8a6d3b';

const ATTRIBUTION = [
  '<a href="https://www.openhistoricalmap.org/copyright" target="_blank">OpenHistoricalMap</a>',
  '<a href="https://www.wikidata.org/" target="_blank">Wikidata</a>',
  '<a href="https://commons.wikimedia.org/" target="_blank">Wikimedia Commons</a>',
  '<a href="https://warper.wmflabs.org/" target="_blank">Wikimaps Warper</a>',
];

const city = CITIES.find((c) => c.id === readHashParam('city')) ?? DEFAULT_CITY;

const state = {
  year: clampYear(Number(readHashParam('year')) || DEFAULT_YEAR),
  /** ± years around the selected year for photographs; -1 shows every photograph. */
  window: 5,
  inViewOnly: true,
  query: '',
  tab: 'views' as Tab,
  views: [] as View[],
  landmarks: [] as Landmark[],
  maps: [] as HistoricMap[],
  candidates: [] as LocateCandidate[],
  loaded: { views: false, maps: false, landmarks: false, locate: false } as Record<Tab, boolean>,
  overlays: new Map<string, number>(),
  selected: null as Selection | null,
  hovered: null as string | null,
};

const map = new MapLibreMap({
  container: 'map',
  style: OHM_STYLE,
  center: city.center,
  zoom: city.zoom,
  hash: 'map',
  attributionControl: false,
});
map.addControl(new NavigationControl(), 'top-right');
map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
map.addControl(new AttributionControl({ compact: true, customAttribution: ATTRIBUTION }), 'bottom-right');

const hoverPopup = new Popup({ closeButton: false, closeOnClick: false, offset: 12, maxWidth: '240px' });
const placement = new PlacementTool(map);

map.on('load', () => {
  softenBasemap(map);
  addDataLayers();
  applyDateFilter(map, state.year);
  updateFilters();
  void loadData();
});

// ---------------------------------------------------------------------------------------------- data

async function loadData() {
  await Promise.all([
    Promise.all([loadViews(city), loadCommonsViews(city)])
      .then(([wikidataViews, commonsViews]) => {
        // A Commons file used by a Wikidata item is already covered by that item.
        const onWikidata = new Set(wikidataViews.map((v) => v.file));
        const views = [...wikidataViews, ...commonsViews.filter((v) => !onWikidata.has(v.file))];
        state.views = views;
        source('views').setData(viewPoints(views));
        source('view-cones').setData(viewCones(views));
        state.loaded.views = true;
        renderHistogram();
      })
      .catch((error) => setStatus('views', `Could not load photographs: ${error.message}`)),
    loadLandmarks(city)
      .then((landmarks) => {
        state.landmarks = landmarks;
        source('landmarks').setData(landmarkPoints(landmarks));
        state.loaded.landmarks = true;
      })
      .catch((error) => setStatus('landmarks', `Could not load landmarks: ${error.message}`)),
    loadHistoricMaps(city)
      .then((maps) => {
        state.maps = maps;
        source('map-footprints').setData(mapFootprints(maps));
        state.loaded.maps = true;
        renderMapMarkers();
      })
      .catch((error) => setStatus('maps', `Could not load maps: ${error.message}`)),
  ].map((load) => load.finally(scheduleRender)));
}

const source = (id: string) => map.getSource(id) as GeoJSONSource;

function addDataLayers() {
  const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
  for (const id of ['map-footprints', 'view-cones', 'views', 'landmarks']) {
    map.addSource(id, { type: 'geojson', data: empty });
  }
  const selected: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false];
  const hovered: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false];
  const emphasized: ExpressionSpecification = ['any', selected, hovered];

  map.addLayer({
    id: 'map-footprints',
    type: 'line',
    source: 'map-footprints',
    paint: { 'line-color': MAP_COLOR, 'line-width': 2, 'line-dasharray': [2, 2], 'line-opacity': ['case', hovered, 0.9, 0] },
  });
  map.addLayer({
    id: 'views-cones',
    type: 'fill',
    source: 'view-cones',
    minzoom: 14,
    paint: { 'fill-color': VIEW_COLOR, 'fill-opacity': ['case', selected, 0.5, hovered, 0.35, 0.08] },
  });
  map.addLayer({
    id: 'views-cones-outline',
    type: 'line',
    source: 'view-cones',
    minzoom: 14,
    paint: {
      'line-color': VIEW_COLOR,
      'line-width': ['case', selected, 2, 0.6],
      'line-opacity': ['case', emphasized, 0.9, 0.25],
    },
  });
  map.addLayer({
    id: 'views-points',
    type: 'circle',
    source: 'views',
    paint: {
      'circle-color': VIEW_COLOR,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 17, 6.5],
      'circle-stroke-color': '#fff',
      'circle-stroke-width': ['case', emphasized, 3, 1],
    },
  });
  map.addLayer({
    id: 'landmarks',
    type: 'circle',
    source: 'landmarks',
    paint: {
      'circle-color': LANDMARK_COLOR,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 17, 7],
      'circle-stroke-color': '#fff',
      'circle-stroke-width': ['case', emphasized, 3, 1.5],
    },
  });
  map.addLayer({
    id: 'landmark-labels',
    type: 'symbol',
    source: 'landmarks',
    minzoom: 15,
    layout: {
      'text-field': ['get', 'title'],
      'text-font': styleFont(map),
      'text-size': 12,
      'text-anchor': 'top',
      'text-offset': [0, 0.9],
      'text-max-width': 10,
      'text-optional': true,
    },
    paint: { 'text-color': '#1f3b5c', 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
  });
}

function updateFilters() {
  if (!map.getLayer('views-points')) return;
  const range = viewRange();
  const viewFilter: FilterSpecification | null = range
    ? ['all', ['>=', ['get', 'year'], range[0]], ['<=', ['get', 'year'], range[1]]]
    : null;
  for (const id of ['views-points', 'views-cones', 'views-cones-outline']) map.setFilter(id, viewFilter);

  const landmarkFilter: FilterSpecification = [
    'all',
    ['<=', ['get', 'start'], state.year],
    ['>=', ['get', 'end'], state.year],
  ];
  for (const id of ['landmarks', 'landmark-labels']) map.setFilter(id, landmarkFilter);
}

let dateFilterTimer = 0;
/** The OHM filter rewrites every style layer, so it waits for the slider to settle. */
function scheduleDateFilter() {
  clearTimeout(dateFilterTimer);
  dateFilterTimer = window.setTimeout(() => {
    if (map.isStyleLoaded()) applyDateFilter(map, state.year);
  }, DATE_FILTER_DELAY_MS);
}

function toggleOverlay(m: HistoricMap) {
  const id = `warper-${m.id}`;
  if (state.overlays.has(m.id)) {
    map.removeLayer(id);
    map.removeSource(id);
    state.overlays.delete(m.id);
  } else {
    map.addSource(id, {
      type: 'raster',
      tiles: [m.tiles],
      tileSize: 256,
      bounds: m.bbox,
      attribution: `<a href="${m.commons}" target="_blank">${m.title}</a>`,
    });
    // Overlays sit above the basemap and below photographs and landmarks.
    map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': OVERLAY_OPACITY } }, 'map-footprints');
    state.overlays.set(m.id, OVERLAY_OPACITY);
    map.fitBounds(m.bbox, { padding: 40, maxZoom: 16 });
    if (m.year != null) setYear(m.year);
  }
  scheduleRender();
}

function setOverlayOpacity(m: HistoricMap, opacity: number) {
  state.overlays.set(m.id, opacity);
  map.setPaintProperty(`warper-${m.id}`, 'raster-opacity', opacity);
}

// ---------------------------------------------------------------------------------------------- year

function setYear(year: number) {
  state.year = clampYear(Math.round(year));
  $<HTMLInputElement>('#year-range').value = String(state.year);
  const input = $<HTMLInputElement>('#year-input');
  if (document.activeElement !== input) input.value = String(state.year);
  writeHashParam('year', String(state.year));
  updateWindowBand();
  updateFilters();
  scheduleDateFilter();
  scheduleRender();
}

function clampYear(year: number) {
  return Number.isFinite(year) ? Math.min(MAX_YEAR, Math.max(MIN_YEAR, year)) : DEFAULT_YEAR;
}

function viewRange(): [number, number] | null {
  return state.window < 0 ? null : [state.year - state.window, state.year + state.window];
}

/** Percentage position of a year along the timeline track. */
const trackPosition = (year: number) => ((year - MIN_YEAR) / (MAX_YEAR - MIN_YEAR)) * 100;

let playTimer = 0;

function togglePlay() {
  if (playTimer) return stopPlay();
  if (state.year >= MAX_YEAR) setYear(MIN_YEAR);
  $('#play').textContent = '❚❚';
  playTimer = window.setInterval(() => {
    if (state.year >= MAX_YEAR) stopPlay();
    else setYear(state.year + 1);
  }, PLAY_INTERVAL_MS);
}

function stopPlay() {
  clearInterval(playTimer);
  playTimer = 0;
  $('#play').textContent = '▶';
}

function setupTimeline() {
  const range = $<HTMLInputElement>('#year-range');
  const input = $<HTMLInputElement>('#year-input');
  for (const control of [range, input]) {
    control.min = String(MIN_YEAR);
    control.max = String(MAX_YEAR);
  }
  range.addEventListener('input', () => {
    stopPlay();
    setYear(Number(range.value));
  });
  input.addEventListener('change', () => setYear(Number(input.value)));
  input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
  $('#year-dec').addEventListener('click', () => setYear(state.year - 1));
  $('#year-inc').addEventListener('click', () => setYear(state.year + 1));
  $('#play').addEventListener('click', togglePlay);

  const ticks = [];
  for (let year = Math.ceil(MIN_YEAR / 50) * 50; year <= MAX_YEAR; year += 50) {
    ticks.push(el('span', { class: 'tick', style: `left:${trackPosition(year)}%` }, year));
  }
  $('#ticks').replaceChildren(...ticks);

  document.addEventListener('keydown', (e) => {
    if (e.target !== document.body || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const step = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowLeft' ? -1 : 1);
    setYear(state.year + step);
  });
  window.addEventListener('hashchange', () => {
    const year = Number(readHashParam('year'));
    if (year && year !== state.year) setYear(year);
  });
}

function updateWindowBand() {
  const band = $('#window-band');
  const range = viewRange();
  band.hidden = !range || range[0] === range[1];
  if (!range) return;
  const from = trackPosition(clampYear(range[0]));
  band.style.left = `${from}%`;
  band.style.width = `${trackPosition(clampYear(range[1])) - from}%`;
}

function renderHistogram() {
  const bins = new Array<number>(Math.ceil((MAX_YEAR - MIN_YEAR + 1) / HISTOGRAM_BIN)).fill(0);
  for (const v of state.views) {
    if (v.year != null && v.year >= MIN_YEAR && v.year <= MAX_YEAR) bins[Math.floor((v.year - MIN_YEAR) / HISTOGRAM_BIN)]++;
  }
  const max = Math.max(1, ...bins);
  const width = (HISTOGRAM_BIN / (MAX_YEAR - MIN_YEAR)) * 100;
  $('#histogram').replaceChildren(
    ...bins.flatMap((count, bin) => {
      if (!count) return [];
      const from = MIN_YEAR + bin * HISTOGRAM_BIN;
      // Square-root scale keeps sparse decades visible next to the dense 1920s.
      const height = 10 + 90 * Math.sqrt(count / max);
      return el('span', {
        class: 'bar',
        style: `left:${trackPosition(from)}%;width:${width}%;height:${height}%`,
        title: `${from}–${from + HISTOGRAM_BIN - 1}: ${count} photographs`,
      });
    }),
  );
}

function renderMapMarkers() {
  $('#map-markers').replaceChildren(
    ...state.maps
      .filter((m) => m.year != null && m.year >= MIN_YEAR)
      .map((m) =>
        el('button', {
          class: 'map-marker',
          style: `left:${trackPosition(m.year!)}%`,
          title: `${m.year}: ${m.title}`,
          'aria-label': `Map from ${m.year}: ${m.title}`,
          onclick: () => {
            setYear(m.year!);
            selectTab('maps');
          },
        }),
      ),
  );
}

// ---------------------------------------------------------------------------------------------- sidebar

function setupSidebar() {
  for (const button of document.querySelectorAll<HTMLButtonElement>('.tabs button')) {
    button.addEventListener('click', () => selectTab(button.dataset.tab as Tab));
  }
  $<HTMLInputElement>('#search').addEventListener('input', (e) => {
    state.query = normalize((e.target as HTMLInputElement).value);
    scheduleRender();
  });
  $<HTMLInputElement>('#in-view').addEventListener('change', (e) => {
    state.inViewOnly = (e.target as HTMLInputElement).checked;
    scheduleRender();
  });
  $<HTMLSelectElement>('#window').addEventListener('change', (e) => {
    state.window = Number((e.target as HTMLSelectElement).value);
    updateWindowBand();
    updateFilters();
    scheduleRender();
  });
  $('#detail-back').addEventListener('click', closeDetail);
  $('#sidebar-toggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#about-btn').addEventListener('click', () => $<HTMLDialogElement>('#about').showModal());

  const citySelect = $<HTMLSelectElement>('#city');
  citySelect.replaceChildren(...CITIES.map((c) => el('option', { value: c.id, selected: c === city }, c.name)));
  citySelect.addEventListener('change', () => {
    // Every layer is loaded for a single city, so switching starts afresh at the new city's centre.
    location.hash = `city=${citySelect.value}&year=${state.year}`;
    location.reload();
  });
  $('#subtitle').textContent = `${city.name} through time, from Wikimedia and OpenHistoricalMap`;
  document.title = `imagineWiki · ${city.name} through time`;

  const lightbox = $('#lightbox');
  lightbox.addEventListener('click', () => (lightbox.hidden = true));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && (lightbox.hidden = true));
}

function selectTab(tab: Tab) {
  state.tab = tab;
  if (tab === 'locate') loadCandidatesOnce();
  for (const button of document.querySelectorAll<HTMLButtonElement>('.tabs button')) {
    button.classList.toggle('active', button.dataset.tab === tab);
  }
  for (const t of TABS) $(`#panel-${t}`).hidden = t !== tab;
  closeDetail();
  scheduleRender();
}

let renderFrame = 0;
function scheduleRender() {
  if (!renderFrame) renderFrame = requestAnimationFrame(render);
}

function render() {
  renderFrame = 0;
  const bounds = state.inViewOnly ? map.getBounds() : null;
  const lists = {
    views: filteredViews(bounds),
    maps: filteredMaps(bounds),
    landmarks: filteredLandmarks(bounds),
    locate: filteredCandidates(),
  };
  for (const tab of TABS) {
    $(`#count-${tab}`).textContent = state.loaded[tab] ? String(lists[tab].length) : '';
  }
  if (!state.loaded[state.tab]) return;

  const cards = {
    views: () => lists.views.map(viewCard),
    maps: () => lists.maps.map(mapCard),
    landmarks: () => lists.landmarks.map(landmarkCard),
    locate: () => lists.locate.map(candidateCard),
  }[state.tab]();
  $(`#list-${state.tab}`).replaceChildren(...cards.slice(0, LIST_LIMIT));
  setStatus(state.tab, statusText(state.tab, cards.length));
}

function filteredViews(bounds: LngLatBounds | null) {
  const range = viewRange();
  return state.views
    .map((view, index) => ({ view, index }))
    .filter(
      ({ view: v }) =>
        (!range || (v.year != null && v.year >= range[0] && v.year <= range[1])) &&
        (!bounds || bounds.contains([v.lon, v.lat])) &&
        matchesQuery(v.title, v.creator),
    )
    .sort((a, b) => distance(a.view.year) - distance(b.view.year) || a.view.title.localeCompare(b.view.title));
}

function filteredMaps(bounds: LngLatBounds | null) {
  return state.maps
    .map((m, index) => ({ m, index }))
    .filter(({ m }) => {
      const [w, s, e, n] = m.bbox;
      const visible =
        !bounds || (w <= bounds.getEast() && e >= bounds.getWest() && s <= bounds.getNorth() && n >= bounds.getSouth());
      return visible && matchesQuery(m.title);
    });
}

function filteredLandmarks(bounds: LngLatBounds | null) {
  return state.landmarks
    .map((landmark, index) => ({ landmark, index }))
    .filter(
      ({ landmark: l }) =>
        l.start <= state.year &&
        (l.end == null || l.end >= state.year) &&
        (!bounds || bounds.contains([l.lon, l.lat])) &&
        matchesQuery(l.title, l.type),
    )
    .sort((a, b) => a.landmark.title.localeCompare(b.landmark.title));
}

const distance = (year: number | null) => (year == null ? Infinity : Math.abs(year - state.year));

const normalize = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

const matchesQuery = (...fields: (string | null)[]) =>
  !state.query || normalize(fields.filter(Boolean).join(' ')).includes(state.query);

function setStatus(tab: Tab, text: string) {
  $(`#status-${tab}`).textContent = text;
}

const NOUNS: Record<Tab, [string, string]> = {
  views: ['photograph', 'photographs'],
  maps: ['map', 'maps'],
  landmarks: ['landmark', 'landmarks'],
  locate: ['photograph to locate', 'photographs to locate'],
};

function statusText(tab: Tab, count: number) {
  const [singular, plural] = NOUNS[tab];
  if (count === 0 && tab === 'locate') {
    return state.query ? 'No photographs to locate match your search.' : 'Every photograph in these collections has a location.';
  }
  if (count === 0) return `No ${plural} for ${state.year} here. Try zooming out or widening the time range.`;
  if (count > LIST_LIMIT) return `Showing ${LIST_LIMIT} of ${count} ${plural}`;
  return `${count} ${count === 1 ? singular : plural}`;
}

function viewCard({ view: v, index }: { view: View; index: number }) {
  const key = `view:${index}`;
  return el(
    'li',
    {
      class: 'card',
      onclick: () => selectView(index, true),
      onmouseenter: () => setHover(key),
      onmouseleave: () => setHover(null),
    },
    el('img', { src: commonsThumb(v.file, 120), alt: '', loading: 'lazy' }),
    el(
      'div',
      { class: 'card-body' },
      el('div', { class: 'card-title' }, v.title),
      el('div', { class: 'card-meta' }, [v.year ?? 'Undated', v.creator].filter(Boolean).join(' · ')),
    ),
  );
}

function mapCard({ m, index }: { m: HistoricMap; index: number }) {
  const opacity = state.overlays.get(m.id);
  const active = opacity != null;
  const near = m.year != null && Math.abs(m.year - state.year) <= NEAR_YEARS;
  const key = `map:${index}`;
  return el(
    'li',
    {
      class: `card map-card${active ? ' active' : ''}${near || active ? '' : ' dim'}`,
      onmouseenter: () => setHover(key),
      onmouseleave: () => setHover(null),
    },
    el('img', { src: commonsThumb(m.file, 120), alt: '', loading: 'lazy', onclick: () => toggleOverlay(m) }),
    el(
      'div',
      { class: 'card-body' },
      el('div', { class: 'card-title' }, m.title),
      el('div', { class: 'card-meta' }, m.year ?? 'Undated'),
      el(
        'div',
        { class: 'card-actions' },
        el('button', { class: 'btn small', onclick: () => toggleOverlay(m) }, active ? 'Remove' : 'Show on map'),
        active &&
          el('input', {
            type: 'range',
            min: 0,
            max: 1,
            step: 0.05,
            value: opacity,
            'aria-label': 'Overlay opacity',
            oninput: (e: Event) => setOverlayOpacity(m, Number((e.target as HTMLInputElement).value)),
          }),
        el('a', { href: m.commons, target: '_blank', rel: 'noopener' }, 'Commons'),
      ),
    ),
  );
}

function landmarkCard({ landmark: l, index }: { landmark: Landmark; index: number }) {
  const key = `landmark:${index}`;
  return el(
    'li',
    {
      class: 'card',
      onclick: () => selectLandmark(index, true),
      onmouseenter: () => setHover(key),
      onmouseleave: () => setHover(null),
    },
    el('img', { src: commonsThumb(l.file, 120), alt: '', loading: 'lazy' }),
    el(
      'div',
      { class: 'card-body' },
      el('div', { class: 'card-title' }, l.title),
      el('div', { class: 'card-meta' }, [lifespan(l), l.type].filter(Boolean).join(' · ')),
    ),
  );
}

const lifespan = (l: Landmark) => (l.end == null ? `since ${l.start}` : `${l.start}–${l.end}`);

// ---------------------------------------------------------------------------------------------- detail

function selectView(index: number, fly: boolean) {
  const v = state.views[index];
  setSelection({ kind: 'view', index });
  if (fly) map.easeTo({ center: [v.lon, v.lat], zoom: Math.max(map.getZoom(), 16) });
  showDetail(
    el(
      'article',
      { class: 'detail-body' },
      el(
        'button',
        { class: 'detail-image', onclick: () => openLightbox(v.file, v.title), 'aria-label': 'Enlarge photograph' },
        el('img', { src: commonsThumb(v.file, 640), alt: v.title }),
      ),
      el('h2', {}, v.title),
      el(
        'dl',
        { class: 'facts' },
        fact('Date', v.year ?? 'Undated'),
        fact('Photographer', v.creator),
        fact('Collection', v.collection),
        v.heading != null && fact('Camera heading', `${Math.round(v.heading)}°`),
      ),
      el(
        'div',
        { class: 'links' },
        v.id.startsWith('Q') && link(`https://www.wikidata.org/wiki/${v.id}`, 'Wikidata'),
        link(commonsPage(v.file), 'Wikimedia Commons'),
        v.iiif && link(v.iiif, 'IIIF manifest'),
      ),
    ),
  );
}

function selectLandmark(index: number, fly: boolean) {
  const l = state.landmarks[index];
  setSelection({ kind: 'landmark', index });
  if (fly) map.easeTo({ center: [l.lon, l.lat], zoom: Math.max(map.getZoom(), 16) });
  showDetail(
    el(
      'article',
      { class: 'detail-body' },
      el(
        'button',
        { class: 'detail-image', onclick: () => openLightbox(l.file, l.title), 'aria-label': 'Enlarge image' },
        el('img', { src: commonsThumb(l.file, 640), alt: l.title }),
      ),
      el('h2', {}, l.title),
      el('dl', { class: 'facts' }, fact('Type', l.type), fact('Existed', lifespan(l))),
      el(
        'div',
        { class: 'links' },
        link(`https://www.wikidata.org/wiki/${l.id}`, 'Wikidata'),
        l.article && link(l.article, 'Wikipedia'),
        link(commonsPage(l.file), 'Wikimedia Commons'),
      ),
    ),
  );
}

function fact(label: string, value: string | number | null) {
  return value == null ? null : el('div', { class: 'fact' }, el('dt', {}, label), el('dd', {}, value));
}

const link = (href: string, text: string) => el('a', { href, target: '_blank', rel: 'noopener' }, text);

function showDetail(content: HTMLElement) {
  $('#detail-content').replaceChildren(content);
  $('#browse').hidden = true;
  $('#detail').hidden = false;
  $('#sidebar').classList.add('open');
}

function closeDetail() {
  $('#detail').hidden = true;
  $('#browse').hidden = false;
  setSelection(null);
  placement.stop();
}

function openLightbox(file: string, caption: string) {
  $<HTMLImageElement>('#lightbox-img').src = commonsThumb(file, 1920);
  $('#lightbox-caption').textContent = caption;
  $('#lightbox').hidden = false;
}

// ---------------------------------------------------------------------------------------------- locate

let candidatesRequested = false;

function loadCandidatesOnce() {
  if (candidatesRequested) return;
  candidatesRequested = true;
  loadLocateCandidates(city)
    .then((candidates) => {
      state.candidates = candidates;
      state.loaded.locate = true;
    })
    .catch((error) => setStatus('locate', `Could not search Commons: ${error.message}`))
    .finally(scheduleRender);
}

function filteredCandidates() {
  return state.candidates.filter((c) => matchesQuery(c.title, c.creator));
}

function candidateCard(c: LocateCandidate) {
  return el(
    'li',
    { class: 'card', onclick: () => startLocating(c) },
    el('img', { src: commonsThumb(c.file, 120), alt: '', loading: 'lazy' }),
    el(
      'div',
      { class: 'card-body' },
      el('div', { class: 'card-title' }, c.title),
      el('div', { class: 'card-meta' }, [c.year ?? 'Undated', c.creator].filter(Boolean).join(' · ')),
    ),
  );
}

/** Lets a contributor place a photograph's camera on the map and copy the {{Location}} template for Commons. */
function startLocating(c: LocateCandidate) {
  setSelection(null);
  if (c.year != null) setYear(c.year);

  const template = el('textarea', { class: 'template', readonly: true, rows: 2, 'aria-label': 'Location template' });
  template.placeholder = 'Click the map to place the camera';
  const heading = el('input', { type: 'range', min: 0, max: 359, step: 1, value: 0, disabled: true, 'aria-label': 'Camera heading' });
  const headingValue = el('output', {}, '–');
  // Copying stays disabled until the camera is placed, so an unplaced default can't be pasted into Commons.
  const copy = el('button', { class: 'btn', disabled: true }, 'Copy template');

  heading.addEventListener('input', () => placement.setHeading(Number(heading.value)));
  copy.addEventListener('click', () => {
    template.select();
    navigator.clipboard.writeText(template.value).then(
      () => (copy.textContent = 'Copied'),
      () => (copy.textContent = 'Press Ctrl+C to copy'),
    );
  });

  showDetail(
    el(
      'article',
      { class: 'detail-body locate' },
      el(
        'button',
        { class: 'detail-image', onclick: () => openLightbox(c.file, c.title), 'aria-label': 'Enlarge photograph' },
        el('img', { src: commonsThumb(c.file, 640), alt: c.title }),
      ),
      el('h2', {}, c.title),
      el('dl', { class: 'facts' }, fact('Date', c.year ?? 'Undated'), fact('Photographer', c.creator)),
      el(
        'ol',
        { class: 'steps' },
        el('li', {}, 'Click the map where the photographer stood. Drag the dot to adjust it.'),
        el('li', {}, 'Drag the square handle, or use the slider, to point the cone where the camera faced.'),
        el(
          'li',
          {},
          'Copy the template, open the edit page on Commons, paste it on its own line right below the {{Information}} block and publish.',
        ),
      ),
      el('label', { class: 'heading-row' }, 'Heading', heading, headingValue),
      template,
      el(
        'div',
        { class: 'card-actions' },
        copy,
        el('a', { class: 'btn', href: commonsEditUrl(c.file), target: '_blank', rel: 'noopener' }, 'Edit on Commons'),
        link(commonsPage(c.file), 'View file'),
      ),
      el('p', { class: 'muted' }, 'Once saved on Commons, the photograph shows up on this map after the next Commons snapshot.'),
    ),
  );

  placement.start((p: Placement) => {
    template.value = locationTemplate(p);
    heading.disabled = false;
    heading.value = String(Math.round(p.heading));
    headingValue.textContent = `${Math.round(p.heading)}°`;
    copy.disabled = false;
    copy.textContent = 'Copy template';
  });
}

// ---------------------------------------------------------------------------------------------- map interaction

const INTERACTIVE_LAYERS = ['landmarks', 'views-points', 'views-cones'];

function setupMapInteraction() {
  map.on('click', (e) => {
    if (placement.active) return;
    const feature = featureAt(e.point);
    if (!feature) return;
    if (feature.layer.id === 'landmarks') selectLandmark(Number(feature.id), false);
    else selectView(Number(feature.id), false);
  });

  map.on('mousemove', (e) => {
    if (placement.active) return;
    const feature = featureAt(e.point);
    map.getCanvas().style.cursor = feature ? 'pointer' : '';
    if (!feature) return setHover(null);
    setHover(`${feature.layer.id === 'landmarks' ? 'landmark' : 'view'}:${feature.id}`);
  });
  map.on('mouseout', () => setHover(null));
  map.on('moveend', () => state.inViewOnly && scheduleRender());
}

function featureAt(point: { x: number; y: number }) {
  if (!map.getLayer('views-points')) return undefined;
  return map.queryRenderedFeatures([point.x, point.y], { layers: INTERACTIVE_LAYERS })[0];
}

const FEATURE_SOURCES: Record<string, string[]> = {
  view: ['views', 'view-cones'],
  landmark: ['landmarks'],
  map: ['map-footprints'],
};

function setFeatureState(key: string, value: Record<string, boolean>) {
  const [kind, index] = key.split(':');
  for (const src of FEATURE_SOURCES[kind]) {
    if (map.getSource(src)) map.setFeatureState({ source: src, id: Number(index) }, value);
  }
}

function setSelection(selection: Selection | null) {
  if (state.selected) setFeatureState(`${state.selected.kind}:${state.selected.index}`, { selected: false });
  state.selected = selection;
  if (selection) setFeatureState(`${selection.kind}:${selection.index}`, { selected: true });
}

/** Highlights a feature on the map and shows a thumbnail preview for photographs and landmarks. */
function setHover(key: string | null) {
  if (key === state.hovered) return;
  if (state.hovered) setFeatureState(state.hovered, { hover: false });
  state.hovered = key;
  hoverPopup.remove();
  if (!key) return;
  setFeatureState(key, { hover: true });

  const [kind, index] = key.split(':');
  const item = kind === 'view' ? state.views[Number(index)] : kind === 'landmark' ? state.landmarks[Number(index)] : null;
  if (!item) return;
  const meta = 'heading' in item ? [item.year ?? 'Undated', item.creator].filter(Boolean).join(' · ') : lifespan(item);
  hoverPopup
    .setLngLat([item.lon, item.lat])
    .setDOMContent(
      el(
        'div',
        { class: 'hover-card' },
        el('img', { src: commonsThumb(item.file, 240), alt: '' }),
        el('div', { class: 'card-title' }, item.title),
        el('div', { class: 'card-meta' }, meta),
      ),
    )
    .addTo(map);
}

// ---------------------------------------------------------------------------------------------- url hash

// MapLibre keeps the camera in the `map` hash parameter and reads it without URL-decoding,
// so the year is spliced in by hand rather than through URLSearchParams.
function readHashParam(key: string): string | null {
  const part = location.hash
    .slice(1)
    .split('&')
    .find((p) => p.startsWith(`${key}=`));
  return part ? part.slice(key.length + 1) : null;
}

function writeHashParam(key: string, value: string) {
  const parts = location.hash
    .slice(1)
    .split('&')
    .filter((p) => p && !p.startsWith(`${key}=`));
  history.replaceState(history.state, '', `#${[`${key}=${value}`, ...parts].join('&')}`);
}

// ---------------------------------------------------------------------------------------------- startup

// Runs last so every module-level helper above is initialized.
setupSidebar();
setupTimeline();
setupMapInteraction();
writeHashParam('city', city.id);
setYear(state.year);
