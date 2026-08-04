import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROXY_URL = "https://gis.nelsonmandelabay.gov.za/resource-proxy/proxy.ashx?";
const INTERNAL_REST_BASE = "https://hq-gis-01.ds.local/image/rest/services";
const SERVICES_FOLDER = "Aerial";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), "..");
const catalogPath = path.join(projectRoot, "src", "catalog.json");

async function fetchJson(targetUrl) {
	// The proxy expects the raw target URL after `?`, not URL-encoded.
	const response = await fetch(`${PROXY_URL}${targetUrl}`);
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} for ${targetUrl}`);
	}

	const payload = await response.json();
	if (payload && typeof payload === "object" && payload.error) {
		throw new Error(`ArcGIS error for ${targetUrl}: ${JSON.stringify(payload.error)}`);
	}

	return payload;
}

function parseYearKey(name) {
	const match = name.match(/(19|20)\d{2}/);
	return match ? Number.parseInt(match[0], 10) : null;
}

function normalizeLayerName(rawName) {
	return rawName
		.replace(new RegExp(`^${SERVICES_FOLDER}/`), "")
		.replace(/^Aerials?_/, "Aerial ")
		.replace(/_/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function pickDescription(metadata, serviceName) {
	const candidates = [metadata?.description, metadata?.serviceDescription];

	for (const candidate of candidates) {
		if (typeof candidate === "string") {
			const text = candidate.trim();
			if (text.length > 0 && text !== serviceName) {
				return text;
			}
		}
	}

	return null;
}

async function buildCatalog() {
	const folder = await fetchJson(`${INTERNAL_REST_BASE}/${SERVICES_FOLDER}/?f=json`);
	if (!folder || !Array.isArray(folder.services)) {
		throw new Error("Unexpected services payload format.");
	}

	const imageServices = folder.services.filter(
		(service) => typeof service.name === "string" && service.type === "ImageServer",
	);

	if (imageServices.length === 0) {
		throw new Error("No ImageServer services found in the Aerial folder.");
	}

	const layers = [];
	for (const service of imageServices) {
		const metadata = await fetchJson(`${INTERNAL_REST_BASE}/${service.name}/ImageServer?f=json`);
		const pixelSize = Number.isFinite(metadata?.pixelSizeX)
			? Number(metadata.pixelSizeX.toFixed(3))
			: null;

		layers.push({
			name: service.name,
			title: normalizeLayerName(service.name),
			year: parseYearKey(service.name),
			description: pickDescription(metadata, service.name),
			pixelSize,
		});
	}

	layers.sort((a, b) => {
		if (a.year !== null && b.year !== null && a.year !== b.year) {
			return b.year - a.year;
		}
		if (a.year !== null && b.year === null) {
			return -1;
		}
		if (a.year === null && b.year !== null) {
			return 1;
		}
		return a.title.localeCompare(b.title);
	});

	return {
		generatedAt: new Date().toISOString(),
		layers,
	};
}

async function hasExistingCatalog() {
	try {
		const raw = await readFile(catalogPath, "utf8");
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed.layers) && parsed.layers.length > 0;
	} catch {
		return false;
	}
}

async function run() {
	try {
		const catalog = await buildCatalog();
		await writeFile(catalogPath, `${JSON.stringify(catalog, null, "\t")}\n`, "utf8");
		console.log(`Wrote src/catalog.json with ${catalog.layers.length} layer(s)`);
	} catch (error) {
		if (await hasExistingCatalog()) {
			console.warn(
				`Catalog refresh failed (${error instanceof Error ? error.message : error}); keeping existing src/catalog.json`,
			);
			return;
		}
		throw error;
	}
}

run().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
