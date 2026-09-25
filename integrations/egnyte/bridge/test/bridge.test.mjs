// node --test integrations/egnyte/bridge/test/bridge.test.mjs
// The bridge against a mock Egnyte Public API and a mock SumOffice discovery with real proof keys.
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { generateKeyPairSync, sign as rsaSign } from "node:crypto";
import { mockEgnyte } from "./mock-egnyte.mjs";
import { start, config } from "../server.mjs";

const listen = (s) => new Promise((r) => s.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${s.address().port}`)));

function proofHeaders(key, token, url) {
  const ticks = BigInt(Date.now()) * 10000n + 621355968000000000n;
  const t = Buffer.from(token); const u = Buffer.from(url.toUpperCase());
  const n = (x) => { const b = Buffer.alloc(4); b.writeInt32BE(x); return b; };
  const ts = Buffer.alloc(8); ts.writeBigInt64BE(ticks);
  const sig = rsaSign("RSA-SHA256", Buffer.concat([n(t.length), t, n(u.length), u, n(8), ts]), key).toString("base64");
  return { "x-wopi-timestamp": String(ticks), "x-wopi-proof": sig, "x-wopi-proofold": sig };
}

test("invoke → one-time link → CheckFileInfo → lock → GetFile → PutFile adds a version; refusals", async (t) => {
  const original = Buffer.from("PK original xlsm");
  const eg = mockEgnyte([{ group_id: "g1", path: "/Shared/Отчёты/book one.xlsm", data: original }]);
  const egUrl = await listen(eg.server);
  const k = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = k.publicKey.export({ format: "jwk" });
  const std = (s) => Buffer.from(s, "base64url").toString("base64");
  const disco = createServer((req, res) => res.end(`<wopi-discovery><net-zone name="external-https"><app name="Excel">
    <action name="edit" ext="xlsm" urlsrc="https://office.example/f1/wopi/edit?&lt;ui=UI_LLCC&amp;&gt;"/>
    <action name="view" ext="xlsm" urlsrc="https://office.example/f1/wopi/view?"/></app></net-zone>
    <proof-key value="x" modulus="${std(jwk.n)}" exponent="${std(jwk.e)}"/></wopi-discovery>`));
  const discoUrl = await listen(disco);
  const bridge = start(config({ PORT: "0", HOST: "127.0.0.1", TOKEN_KEY: "k".repeat(24), PUBLIC_URL: "http://placeholder",
    SUMOFFICE_DISCOVERY_URL: `${discoUrl}/hosting/discovery`, EGNYTE_DOMAINS: "acme.egnyte.com", EGNYTE_API_BASE: egUrl }));
  await new Promise((r) => bridge.once("listening", r));
  const base = `http://127.0.0.1:${bridge.address().port}`;
  t.after(() => { bridge.close(); eg.server.close(); disco.close(); });

  const item = { name: "book one.xlsm", path: "/Shared/Отчёты/book one.xlsm", is_folder: false, group_id: "g1", entry_id: "e1" };
  const invocation = (over = {}, mode = "edit") => fetch(`${base}/egnyte/invoke?mode=${mode}`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ items: [item], userInfo: { id: 7, first_name: "Victor", last_name: "V", username: "victor" }, domain: "acme.egnyte.com", token: "rw-victor", ...over }) });

  assert.equal((await invocation({ domain: "evil.example.com" })).status, 400, "only Egnyte domains");
  assert.equal((await invocation({ domain: "other.egnyte.com" })).status, 400, "only the configured domain");
  assert.equal((await invocation({ items: [{ ...item, is_folder: true }] })).status, 400, "folders are not files");

  const inv = await (await invocation()).json();
  assert.match(inv.redirect, /^http:\/\/placeholder\/egnyte\/open\/[\w-]+$/);
  const openPath = new URL(inv.redirect).pathname;
  const page = await (await fetch(`${base}${openPath}`)).text();
  assert.equal((await fetch(`${base}${openPath}`)).status, 410, "the link works once");
  assert.ok(!page.includes("rw-victor"), "the Egnyte token never reaches the browser");
  const action = page.match(/action="([^"]+)"/)[1].replace(/&#38;/g, "&");
  const token = page.match(/name="access_token" value="([^"]+)"/)[1];
  assert.match(action, /^https:\/\/office\.example\/f1\/wopi\/edit\?WOPISrc=/);
  const wopiPath = new URL(decodeURIComponent(action.split("WOPISrc=")[1])).pathname;
  const call = (sub, { method = "GET", headers = {}, body, proof = true, tok = token, path = wopiPath } = {}) => {
    const p = `${path}${sub}?access_token=${encodeURIComponent(tok)}`;
    return fetch(`${base}${p}`, { method, body, headers: proof ? { ...proofHeaders(k.privateKey, tok, `http://placeholder${p}`), ...headers } : headers });
  };

  const info = await (await call("")).json();
  assert.equal(info.BaseFileName, "book one.xlsm");
  assert.equal(info.UserId, "victor");
  assert.equal(info.UserFriendlyName, "Victor V");
  assert.equal(info.UserCanWrite, true);
  assert.equal((await call("", { proof: false })).status, 500, "no proof");
  assert.equal((await call("", { headers: { "x-wopi-proof": Buffer.alloc(256).toString("base64"), "x-wopi-proofold": Buffer.alloc(256, 1).toString("base64") } })).status, 500, "forged proof");
  assert.equal((await call("", { tok: token + "x" })).status, 401, "broken token");
  assert.equal((await call("", { path: "/wopi/files/AAAAAAAAAAAAAAAAAAAAAAAA" })).status, 401, "token for another session");
  assert.deepEqual(Buffer.from(await (await call("/contents")).arrayBuffer()), original);

  const saved = Buffer.from("PK edited xlsm, longer");
  assert.equal((await call("/contents", { method: "POST", headers: { "x-wopi-override": "PUT" }, body: saved })).status, 409, "PutFile without the lock");
  assert.equal((await call("", { method: "POST", headers: { "x-wopi-override": "LOCK", "x-wopi-lock": "L" } })).status, 200);
  assert.equal((await call("/contents", { method: "POST", headers: { "x-wopi-override": "PUT", "x-wopi-lock": "L" }, body: saved })).status, 200);
  const f = eg.byGroup.get("g1");
  assert.equal(f.versions.length, 2, "a new version of the same file");
  assert.deepEqual(f.versions[1].data, saved);
  assert.equal(f.versions[1].by, "victor", "written with the person's own token");
  assert.ok(eg.calls.includes(`POST /pubapi/v1/fs-content${encodeURI("/Shared/Отчёты/book one.xlsm")}`), "upload goes to the file's path");
  assert.deepEqual(Buffer.from(await (await call("/contents")).arrayBuffer()), saved, "GetFile reads the new version");

  // A viewer's invocation opens read-only; a token without write rights cannot save even in edit mode.
  const viewPage = await (await fetch(`${base}${new URL((await (await invocation({ token: "ro-anna" }, "view")).json()).redirect).pathname}`)).text();
  assert.match(viewPage, /\/f1\/wopi\/view\?/);
  const roPage = await (await fetch(`${base}${new URL((await (await invocation({ token: "ro-anna" })).json()).redirect).pathname}`)).text();
  const roTok = roPage.match(/name="access_token" value="([^"]+)"/)[1];
  const roPath = new URL(decodeURIComponent(roPage.match(/action="([^"]+)"/)[1].replace(/&#38;/g, "&").split("WOPISrc=")[1])).pathname;
  assert.equal((await call("", { method: "POST", tok: roTok, path: roPath, headers: { "x-wopi-override": "LOCK", "x-wopi-lock": "R" } })).status, 200);
  assert.equal((await call("/contents", { method: "POST", tok: roTok, path: roPath, headers: { "x-wopi-override": "PUT", "x-wopi-lock": "R" }, body: Buffer.from("x") })).status, 401, "Egnyte refuses, the editor is told no");
  assert.equal(f.versions.length, 2);
});
