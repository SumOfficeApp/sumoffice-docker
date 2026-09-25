// node --test integrations/kintone/bridge/test/
// The bridge against a mock kintone and a mock SumOffice discovery with real proof keys.
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { generateKeyPairSync, sign as rsaSign } from "node:crypto";
import { mockKintone } from "./mock-kintone.mjs";
import { start, config } from "../server.mjs";

const listen = (s) => new Promise((r) => s.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${s.address().port}`)));

function proofKeys() {
  const k = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = k.publicKey.export({ format: "jwk" });
  const std = (s) => Buffer.from(s, "base64url").toString("base64");
  return { privateKey: k.privateKey, modulus: std(jwk.n), exponent: std(jwk.e) };
}

function proofHeaders(key, token, url) {
  const ticks = BigInt(Date.now()) * 10000n + 621355968000000000n;
  const t = Buffer.from(token); const u = Buffer.from(url.toUpperCase());
  const n = (x) => { const b = Buffer.alloc(4); b.writeInt32BE(x); return b; };
  const ts = Buffer.alloc(8); ts.writeBigInt64BE(ticks);
  const sig = rsaSign("RSA-SHA256", Buffer.concat([n(t.length), t, n(u.length), u, n(8), ts]), key).toString("base64");
  return { "x-wopi-timestamp": String(ticks), "x-wopi-proof": sig, "x-wopi-proofold": sig };
}

test("ticket → CheckFileInfo → lock → GetFile → PutFile, with proof keys; refusals", async (t) => {
  const original = Buffer.from("PK original xlsm bytes");
  const other = Buffer.from("PK other file");
  const k = mockKintone({ records: { 1: { attachments: [{ name: "notes.txt", data: Buffer.from("x") }, { name: "book.xlsm", data: original }, { name: "other.docx", data: other }] } } });
  const kintoneUrl = await listen(k.server);
  const keys = proofKeys();
  const disco = createServer((req, res) => res.end(`<wopi-discovery><net-zone name="external-https"><app name="Excel">
    <action name="edit" ext="xlsm" urlsrc="https://office.example/f1/wopi/edit?&lt;ui=UI_LLCC&amp;&gt;"/></app></net-zone>
    <proof-key value="x" modulus="${keys.modulus}" exponent="${keys.exponent}" oldmodulus="${keys.modulus}" oldexponent="${keys.exponent}"/></wopi-discovery>`));
  const discoUrl = await listen(disco);
  const bridge = start(config({ PORT: "0", HOST: "127.0.0.1", KINTONE_BASE_URL: kintoneUrl, KINTONE_API_TOKENS: "7:tok-7",
    BRIDGE_SECRET: "s".repeat(24), PUBLIC_URL: "http://placeholder", SUMOFFICE_DISCOVERY_URL: `${discoUrl}/hosting/discovery` }));
  await new Promise((r) => bridge.once("listening", r));
  const base = `http://127.0.0.1:${bridge.address().port}`;
  t.after(() => { bridge.close(); k.server.close(); disco.close(); });

  const ticketBody = { app: "7", record: "1", field: "attachments", index: 1, name: "book.xlsm", canWrite: true, user: { code: "victor", name: "Victor" } };
  const post = (path, body, headers = {}) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  assert.equal((await post("/kintone/ticket", ticketBody)).status, 401, "ticket without the secret");
  assert.equal((await post("/kintone/ticket", ticketBody, { "x-sumoffice-secret": "wrong".repeat(5) })).status, 401);
  assert.equal((await post("/kintone/ticket", { ...ticketBody, name: "other.docx" }, { "x-sumoffice-secret": "s".repeat(24) })).status, 404, "name must match the slot");
  assert.equal((await post("/kintone/ticket", { ...ticketBody, index: 0, name: "notes.txt" }, { "x-sumoffice-secret": "s".repeat(24) })).status, 415);

  const r = await post("/kintone/ticket", ticketBody, { "x-sumoffice-secret": "s".repeat(24) });
  assert.equal(r.status, 200);
  const ticket = await r.json();
  assert.match(ticket.action, /^https:\/\/office\.example\/f1\/wopi\/edit\?WOPISrc=http%3A%2F%2Fplaceholder%2Fwopi%2Ffiles%2F/);
  const wopiPath = new URL(decodeURIComponent(ticket.action.split("WOPISrc=")[1])).pathname;
  const tok = encodeURIComponent(ticket.access_token);

  // Proof is signed over PUBLIC_URL + the request path, as the editor sees it.
  const call = (sub, { method = "GET", headers = {}, body, token = tok, proof = true } = {}) => {
    const path = `${wopiPath}${sub}?access_token=${token}`;
    const h = proof ? { ...proofHeaders(keys.privateKey, decodeURIComponent(token), `http://placeholder${path}`), ...headers } : headers;
    return fetch(`${base}${path}`, { method, headers: h, body });
  };

  const info = await call("");
  assert.equal(info.status, 200);
  const fi = await info.json();
  assert.equal(fi.BaseFileName, "book.xlsm");
  assert.equal(fi.UserCanWrite, true);
  assert.equal(fi.UserId, "victor");

  assert.equal((await call("", { proof: false })).status, 500, "no proof");
  assert.equal((await call("", { headers: { "x-wopi-proof": Buffer.alloc(256).toString("base64"), "x-wopi-proofold": Buffer.alloc(256, 1).toString("base64") } })).status, 500, "forged proof");
  assert.equal((await call("", { token: tok + "x" })).status, 401, "broken token");
  const otherId = Buffer.from(JSON.stringify(["7", "1", "attachments", 2])).toString("base64url");
  const stolen = await fetch(`${base}/wopi/files/${otherId}?access_token=${tok}`, { headers: proofHeaders(keys.privateKey, ticket.access_token, `http://placeholder/wopi/files/${otherId}?access_token=${tok}`) });
  assert.equal(stolen.status, 401, "token for another file");

  const got = await call("/contents");
  assert.equal(got.status, 200);
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), original);

  const saved = Buffer.from("PK edited xlsm bytes, longer than before");
  assert.equal((await call("/contents", { method: "POST", headers: { "x-wopi-override": "PUT" }, body: saved })).status, 409, "PutFile without the lock");
  assert.equal((await call("", { method: "POST", headers: { "x-wopi-override": "LOCK", "x-wopi-lock": "L1" } })).status, 200);
  const clash = await call("", { method: "POST", headers: { "x-wopi-override": "LOCK", "x-wopi-lock": "L2" } });
  assert.equal(clash.status, 409);
  assert.equal(clash.headers.get("x-wopi-lock"), "L1");
  assert.equal((await call("/contents", { method: "POST", headers: { "x-wopi-override": "PUT", "x-wopi-lock": "L1" }, body: saved })).status, 200);
  assert.equal((await call("", { method: "POST", headers: { "x-wopi-override": "UNLOCK", "x-wopi-lock": "L1" } })).status, 200);

  const rec = k.view("1");
  assert.deepEqual(rec.attachments.value.map((f) => f.name), ["notes.txt", "book.xlsm", "other.docx"], "slot order kept");
  assert.deepEqual(k.files.get(rec.attachments.value[1].fileKey).data, saved, "new contents in the same slot");
  assert.deepEqual(k.files.get(rec.attachments.value[2].fileKey).data, other, "other files untouched");
  assert.equal(rec.$revision.value, "2");

  const again = await call("/contents");
  assert.deepEqual(Buffer.from(await again.arrayBuffer()), saved, "GetFile after save reads the new file");
});
