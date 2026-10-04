# imagineWiki

A historical atlas of São Paulo (default) and Rio de Janeiro in the spirit of imagineRio, built only on open data: OpenHistoricalMap, Wikidata, Wikimedia Commons, Wikimaps Warper and a few open tile servers. Live at <https://imaginewiki.abiru.to/>. `README.md` describes the sources, layers and the mobile app release steps; this file covers what isn't obvious from the code.

## Commands

```bash
npm run dev               # Vite dev server, http://localhost:5173
npm run build             # tsc --noEmit, then vite build into dist/
npm run snapshot:maps     # refresh public/data/warper-maps-<city>.json
npm run snapshot:commons  # rescan Commons for old geotagged photos; ~30 min per city, pass city ids to limit
npm run sync              # build and copy dist/ into android/ and ios/ (Capacitor)
```

There is no test suite. `npm run build` is the type check; verify behaviour in a browser.

## Working rules

- **Contributions land on the wikis.** Anything a contributor does (locating a photo, georeferencing a map, setting a view cone) must be saved on Commons, Wikidata or Warper, never in an imagineWiki database. The app has no backend and no OAuth app; it hands contributors a template or a pre-filled link and they save under their own account.
- **Work on `main` only.** Every push to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml`. Ask before pushing.
- **Commits are SSH-signed** with a passphrase-protected key. If `git commit` fails with "incorrect passphrase" or "Error connecting to agent", ask the user to run `ssh-agent -a ~/.ssh/claude-agent.sock` and `SSH_AUTH_SOCK=~/.ssh/claude-agent.sock ssh-add ~/.ssh/id_ed25519_github`, then export that `SSH_AUTH_SOCK` before every git command that signs or talks to GitHub (including `git fetch`). The socket disappears between sessions. Never turn signing off.
- **Verify a deploy by content, not run number.** After pushing, find the Actions run whose `headSha` matches the new commit, then grep the live bundle (`assets/index-*.js`) for a string from the change.
- Leave `.vscode/` untracked.

## Architecture

Static Vite + TypeScript app, no framework. MapLibre GL 6 draws everything; the DOM is built with the `el()` helper in `src/dom.ts`.

- `src/config.ts`: the cities. Each has a bbox, Wikidata id, Commons photo and map categories, fixed map overlays and layer-panel layers. The first city is the default. Adding a city means adding an entry here and running both snapshot scripts.
- `src/main.ts`: all app state and wiring, in sections marked by `// ---- name` comments (data, year, sidebar, detail, georeference, locate, map interaction, url hash, startup).
- `src/wikidata.ts`: SPARQL for views (photographs with a point of view), paintings and landmarks.
- `src/commons.ts`: Commons API searches (Locate candidates, located photos, map candidates, per-file positions) and the shared text and date parsing.
- `src/warper.ts`: Wikimaps Warper maps, with the snapshot as fallback.
- `src/layers.ts`: the layer panel (`LayerStack`), one stack of raster layers plus the OpenHistoricalMap basemap, and the marker rows.
- `src/locate.ts`: the placement tool (camera dot, aiming handle, cone) used by Locate and Reposition.
- `src/ohm.ts`: the OHM date filter and basemap restyle. `src/geo.ts`: GeoJSON builders and the cone shape.
- `src/sheet.ts`, `src/haptics.ts`, `src/mylocation.ts`: the phone bottom sheet, native haptics and the location button.
- `scripts/`: Node scripts that import from `src/` directly (Node 24 strips types), so `src` modules they use must not touch browser-only globals at import time.
- `android/`, `ios/`: Capacitor projects wrapping the same `dist/`. App id `to.abiru.imaginewiki` can't change.

### Where pictures come from

"Views" merges four sources, each drawn as soon as it arrives (`loadPictures` in `main.ts`). When two sources have the same Commons file, the earlier one wins:

1. Wikidata items with P1259 point of view inside the city (heading from the P7787 qualifier, cone width from P4036).
2. Wikidata paintings, placed on the place they depict (P180 → P625), then moved to the viewpoint if their Commons file has a camera `{{Location}}`.
3. Commons files in the city's `photoCategories` that have a `{{Location}}`, searched live.
4. `public/data/commons-views-<city>.json`, the snapshot of other old geotagged Commons photos.

Feature ids on the map are indices into `state.views`, so anything that rebuilds that list must clear selection and hover first.

### Caching

