import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./fonts.local.css";
import "./styles.css";
import catalog from "./catalog.json";

const PROXY_URL = "https://gis.nelsonmandelabay.gov.za/resource-proxy/proxy.ashx?";
const INTERNAL_REST_BASE = "https://hq-gis-01.ds.local/image/rest/services";
const DEFAULT_CENTER = [-33.9608, 25.6022];
const DEFAULT_ZOOM = 12;
const MAX_IMAGERY_ZOOM = 24;
const TILE_SIZE = 256;
const WEB_MERCATOR_HALF_WORLD = 20037508.342789244;
const DEFAULT_LAYER_OPACITY = 1;
const DESCRIPTION_DEFAULT_TEXT = "Select an aerial layer to view its description.";

const map = L.map("map", {
  zoomControl: true,
  minZoom: 4,
  maxZoom: MAX_IMAGERY_ZOOM,
  zoomSnap: 1,
  zoomDelta: 1,
  wheelPxPerZoomLevel: 40,
  wheelDebounceTime: 20,
}).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

const osmLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
});

osmLayer.addTo(map);

// ArcGIS ImageServer tile layer: requests each 256px tile via exportImage
// with a Web Mercator bbox so the server reprojects from the local NMMM CRS.
const ImageServerTileLayer = L.TileLayer.extend({
  initialize(serviceName, options) {
    this._exportImageBase = `${PROXY_URL}${INTERNAL_REST_BASE}/${serviceName}/ImageServer/exportImage`;
    L.TileLayer.prototype.initialize.call(this, "", options);
  },

  getTileUrl(coords) {
    const worldMeters = WEB_MERCATOR_HALF_WORLD * 2;
    const tileMeters = worldMeters / Math.pow(2, coords.z);
    const xmin = -WEB_MERCATOR_HALF_WORLD + coords.x * tileMeters;
    const xmax = xmin + tileMeters;
    const ymax = WEB_MERCATOR_HALF_WORLD - coords.y * tileMeters;
    const ymin = ymax - tileMeters;

    const params = [
      "f=image",
      `bbox=${xmin},${ymin},${xmax},${ymax}`,
      "bboxSR=3857",
      "imageSR=3857",
      `size=${TILE_SIZE},${TILE_SIZE}`,
      "format=jpgpng",
      "transparent=true",
    ];

    return `${this._exportImageBase}?${params.join("&")}`;
  },
});

const state = {
  layers: [],
  activeLayer: null,
  activeLeafletLayer: null,
  opacity: DEFAULT_LAYER_OPACITY,
};

const layerListEl = document.querySelector("#layer-list");
const searchEl = document.querySelector("#layer-search");
const statusEl = document.querySelector("#status");
const opacitySliderEl = document.querySelector("#opacity-slider");
const opacityValueEl = document.querySelector("#opacity-value");
const descriptionEl = document.querySelector("#layer-description");

function setStatus(message) {
  statusEl.textContent = message;
}

function setDescription(message) {
  descriptionEl.textContent = message;
}

function layerToSlug(layerName) {
  return encodeURIComponent(layerName);
}

function slugToLayer(slug) {
  try {
    return decodeURIComponent(slug);
  } catch {
    return null;
  }
}

function describeLayer(layer) {
  const parts = [];

  if (layer.description) {
    parts.push(layer.description);
  } else {
    parts.push(layer.title);
  }

  if (Number.isFinite(layer.pixelSize)) {
    parts.push(`Resolution: ${layer.pixelSize} m/pixel.`);
  }

  return parts.join(" ");
}

function clampOpacity(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_LAYER_OPACITY;
  }
  return Math.min(1, Math.max(0, value));
}

function updateOpacityUi() {
  opacitySliderEl.value = state.opacity.toFixed(2);
  opacityValueEl.textContent = `${Math.round(state.opacity * 100)}%`;
}

function setLayerOpacity(value, options = {}) {
  const { writeUrl = true } = options;

  state.opacity = clampOpacity(value);
  if (state.activeLeafletLayer) {
    state.activeLeafletLayer.setOpacity(state.opacity);
  }
  updateOpacityUi();

  if (writeUrl) {
    writeUrlState();
  }
}

