#!/usr/bin/env node

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const version = process.argv[2];

if (!version) {
	console.error("Usage: node bump.mjs <version>");
	console.error("Example: node bump.mjs 0.2.0");
	process.exit(1);
}

const packagesDir = "packages";
const packages = readdirSync(packagesDir);

for (const pkg of packages) {
	const pkgJsonPath = join(packagesDir, pkg, "package.json");
	let pkgJson;
	try {
		pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
	} catch {
		continue;
	}
	pkgJson.version = version;
	// Update @mem-cash/* dependency versions
	for (const depField of ["dependencies", "devDependencies", "peerDependencies"]) {
		if (pkgJson[depField]) {
			for (const dep of Object.keys(pkgJson[depField])) {
				if (dep.startsWith("@mem-cash/")) {
					pkgJson[depField][dep] = version;
				}
			}
		}
	}
	writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, "\t") + "\n");
	console.log(`${pkgJson.name}: ${version}`);
}

console.log(`\nAll packages set to version ${version}`);