`cached()` in `src/cache.ts` stores responses in `localStorage` under `imaginewiki:v1:`. Wikidata results last a day, Commons and Warper results an hour. A reload does not refetch until expiry; the Refresh data button clears the cache. When a change alters the shape or meaning of cached data, bump the key (as in `maps:v3`, `paintings:v2`) so browsers holding old data refetch. Layer panel settings live under `imaginewiki:layers:v1:` and are deliberately not cleared.

## Gotchas

**Code**

- Module-level `const`/`let` in `main.ts` must be defined before startup runs, which is why the startup calls sit at the very end of the file. The same applies to scripts with top-level `await`: helpers used by the main loop must be function declarations.
- `tsconfig` sets `erasableSyntaxOnly` and `verbatimModuleSyntax`: no constructor parameter properties or enums, use `import type`, and keep `.ts` extensions on relative imports.
- MapLibre 6 can't find its worker after bundling. `main.ts` imports it with `?worker&url` and calls `setWorkerUrl`; `vite.config.ts` sets `worker.format: 'es'`.
- MapLibre reads its `map=` hash parameter without URL-decoding, so the other hash parameters are spliced by hand (`readHashParam`/`writeHashParam`), not with `URLSearchParams`.
- Changing only the URL hash does not reload the page; the city is read once at startup. Browser tests that switch city need a real navigation.
- Zoom expressions must stay at the top level of a paint property. `scaleOpacity` in `layers.ts` scales interpolate stops for that reason instead of multiplying.

**Wikidata**

- The query service rejects Node's default user agent with 403; scripts pass a `User-Agent` through `init`.
- Start geographic queries from `SERVICE wikibase:box`. A query that started from every painting (`P31/P279* Q3305213`) took a minute; starting from places in the city takes seconds.
- No painting on Wikidata has a heading, and almost none has a point of view. Cones for paintings only appear once a contributor records one.

**Commons**

- `list=geosearch` returns at most 500 results with no continuation, and rejects large or zero-area boxes with "Bounding box is too big". The snapshot script splits tiles until none is full.
- The coordinates API has no heading; it is parsed from the `{{Location}}` wikitext (`headingIn`). `{{Location}}` has no field of view, so cone width can only be saved on Wikidata.
- `prop=coordinates` defaults to 10 results across the whole request; pass `colimit=max`.
- `DateTimeOriginal` often describes the scan (Exif or a full timestamp), not the picture; `commonsDateYear` rejects those. Titles and artists carry hidden QuickStatements text that `plainText` strips.
- Thumbnails: use `Special:FilePath/<file>?width=N`. Direct `upload.wikimedia.org` thumbnail URLs at non-standard widths return 400.
- Warper does not tag the Commons files it warps, so the georeference list also excludes maps by Commons page id.

**Tile servers**

- Raster tiles need `Access-Control-Allow-Origin`; test with an `Origin` header before adding a layer. The Commons page CSP, GeoServer WMS and Cloudflare-proxied buckets all behave differently.
- GeoServer (GeoSampa, DataGEO) needs `INTERPOLATIONS=bilinear` or zoomed-out scans look jagged. Its WMTS endpoint returns 403, so layers use plain WMS with MapLibre's `{bbox-epsg-3857}` placeholder.
- Pauliceia serves cached TMS tiles (`scheme: 'tms'`); its licence is assumed CC BY-SA, unconfirmed.
- IGG 1895 tiles come from the ecotono.xyz Cloud Run service (repo at `../../ecotonoxyz/www.ecotono.xyz`); its `serve.py` adds the CORS header for `/anomalias/tiles/`.

## Testing in a browser

There is no browser tool, so drive headless Chromium with `playwright-core` from the scratchpad:

- Use Playwright's cached `chrome-headless-shell` under `~/.cache/ms-playwright/`. It needs `libasound.so.2`: `apt download libasound2t64`, `dpkg -x` it into the scratchpad and set `LD_LIBRARY_PATH`.
- Launch with `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist` for WebGL.
- The scratchpad is wiped between sessions; reinstall on demand.
- Wait for `#count-views` to have text before interacting; data arrives over several seconds.
- Console errors about `static-tiles.openhistoricalmap.org` 404s and missing OHM sprite images are upstream and harmless.

## Hosting

- `imaginewiki.abiru.to` is GitHub Pages for this repo (`public/CNAME`), deployed by Actions. DNS for `abiru.to` is on Cloudflare; the record must stay DNS-only for GitHub's certificate.
- `abiru.to` itself is the separate `../danlessa.github.io` repo (branch `master`).
- No Cloudflare API credentials are available on this machine; DNS and cache changes are the user's to make.
