export const MIN_YEAR = 1502;
export const MAX_YEAR = new Date().getFullYear();
export const DEFAULT_YEAR = 1900;

/** A georeferenced historical map shown as a raster overlay. */
export interface HistoricMap {
  id: string;
  title: string;
  year: number | null;
  /** West, south, east, north. */
  bbox: [number, number, number, number];
  /** Raster tile URL template. WMS URLs use MapLibre's {bbox-epsg-3857} placeholder. */
  tiles: string;
  /** `tms` for tile servers that count rows from the bottom. */
  scheme?: 'xyz' | 'tms';
  thumb: string;
  link: { label: string; href: string };
  /** Page id of the Commons file the map was warped from, for Wikimaps Warper maps. */
  commonsPageId?: string;
  /** HTML credit shown in the map attribution while the overlay is on. */
  attribution: string;
}

export interface City {
  id: string;
  name: string;
  center: [number, number];
  zoom: number;
  /** West, south, east, north. Photographs, landmarks and maps are limited to this box. */
  bbox: [number, number, number, number];
  /** Commons categories of old photographs of the city, offered in the Locate tab when they lack a location. */
  photoCategories: string[];
  /** Commons categories of old maps of the city, offered for georeferencing when they aren't on Wikimaps Warper. */
  mapCategories: string[];
  /** Historical maps from other open tile servers, listed alongside the Wikimaps Warper maps. */
  overlays: HistoricMap[];
}

const GEOSAMPA_WMS = 'https://raster.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wms';
const GEOSAMPA_ATTRIBUTION =
  '<a href="https://geosampa.prefeitura.sp.gov.br/" target="_blank">GeoSampa</a>, Prefeitura de São Paulo ' +
  '(<a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank">CC BY-SA 4.0</a>)';
/** GeoSampa layers cover the whole metropolitan grid, so previews show just the historic centre. */
const CENTRAL_SAO_PAULO: HistoricMap['bbox'] = [-46.66, -23.57, -46.61, -23.52];

const PAULICEIA_GEOSERVER = 'https://pauliceia.unifesp.br/geoserver';
// UNIFESP publishes no licence for these layers; CC BY-SA is assumed until they confirm.
const PAULICEIA_ATTRIBUTION =
  '<a href="https://pauliceia.unifesp.br/" target="_blank">Pauliceia 2.0</a>, UNIFESP ' +
  '(<a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank">CC BY-SA</a>)';

/** A WMS GetMap URL in web mercator; MapLibre fills in the bounding box of each tile. */
function wmsTiles(wms: string, layer: string) {
  return `${wms}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${layer}&STYLES=&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true`;
}

/** A small WMS image of `bbox` for the map list. */
function wmsThumb(wms: string, layer: string, [west, south, east, north]: HistoricMap['bbox']) {
  return `${wms}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${layer}&STYLES=&SRS=EPSG:4326&BBOX=${west},${south},${east},${north}&WIDTH=144&HEIGHT=144&FORMAT=image/jpeg`;
}

function geosampaMap(layer: string, title: string, year: number): HistoricMap {
  return {
    id: `geosampa-${layer}`,
    title,
    year,
    bbox: [-47.4785, -24.1938, -45.7737, -23.1378],
    tiles: wmsTiles(GEOSAMPA_WMS, `geoportal:${layer}`),
    thumb: wmsThumb(GEOSAMPA_WMS, `geoportal:${layer}`, CENTRAL_SAO_PAULO),
    link: { label: 'GeoSampa', href: 'https://geosampa.prefeitura.sp.gov.br/' },
    attribution: GEOSAMPA_ATTRIBUTION,
  };
}

/** Pauliceia serves cached TMS tiles, which are faster than rendering WMS on every request. */
function pauliceiaMap(layer: string, year: number, bbox: HistoricMap['bbox']): HistoricMap {
  return {
    id: `pauliceia-${layer}`,
    title: `Planta da cidade de São Paulo, ${year}`,
    year,
    bbox,
    tiles: `${PAULICEIA_GEOSERVER}/gwc/service/tms/1.0.0/pauliceia:${layer}@EPSG:900913@png/{z}/{x}/{y}.png`,
    scheme: 'tms',
    thumb: wmsThumb(`${PAULICEIA_GEOSERVER}/wms`, `pauliceia:${layer}`, bbox),
    link: { label: 'Pauliceia 2.0', href: 'https://pauliceia.unifesp.br/' },
    attribution: PAULICEIA_ATTRIBUTION,
  };
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
    mapCategories: ['19th-century maps of São Paulo', '20th-century maps of São Paulo', 'Old maps of São Paulo'],
    overlays: [
      // Layer names are UNIFESP's; its catalogue keywords date the 1870 and 1880 layers to the 1877 and 1881 plans.
      pauliceiaMap('1868', 1868, [-46.6748, -23.5737, -46.609, -23.5147]),
      pauliceiaMap('1870', 1877, [-46.6489, -23.558, -46.6219, -23.5299]),
      pauliceiaMap('1880', 1881, [-46.6554, -23.5634, -46.6104, -23.5164]),
      pauliceiaMap('1890', 1890, [-46.6568, -23.5707, -46.6024, -23.5133]),
      pauliceiaMap('1905', 1905, [-46.7389, -23.6231, -46.5257, -23.4849]),
      pauliceiaMap('1924', 1924, [-46.7595, -23.6471, -46.5292, -23.4586]),
      geosampaMap('SaraBrasil_1930', 'Mapa Topográfico do Município de São Paulo (SARA Brasil), 1930', 1930),
      geosampaMap('Vasp_Cruzeiro', 'Cartas do levantamento aerofotogramétrico VASP Cruzeiro, 1954', 1954),
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
    mapCategories: ['19th-century maps of Rio de Janeiro', 'Old maps of Rio de Janeiro'],
    overlays: [],
  },
];

export const DEFAULT_CITY = CITIES[0];

export const OHM_STYLE = 'https://www.openhistoricalmap.org/map-styles/main/main.json';

export const LANG = navigator.language.toLowerCase().startsWith('pt') ? 'pt' : 'en';
export const LABEL_LANGUAGES = LANG === 'pt' ? 'pt,en,mul' : 'en,pt,mul';
