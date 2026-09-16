export const MIN_YEAR = 1502;
export const MAX_YEAR = new Date().getFullYear();
export const DEFAULT_YEAR = 1900;

/** A raster tile layer that can be shown on the map. */
export interface RasterLayer {
  id: string;
  title: string;
  /** Raster tile URL template. WMS URLs use MapLibre's {bbox-epsg-3857} placeholder. */
  tiles: string;
  /** `tms` for tile servers that count rows from the bottom. */
  scheme?: 'xyz' | 'tms';
  /** West, south, east, north; tiles are only requested inside it. */
  bbox?: [number, number, number, number];
  minzoom?: number;
  /** Highest zoom the server has tiles for; MapLibre scales them up beyond it. */
  maxzoom?: number;
  /** Starting opacity, 0–1. */
  opacity?: number;
  /** HTML credit shown in the map attribution while the layer is visible. */
  attribution: string;
}

/** A georeferenced historical map, listed in Maps & Plans. */
export interface HistoricMap extends RasterLayer {
  year: number | null;
  bbox: [number, number, number, number];
  thumb: string;
  link: { label: string; href: string };
  /** Page id of the Commons file the map was warped from, for Wikimaps Warper maps. */
  commonsPageId?: string;
}

export interface City {
  id: string;
  name: string;
  /** Wikidata item for the city, used to skip paintings that depict it as a whole. */
  wikidataId: string;
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
  /** Layers in the map's layer panel besides OpenHistoricalMap, top of the stack first. */
  layers: RasterLayer[];
}

const GEOSAMPA_WMS = 'https://raster.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wms';
const GEOSAMPA_BBOX: HistoricMap['bbox'] = [-47.4785, -24.1938, -45.7737, -23.1378];
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

/**
 * A WMS GetMap URL in web mercator; MapLibre fills in the bounding box of each tile. GeoServer downsamples with
 * nearest neighbour unless asked, which makes zoomed-out scans look jagged, so it's asked for bilinear.
 */
function wmsTiles(wms: string, layer: string) {
  return `${wms}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${layer}&STYLES=&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=true&INTERPOLATIONS=bilinear`;
}

/** A small WMS image of `bbox` for the map list. */
function wmsThumb(wms: string, layer: string, [west, south, east, north]: HistoricMap['bbox']) {
  return `${wms}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${layer}&STYLES=&SRS=EPSG:4326&BBOX=${west},${south},${east},${north}&WIDTH=144&HEIGHT=144&FORMAT=image/jpeg&INTERPOLATIONS=bilinear`;
}

function geosampaMap(layer: string, title: string, year: number): HistoricMap {
  return {
    id: `geosampa-${layer}`,
    title,
    year,
    bbox: GEOSAMPA_BBOX,
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

const OSM_LAYER: RasterLayer = {
  id: 'osm',
  title: 'OpenStreetMap (Mapnik)',
  tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  maxzoom: 19,
  opacity: 1,
  attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>',
};

const ESRI_WORLD_IMAGERY: RasterLayer = {
  id: 'esri-world-imagery',
  title: 'Esri World Imagery',
  tiles: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  maxzoom: 19,
  opacity: 1,
  attribution: 'Imagery © Esri, Maxar, Earthstar Geographics and the GIS User Community',
};

/** Shared by the layer panel and Maps & Plans, so both show and hide the same layer. */
const SARA_1930 = geosampaMap('SaraBrasil_1930', 'Mapa Topográfico do Município de São Paulo (SARA Brasil), 1930', 1930);

/** The first city is the default. */
export const CITIES: City[] = [
  {
    id: 'sao-paulo',
    name: 'São Paulo',
    wikidataId: 'Q174',
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
      SARA_1930,
      geosampaMap('Vasp_Cruzeiro', 'Cartas do levantamento aerofotogramétrico VASP Cruzeiro, 1954', 1954),
    ],
    layers: [
      {
        id: 'topohidrografico',
        title: 'Mapa Topohidrográfico colorido Sampa',
        tiles: 'https://telhas.pedalhidrografi.co/rmsampa-v2/{z}/{x}/{y}.png',
        bbox: [-47.461, -24.207, -45.703, -22.918],
        minzoom: 8,
        maxzoom: 16,
        attribution: 'Topografia colorida · <a href="https://amora.pedalhidrografi.co/" target="_blank">Pedal Hidrográfico</a>',
      },
      { ...SARA_1930, title: 'SARA 1930' },
      {
        id: 'igg-1895',
        title: 'IGG 1895',
        // Sheets of the Comissão Geográfica e Geológica (1895–1920) from the IGC-SP collection, tiled by Ecotono.
        tiles: 'https://www.ecotono.xyz/anomalias/tiles/igc/{z}/{x}/{y}.webp',
        bbox: [-47.73, -24.61, -45.08, -22.43],
        minzoom: 7,
        maxzoom: 14,
        attribution:
          'Folhas 1895–1920 · Comissão Geográfica e Geológica, acervo IGC-SP, via <a href="https://www.ecotono.xyz/anomalias/" target="_blank">Ecotono</a>',
      },
      OSM_LAYER,
      ESRI_WORLD_IMAGERY,
      {
        id: 'geosampa-orto-2020',
        title: 'GeoSampa Ortofoto 2020',
        tiles: wmsTiles(GEOSAMPA_WMS, 'geoportal:ORTO_RGB_2020'),
        bbox: GEOSAMPA_BBOX,
        opacity: 1,
        attribution: GEOSAMPA_ATTRIBUTION,
      },
      {
        id: 'emplasa-2011',
        title: 'Ortofotos EMPLASA 2011',
        tiles: wmsTiles(
          'https://datageo.ambiente.sp.gov.br/geoimage/datageoimg/ORTOFOTOS_EMPLASA_2010/ows',
          'ORTOFOTOS_EMPLASA_2010',
        ),
        // The state of São Paulo.
        bbox: [-53.2, -25.4, -44.1, -19.7],
        opacity: 1,
        attribution: 'Ortofotos 2010/2011 · EMPLASA, via <a href="https://datageo.ambiente.sp.gov.br/" target="_blank">DataGEO</a>',
      },
    ],
  },
  {
    id: 'rio',
    name: 'Rio de Janeiro',
    wikidataId: 'Q8678',
    center: [-43.1822, -22.9068],
    zoom: 14,
    // Covers the city plus the bay, so whole-city maps fit inside it.
    bbox: [-43.85, -23.2, -42.9, -22.6],
    photoCategories: ['Photographs by Augusto Malta', 'Photographs by Marc Ferrez'],
    mapCategories: ['19th-century maps of Rio de Janeiro', 'Old maps of Rio de Janeiro'],
    overlays: [],
    layers: [OSM_LAYER, ESRI_WORLD_IMAGERY],
  },
];

export const DEFAULT_CITY = CITIES[0];

export const OHM_STYLE = 'https://www.openhistoricalmap.org/map-styles/main/main.json';

export const LANG = navigator.language.toLowerCase().startsWith('pt') ? 'pt' : 'en';
export const LABEL_LANGUAGES = LANG === 'pt' ? 'pt,en,mul' : 'en,pt,mul';
