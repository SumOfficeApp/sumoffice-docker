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

test("EspoCRM package is reproducible, complete, includes presentations and the settings in Integrations", async () => {
  execFileSync(join(root, "build-package.sh"), { cwd: root });
  const archive = join(root, "dist/sumoffice-espocrm-1.0.4.zip");
  const firstSha = createHash("sha256").update(await readFile(archive)).digest("hex");
  execFileSync(join(root, "build-package.sh"), { cwd: root });
  assert.equal(createHash("sha256").update(await readFile(archive)).digest("hex"), firstSha);
  const expected = ["manifest.json", ...await filesUnder(join(root, "files")), ...await filesUnder(join(root, "scripts"))].sort();
  const actual = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split("\n").sort();
  assert.deepEqual(actual, expected);

  const manifest = JSON.parse(execFileSync("unzip", ["-p", archive, "manifest.json"], { encoding: "utf8" }));
  assert.equal(manifest.version, "1.0.4");
  const php = execFileSync("unzip", ["-p", archive, "files/custom/Espo/Modules/SumOffice/Tools/Wopi.php"], { encoding: "utf8" });
  const js = execFileSync("unzip", ["-p", archive, "files/client/custom/modules/sum-office/src/views/fields/sumoffice-file.js"], { encoding: "utf8" });
  assert.match(php, /'pptx'/);
  assert.match(js, /'pptx'/);

  // 1.0.4: settings in Administration → Integrations → SumOffice, carried over from 1.0.3 on upgrade.
  const list = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" });
  assert.match(list, /Resources\/metadata\/integrations\/SumOffice\.json/);
  assert.match(list, /Resources\/i18n\/en_US\/Integration\.json/);
  assert.match(list, /views\/admin\/integration\.js/);
  assert.doesNotMatch(list, /adminPanel\.json|layouts\/Settings|entityDefs\/Settings/);
  assert.match(list, /scripts\/AfterInstall\.php/);
  const integration = JSON.parse(execFileSync("unzip", ["-p", archive, "files/custom/Espo/Modules/SumOffice/Resources/metadata/integrations/SumOffice.json"], { encoding: "utf8" }));
  assert.deepEqual(Object.keys(integration.fields), ["sumofficeDiscoveryUrl", "sumofficeVerifyProof", "sumofficeCaBundle", "sumofficeEditorWindow"]);
  assert.equal(integration.fields.sumofficeVerifyProof.default, true);
  assert.equal(integration.view, "sum-office:views/admin/integration");
  const routes = JSON.parse(execFileSync("unzip", ["-p", archive, "files/custom/Espo/Modules/SumOffice/Resources/routes.json"], { encoding: "utf8" }));
  assert.ok(routes.some((r) => r.route === "/SumOffice/check" && !r.noAuth), "check route must require sign-in");
  const after = execFileSync("unzip", ["-p", archive, "scripts/AfterInstall.php"], { encoding: "utf8" });
  assert.match(after, /getEntityById\('Integration', 'SumOffice'\)/);
  assert.match(after, /isNew\(\)/, "the Integration repository never returns null");
  assert.match(after, /sumofficeVerifyProof' => \$config->get\('sumofficeVerifyProof'\) !== false/);
  const open = execFileSync("unzip", ["-p", archive, "files/custom/Espo/Modules/SumOffice/EntryPoints/SumOfficeOpen.php"], { encoding: "utf8" });
  assert.match(open, /'_self'/, "editors on another site open as the whole tab");

  const line = (await readFile(join(root, "dist/SHA256SUMS"), "utf8")).trim();
  const [recorded, name] = line.split(/\s+/, 2);
  assert.equal(name, "sumoffice-espocrm-1.0.4.zip");
  assert.equal(recorded, createHash("sha256").update(await readFile(archive)).digest("hex"));
});
