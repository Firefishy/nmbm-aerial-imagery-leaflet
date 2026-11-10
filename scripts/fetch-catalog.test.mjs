import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const existing = {
	generatedAt: "2020-01-01T00:00:00.000Z",
	layers: [{
		name: "Aerial/Aerials_2022",
		title: "Aerial 2022",
		year: 2022,
		description: null,
		pixelSize: 0.05,
	}],
};

async function refresh(t, { pixelSize = 0.05, fail = false, strict = false } = {}) {
	const root = await mkdtemp(path.join(os.tmpdir(), "catalog-test-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(path.join(root, "scripts"));
	await mkdir(path.join(root, "src"));
	const script = path.join(root, "scripts", "fetch-catalog.mjs");
	await copyFile(new URL("./fetch-catalog.mjs", import.meta.url), script);
	const catalogPath = path.join(root, "src", "catalog.json");
	const original = `${JSON.stringify(existing, null, "\t")}\n`;
	await writeFile(catalogPath, original);
	const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `
		globalThis.fetch = async (url) => {
			if (${fail}) throw new Error("GIS unavailable");
			return {
				ok: true,
				json: async () => url.includes("/Aerial/?")
					? { services: [{ name: "Aerial/Aerials_2022", type: "ImageServer" }] }
					: { pixelSizeX: ${pixelSize} },
			};
		};
		if (${strict}) process.argv.push("--strict");
		await import(${JSON.stringify(pathToFileURL(script).href)});
	`], { encoding: "utf8" });
	return { result, original, output: await readFile(catalogPath, "utf8") };
}

test("unchanged layers preserve the exact catalog and timestamp", async (t) => {
	const { result, original, output } = await refresh(t, { strict: true });
	assert.equal(result.status, 0, result.stderr);
	assert.equal(output, original);
});

test("changed layer metadata updates the catalog and timestamp", async (t) => {
	const { result, output } = await refresh(t, { pixelSize: 0.1, strict: true });
	assert.equal(result.status, 0, result.stderr);
	const catalog = JSON.parse(output);
	assert.equal(catalog.layers[0].pixelSize, 0.1);
	assert.notEqual(catalog.generatedAt, existing.generatedAt);
});

test("strict refresh fails without modifying the existing catalog", async (t) => {
	const { result, original, output } = await refresh(t, { fail: true, strict: true });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /GIS unavailable/);
	assert.equal(output, original);
});

test("normal refresh retains the build fallback on fetch failure", async (t) => {
	const { result, original, output } = await refresh(t, { fail: true });
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stderr, /keeping existing/);
	assert.equal(output, original);
});