function readUrlState() {
  const queryParams = new URLSearchParams(window.location.search);
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashParams = new URLSearchParams(hash);

  const getParam = (...keys) => {
    for (const key of keys) {
      const fromQuery = queryParams.get(key);
      if (fromQuery !== null) {
        return fromQuery;
      }
    }

    for (const key of keys) {
      const fromHash = hashParams.get(key);
      if (fromHash !== null) {
        return fromHash;
      }
    }

    return null;
  };

  const layer = getParam("layer");
  const lat = Number.parseFloat(getParam("lat"));
  const lng = Number.parseFloat(getParam("lon", "lng"));
  const z = Number.parseFloat(getParam("zoom", "z"));
  const opacity = Number.parseFloat(getParam("opacity"));

  return {
    layer: layer ? slugToLayer(layer) : null,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    z: Number.isFinite(z) ? z : null,
    opacity: clampOpacity(opacity),
  };
}

function writeUrlState() {
  const center = map.getCenter();
  const zoom = map.getZoom();
  const params = new URLSearchParams(window.location.search);

  if (state.activeLayer) {
    params.set("layer", layerToSlug(state.activeLayer.name));
  } else {
    params.delete("layer");
  }
  params.set("lat", center.lat.toFixed(6));
  params.set("lon", center.lng.toFixed(6));
  params.set("zoom", String(zoom));
  params.set("opacity", state.opacity.toFixed(2));
  params.delete("lng");
  params.delete("z");

  const nextUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({}, "", nextUrl);
}

function buildImageLayer(layerName) {
  return new ImageServerTileLayer(layerName, {
    tileSize: TILE_SIZE,
    maxZoom: MAX_IMAGERY_ZOOM,
    attribution: "Nelson Mandela Bay Municipality",
  });
}

function setActiveLayer(layer, options = {}) {
  const { scrollIntoView = false } = options;

  if (state.activeLayer?.name === layer.name) {
    if (state.activeLeafletLayer) {
      map.removeLayer(state.activeLeafletLayer);
      state.activeLeafletLayer = null;
    }
    state.activeLayer = null;
    renderLayerList(searchEl.value);
    setStatus("No aerial layer selected.");
    setDescription(DESCRIPTION_DEFAULT_TEXT);
    writeUrlState();
    return;
  }

  if (state.activeLeafletLayer) {
    map.removeLayer(state.activeLeafletLayer);
  }

  state.activeLayer = layer;
  state.activeLeafletLayer = buildImageLayer(layer.name);
  state.activeLeafletLayer.addTo(map);
  state.activeLeafletLayer.setOpacity(state.opacity);
  renderLayerList(searchEl.value);

  if (scrollIntoView) {
    scrollLayerIntoView(layer.name);
  }

  setStatus(`Showing: ${layer.title}`);
  setDescription(describeLayer(layer));
  writeUrlState();
}

function renderLayerList(filterText = "") {
  const needle = filterText.trim().toLowerCase();
  const filtered = needle
    ? state.layers.filter((layer) => layer.title.toLowerCase().includes(needle))
    : state.layers;

  layerListEl.textContent = "";

  if (filtered.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "No layers match your search.";
    empty.className = "status";
    layerListEl.append(empty);
    return;
  }

  for (const layer of filtered) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = layer.title;
    button.dataset.layerName = layer.name;
    button.className = state.activeLayer?.name === layer.name ? "active" : "";
    button.addEventListener("click", () => setActiveLayer(layer));
    li.append(button);
    layerListEl.append(li);
  }
}

function scrollLayerIntoView(layerName) {
  const layerButton = layerListEl.querySelector(`button[data-layer-name="${CSS.escape(layerName)}"]`);
  if (!layerButton) {
    return;
  }

  layerButton.scrollIntoView({ block: "nearest" });
}

function bootstrap() {
  const urlState = readUrlState();

  setDescription(DESCRIPTION_DEFAULT_TEXT);
  setLayerOpacity(urlState.opacity, { writeUrl: false });

  if (urlState.lat !== null && urlState.lng !== null && urlState.z !== null) {
    map.setView([urlState.lat, urlState.lng], urlState.z);
  }

  map.on("moveend", () => writeUrlState());

  state.layers = Array.isArray(catalog.layers) ? catalog.layers : [];

  if (state.layers.length === 0) {
    setStatus("No aerial imagery layers found in the bundled catalog.");
    return;
  }

  renderLayerList();

  const requested = urlState.layer
    ? state.layers.find((layer) => layer.name === urlState.layer)
    : null;

  setActiveLayer(requested || state.layers[0], {
    scrollIntoView: Boolean(requested),
  });
}

searchEl.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  renderLayerList(target.value);
});

opacitySliderEl.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  setLayerOpacity(Number.parseFloat(target.value));
});

bootstrap();
