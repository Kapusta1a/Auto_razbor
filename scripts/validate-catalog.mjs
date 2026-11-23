import fs from "node:fs";
import path from "node:path";

const file = path.resolve("data/catalog.seed.json");
const catalog = JSON.parse(fs.readFileSync(file, "utf8"));
const errors = [];
const ids = new Set();
const stats = { brands: 0, models: 0, generations: 0 };

function checkId(id, where) {
  if (typeof id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    errors.push(`${where}: invalid id "${id}"`);
    return;
  }
  if (ids.has(id)) errors.push(`${where}: duplicate id "${id}"`);
  ids.add(id);
}

if (!catalog || ![1, 2].includes(catalog.schemaVersion) || !Array.isArray(catalog.brands)) {
  throw new Error("Invalid catalog root: expected schemaVersion: 1 or 2 and brands array");
}

for (const brand of catalog.brands) {
  stats.brands++;
  checkId(brand.id, "brand");
  if (!brand.name || !brand.country || !Array.isArray(brand.models)) {
    errors.push(`brand ${brand.id}: name, country and models are required`);
    continue;
  }
  for (const model of brand.models) {
    stats.models++;
    checkId(model.id, `model under ${brand.id}`);
    if (!model.name || !Array.isArray(model.generations)) {
      errors.push(`model ${model.id}: name and generations array are required`);
      continue;
    }
    for (const generation of model.generations) {
      stats.generations++;
      checkId(generation.id, `generation under ${model.id}`);
      if (!generation.code || !generation.years || !Array.isArray(generation.markets)) {
        errors.push(`generation ${generation.id}: code, years and markets are required`);
      }
    }
  }
}

console.log("AUTO_RAZBOR catalog validation");
console.log(`Brands: ${stats.brands}; models: ${stats.models}; generations: ${stats.generations}`);
if (errors.length) {
  console.error(`Found ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("OK: structure and IDs are valid.");
}
