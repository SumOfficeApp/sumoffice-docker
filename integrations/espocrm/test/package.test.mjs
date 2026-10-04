import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function filesUnder(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const target = join(path, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(target));
    else result.push(relative(root, target));
  }
  return result;
}

test("EspoCRM package is reproducible, complete, and includes presentations", async () => {
  execFileSync(join(root, "build-package.sh"), { cwd: root });
  const archive = join(root, "dist/sumoffice-espocrm-1.0.2.zip");
  const firstSha = createHash("sha256").update(await readFile(archive)).digest("hex");
  execFileSync(join(root, "build-package.sh"), { cwd: root });
  assert.equal(createHash("sha256").update(await readFile(archive)).digest("hex"), firstSha);
  const expected = ["manifest.json", ...await filesUnder(join(root, "files"))].sort();
  const actual = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split("\n").sort();
  assert.deepEqual(actual, expected);

  const manifest = JSON.parse(execFileSync("unzip", ["-p", archive, "manifest.json"], { encoding: "utf8" }));
  assert.equal(manifest.version, "1.0.2");
  const php = execFileSync("unzip", ["-p", archive, "files/custom/Espo/Modules/SumOffice/Tools/Wopi.php"], { encoding: "utf8" });
  const js = execFileSync("unzip", ["-p", archive, "files/client/custom/modules/sum-office/src/views/fields/sumoffice-file.js"], { encoding: "utf8" });
  assert.match(php, /'pptx'/);
  assert.match(js, /'pptx'/);

  const line = (await readFile(join(root, "dist/SHA256SUMS"), "utf8")).trim();
  const [recorded, name] = line.split(/\s+/, 2);
  assert.equal(name, "sumoffice-espocrm-1.0.2.zip");
  assert.equal(recorded, createHash("sha256").update(await readFile(archive)).digest("hex"));
});
