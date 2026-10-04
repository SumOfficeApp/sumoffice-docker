import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const previousBrand = ["sum", "office"].join("");
const thirdPartyBrand = ["only", "office"].join("");
const roots = ["a4-attachment-core", "directum-rx", "yandex-tracker", "kaiten", "megaplan"];
const productionExtensions = new Set([".mjs", ".json", ".md"]);

async function productionText(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const chunks = [];
  for (const entry of entries) {
    if (entry.name === "test") continue;
    const target = join(path, entry.name);
    if (entry.isDirectory()) chunks.push(await productionText(target));
    else if (productionExtensions.has(extname(entry.name))) chunks.push(await readFile(target, "utf8"));
  }
  return chunks.join("\n").toLowerCase();
}

test("Russian connector sources contain neither the previous nor third-party brand", async () => {
  const integrations = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const text = (await Promise.all(roots.map((root) => productionText(join(integrations, root))))).join("\n");
  assert.equal(text.includes(previousBrand), false);
  assert.equal(text.includes(thirdPartyBrand), false);

  const positiveControl = `prefix ${previousBrand} suffix`;
  assert.equal(positiveControl.includes(previousBrand), true);
});
