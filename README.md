# imagineWiki

A historical atlas of Brazilian cities (São Paulo by default, plus Rio de Janeiro) in the spirit of [imagineRio](https://imaginerio.org/en/map), built entirely on open, community-maintained data:

| Layer | Source | How it is used |
| --- | --- | --- |
| Basemap | [OpenHistoricalMap](https://www.openhistoricalmap.org/) vector tiles | Filtered to the selected year with [`maplibre-gl-dates`](https://github.com/OpenHistoricalMap/maplibre-gl-dates) |
| Views | [Wikidata](https://www.wikidata.org/) + [Wikimedia Commons](https://commons.wikimedia.org/) | Photographs whose point of view (`P1259`) falls inside the city, with heading (`P7787`) and date (`P571`), drawn as view cones. Rio has ~3,500 from the Instituto Moreira Salles; São Paulo has almost none |
| Views | Wikimedia Commons | Geotagged files inside the city that no Wikidata item uses, with a date (not from Exif) before 1970 and the heading from `{{Location}}`. Collected ahead of time into `public/data/commons-views-<city>.json` |
| Landmarks | Wikidata | Items in the city's bounding box with an image and a start date (`P571`/`P580`), hidden after their end date (`P576`/`P582`) |
| Maps & Plans | [Wikimaps Warper](https://warper.wmflabs.org/) | Commons maps georeferenced by volunteers, shown as raster overlays with adjustable opacity |
| Maps & Plans | [GeoSampa](https://geosampa.prefeitura.sp.gov.br/) (Prefeitura de São Paulo) | 1930 SARA Brasil map and 1954 VASP Cruzeiro survey charts, via WMS. CC BY-SA 4.0 per GeoSampa's data licence |
| Maps & Plans | [Pauliceia 2.0](https://pauliceia.unifesp.br/) (UNIFESP) | Plans of São Paulo from 1868, 1877, 1881, 1890, 1905 and 1924, via cached TMS tiles. No licence is published; CC BY-SA is assumed until UNIFESP confirms |

Wikidata, Warper and OpenHistoricalMap are fetched live from the browser and cached in `localStorage` for a day. Commons can't filter geotagged files by date, so finding its old photographs takes hundreds of requests and is done ahead of time by a script. If Warper is down, the app falls back to `public/data/warper-maps-<city>.json`.

## Development

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # type-check and build static files into dist/
npm run snapshot:maps     # refresh the Warper fallback snapshot
npm run snapshot:commons  # rescan Commons for historical photographs (takes several minutes)
```

The build is a static site with relative paths, so `dist/` can be served from any host or subdirectory (for example GitHub Pages).

## Cities

Cities are defined in `src/config.ts` (centre, zoom, bounding box and the Commons photo categories offered in the Locate tab), and the first entry is the default. Switch with the selector in the top bar or the `city` URL parameter, e.g. `#city=rio`. Run `npm run snapshot:maps` and `npm run snapshot:commons` after adding a city.

## Locating photographs

The Locate tab lists photographs from each city's Commons categories that have no camera or object location, neither as a template nor as structured data. A contributor places the camera and its heading on the map, copies the generated `{{Location|lat|lon|heading:…}}` template and pastes it into the file page on Commons. The location is saved on Commons, where every project can use it; imagineWiki stores nothing.

## Georeferencing maps

Below the map list, Maps & Plans lists old maps in each city's Commons categories (`mapCategories` in `src/config.ts`) that aren't in Commons' "Georeferenced maps in Wikimaps Warper" category. Each links to Warper's import page, where contributors sign in with a Wikimedia account and place control points. Warper saves the result openly and Commons records it, and the map then appears in imagineWiki through the regular Warper query.

Maps from other open tile servers are configured per city as `overlays` in `src/config.ts`.

## Improving the map

Gaps in the atlas are gaps in the open data, and all of it can be edited:

- Add `start_date`/`end_date` to streets and buildings on OpenHistoricalMap.
- Add a heading qualifier to a photograph's point of view on Wikidata so it gets a view cone.
- Give old photographs on Commons a `{{Location}}` with a `heading:` and a date, then rerun `npm run snapshot:commons`.
- Georeference another city map from Commons on Wikimaps Warper.

## Credits

Inspired by imagineRio, created by Rice University and Axis Maps. This project is not affiliated with them.
