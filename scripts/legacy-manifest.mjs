// Rewrites a manifest in place for Stream Deck 7.1–7.5, which reject the Neo controller.
//
//   node scripts/legacy-manifest.mjs <manifest.json>
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
	console.error("usage: node scripts/legacy-manifest.mjs <manifest.json>");
	process.exit(2);
}

const manifest = JSON.parse(readFileSync(file, "utf8"));
manifest.Software = { ...manifest.Software, MinimumVersion: "7.1" };
for (const action of manifest.Actions ?? []) {
	if (Array.isArray(action.Controllers)) action.Controllers = action.Controllers.filter((c) => c !== "Neo");
}
writeFileSync(file, `${JSON.stringify(manifest, null, "\t")}\n`);
