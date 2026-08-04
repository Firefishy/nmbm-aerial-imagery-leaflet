# Nelson Mandela Bay Historic Aerial Viewer

A modern Leaflet web app that loads historic aerial imagery from the Nelson Mandela Bay Municipality GIS services and displays it as map layers.

## Features

- Uses Leaflet with tiles rendered by the ArcGIS ImageServer `exportImage` endpoint, reprojected server-side to Web Mercator.
- Layer catalog baked in at build time (no runtime JSON calls — the GIS proxy sends no CORS headers).
- Searchable left sidebar layer picker with active-layer highlighting.
- Layer opacity control (0-100%).
- Layer description panel with capture details and resolution.
- Shareable permalink containing selected layer, map center, zoom, and opacity.
- URL-restored layer selection auto-scrolls into view in the sidebar.
- Local font asset generation at build/dev time (no runtime Google Fonts dependency).

## Data Sources

All requests go through the municipal resource proxy, which fronts the internal
ArcGIS server (`hq-gis-01.ds.local`). The internal URL is appended after
`proxy.ashx?`:

- Services catalog (JSON, fetched at build time):
	- `https://gis.nelsonmandelabay.gov.za/resource-proxy/proxy.ashx?https://hq-gis-01.ds.local/image/rest/services/Aerial/?f=json`
- Imagery (per-tile `exportImage` requests at runtime):
	- `https://gis.nelsonmandelabay.gov.za/resource-proxy/proxy.ashx?https://hq-gis-01.ds.local/image/rest/services/Aerial/<name>/ImageServer/exportImage?...`

The source imagery is stored in a local projection (Hartebeesthoek94 / NMMM);
each tile request asks the server to reproject to EPSG:3857
(`bboxSR=3857&imageSR=3857`).

## Build-Time Catalog

`scripts/fetch-catalog.mjs` fetches the service list and per-layer metadata
(description, pixel size) from the GIS server and writes `src/catalog.json`,
which is bundled into the app. It runs automatically before `dev` and `build`.
If the server is unreachable and a previous `src/catalog.json` exists, the
existing file is kept so builds still succeed.

Refresh the catalog manually:

```bash
npm run catalog
```

## Development

Install dependencies:

```bash
npm install
```

Note: `npm run dev` and `npm run build` automatically run `scripts/download-fonts.mjs` and `scripts/fetch-catalog.mjs` first via `predev`/`prebuild`.

Run local development server:

```bash
npm run dev
```

Create production build (static files):

```bash
npm run build
```

Preview production build:

```bash
npm run preview
```

## Container

Build the production image:

```bash
docker build -t nmbm-aerial-imagery-leaflet:test .
```

Run it locally:

```bash
docker run --rm -p 8080:8080 nmbm-aerial-imagery-leaflet:test
```

Or with Docker Compose (serves on http://localhost:8081, so it can run
alongside the Cape Town viewer on 8080):

```bash
docker compose up --build
```

## Permalink Format

The app updates URL query parameters as you interact with the map:

- `layer`: URL-encoded service name from the catalog (e.g. `Aerial%2FAerials_2022`)
- `lat`: map center latitude
- `lon`: map center longitude
- `zoom`: zoom level
- `opacity`: active aerial layer opacity from `0.00` to `1.00`

Example:

`?layer=Aerial%2FAerials_2022&lat=-33.960800&lon=25.602200&zoom=12&opacity=0.85`

Opening a permalink restores the requested layer and map view.

## Automation

- GitHub Pages publish workflow: `.github/workflows/pages-publish.yml`
	- Triggers on pushes to `main` and manual dispatch.
	- Builds with Node 26 and publishes `dist/` via GitHub Pages actions.
- GHCR Docker publish workflow: `.github/workflows/docker-publish.yml`
	- Triggers on pushes to `main` and tags matching `v*`.
	- Publishes images to `ghcr.io/<owner>/<repo>`.
- Dependabot config: `.github/dependabot.yml`
	- Weekly updates for npm, GitHub Actions, and Docker.

## Notes

- Tile images load cross-origin without CORS headers (plain `<img>` requests),
  but JSON `fetch` calls to the proxy would be blocked — hence the build-time
  catalog.
- If the upstream service changes, re-run `npm run catalog` and commit the
  updated `src/catalog.json`.