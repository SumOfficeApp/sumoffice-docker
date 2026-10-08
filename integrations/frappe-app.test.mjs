// The Frappe app as the marketplace and the editor see it.
//
// Both facts below were paid for on a live stand on 08.10.2026 and both are invisible in a diff:
// a format the Python route refuses but the sidebar offers (or the other way round) looks fine
// until someone opens a file, and `Authorization: Bearer` reaching Frappe's own auth turns every
// open into "WOPI host did not confirm access to the file (401)" without the app ever running.
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const app = (file) => read(`./frappe/sumoffice/${file}`);
const FORMATS = ["xlsx", "xlsm", "xlsb", "docx", "pptx"];

test("the WOPI route and the sidebar script offer the same formats", () => {
  const python = /EXTENSIONS = \(([^)]*)\)/.exec(app("sumoffice/wopi.py"));
  const js = /const EXTENSIONS = \[([^\]]*)\]/.exec(app("sumoffice/public/js/sumoffice.js"));
  assert.ok(python && js, "format lists not found");
  const list = (m) => [...m[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]);
  assert.deepEqual(list(python), FORMATS, "the Python route offers other formats");
  assert.deepEqual(list(js), FORMATS, "the sidebar script offers other formats");
});

test("the Bearer header is dropped on the WOPI routes, and the hook is registered", () => {
  const wopi = app("sumoffice/wopi.py");
  assert.match(wopi, /def ignore_bearer_on_wopi_routes\(\):/);
  assert.match(wopi, /request\.environ\.pop\("HTTP_AUTHORIZATION", None\)/);
  // Registration is the half that is easy to forget: without it the function is dead code.
  assert.match(app("sumoffice/hooks.py"), /before_request = \["sumoffice\.wopi\.ignore_bearer_on_wopi_routes"\]/);
});

test("the version is the same in the manifest and in the package", () => {
  const manifest = /^version = "([^"]+)"$/m.exec(app("pyproject.toml"));
  const pkg = /__version__ = "([^"]+)"/.exec(app("sumoffice/__init__.py"));
  assert.ok(manifest, "pyproject has no explicit version — the marketplace reads it from there");
  assert.equal(manifest[1], pkg?.[1], "pyproject and __init__ disagree about the version");
});

test("the marketplace logo is in the app and is the one hooks.py declares", () => {
  const путь = "./frappe/sumoffice/sumoffice/public/images/sumoffice-icon.png";
  assert.ok(statSync(new URL(путь, import.meta.url)).size > 1000, "logo missing or empty");
  assert.match(app("sumoffice/hooks.py"), /app_logo_url = "\/assets\/sumoffice\/images\/sumoffice-icon\.png"/);
});

test("the store listing in the README carries the fields a marketplace form asks for", () => {
  const readme = app("README.md");
  for (const поле of ["Short description", "Summary", "Full description", "Publisher", "Logo"]) {
    assert.match(readme, new RegExp(`\\*\\*${поле}`), `store listing has no ${поле}`);
  }
});
