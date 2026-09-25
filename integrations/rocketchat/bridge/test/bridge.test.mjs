// node --test integrations/rocketchat/bridge/test/bridge.test.mjs
// The bridge against a mock of the SumOffice Rocket.Chat app and a mock discovery with real proof keys.
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { generateKeyPairSync, sign as rsaSign } from "node:crypto";
import { start, config, signed, unsigned } from "../server.mjs";

const SECRET = "r".repeat(24);
const APP = "5b1d6a52-7f7e-4c0e-9a7b-3f2d0c8e9b41";
const listen = (s) => new Promise((r) => s.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${s.address().port}`)));
const json = (res, status, obj) => { const b = Buffer.from(JSON.stringify(obj)); res.writeHead(status, { "content-type": "application/json" }); res.end(b); };
const body = async (req) => { const c = []; for await (const x of req) c.push(x); return JSON.parse(Buffer.concat(c).toString() || "{}"); };

function proofHeaders(key, token, url) {
  const ticks = BigInt(Date.now()) * 10000n + 621355968000000000n;
  const t = Buffer.from(token); const u = Buffer.from(url.toUpperCase());
  const n = (x) => { const b = Buffer.alloc(4); b.writeInt32BE(x); return b; };
  const ts = Buffer.alloc(8); ts.writeBigInt64BE(ticks);
  const sig = rsaSign("RSA-SHA256", Buffer.concat([n(t.length), t, n(u.length), u, n(8), ts]), key).toString("base64");
  return { "x-wopi-timestamp": String(ticks), "x-wopi-proof": sig, "x-wopi-proofold": sig };
}

test("open → CheckFileInfo → lock → GetFile → PutFile posts a new version; next GetFile reads it", async (t) => {
  const uploads = new Map([["up1", { room: "R1", name: "book.xlsm", data: Buffer.from("PK original") }]]);
  let bridgeUrl = "";
  const posted = [];
  // What the app does: /file reads an upload of the room, /save collects the bytes from the bridge and uploads them.
  const app = createServer(async (req, res) => {
    const m = req.url.match(new RegExp(`^/api/apps/public/${APP}/(file|save)$`));
    if (!m) return json(res, 404, {});
    const p = unsigned(SECRET, (await body(req)).call);
    if (!p || p.op !== m[1]) return json(res, 401, {});
    if (p.op === "file") {
      const u = uploads.get(p.f);
      if (!u || u.room !== p.r) return json(res, 404, {});
      return json(res, 200, { name: u.name, data: u.data.toString("base64") });
    }
    const r = await fetch(`${bridgeUrl}/rocketchat/pending`, { method: "POST", body: JSON.stringify({ call: signed(SECRET, { op: "pending", k: p.k, e: Date.now() / 1000 + 60 }) }) });
    if (r.status !== 200) return json(res, 502, {});
    const id = `up${uploads.size + 1}`;
    uploads.set(id, { room: p.r, name: p.n, data: Buffer.from((await r.json()).data, "base64") });
    posted.push({ id, user: p.u, room: p.r });
    return json(res, 200, { fileId: id });
  });
  const rc = await listen(app);
  const k = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = k.publicKey.export({ format: "jwk" });
  const std = (s) => Buffer.from(s, "base64url").toString("base64");
  const disco = createServer((req, res) => res.end(`<wopi-discovery><net-zone name="external-https"><app name="Excel">
    <action name="edit" ext="xlsm" urlsrc="https://office.example/f1/wopi/edit?&lt;ui=UI_LLCC&amp;&gt;"/></app></net-zone>
    <proof-key value="x" modulus="${std(jwk.n)}" exponent="${std(jwk.e)}"/></wopi-discovery>`));
  const discoUrl = await listen(disco);
  const bridge = start(config({ PORT: "0", HOST: "127.0.0.1", ROCKETCHAT_URL: rc, APP_ID: APP, BRIDGE_SECRET: SECRET,
    PUBLIC_URL: "http://placeholder", SUMOFFICE_DISCOVERY_URL: `${discoUrl}/hosting/discovery` }));
  await new Promise((r) => bridge.once("listening", r));
  bridgeUrl = `http://127.0.0.1:${bridge.address().port}`;
  t.after(() => { bridge.close(); app.close(); disco.close(); });

  const ticket = (p) => signed(SECRET, { op: "open", f: "up1", n: "book.xlsm", r: "R1", m: "msg1", u: "victor", un: "Victor", w: true, e: Date.now() / 1000 + 300, ...p });
  assert.equal((await fetch(`${bridgeUrl}/rocketchat/open?t=${ticket({ e: 1 })}`)).status, 401, "expired ticket");
  assert.equal((await fetch(`${bridgeUrl}/rocketchat/open?t=${signed("x".repeat(20), { op: "open", f: "up1", n: "book.xlsm", r: "R1", e: Date.now() / 1000 + 60 })}`)).status, 401, "foreign key");
  const page = await (await fetch(`${bridgeUrl}/rocketchat/open?t=${ticket({})}`)).text();
  const action = page.match(/action="([^"]+)"/)[1].replace(/&#38;/g, "&");
  const token = page.match(/name="access_token" value="([^"]+)"/)[1];
  assert.match(action, /^https:\/\/office\.example\/f1\/wopi\/edit\?WOPISrc=/);
  const wopiPath = new URL(decodeURIComponent(action.split("WOPISrc=")[1])).pathname;
  const call = (sub, { method = "GET", headers = {}, body: data, proof = true } = {}) => {
    const path = `${wopiPath}${sub}?access_token=${encodeURIComponent(token)}`;
    return fetch(`${bridgeUrl}${path}`, { method, body: data, headers: proof ? { ...proofHeaders(k.privateKey, token, `http://placeholder${path}`), ...headers } : headers });
  };

  const info = await (await call("")).json();
  assert.equal(info.BaseFileName, "book.xlsm");
  assert.equal(info.UserId, "victor");
  assert.equal((await call("", { proof: false })).status, 500, "no proof");
  assert.deepEqual(Buffer.from(await (await call("/contents")).arrayBuffer()), Buffer.from("PK original"));

  const saved = Buffer.from("PK edited, a longer file");
  assert.equal((await call("/contents", { method: "POST", headers: { "x-wopi-override": "PUT" }, body: saved })).status, 409, "PutFile without the lock");
  assert.equal((await call("", { method: "POST", headers: { "x-wopi-override": "LOCK", "x-wopi-lock": "L" } })).status, 200);
  assert.equal((await call("/contents", { method: "POST", headers: { "x-wopi-override": "PUT", "x-wopi-lock": "L" }, body: saved })).status, 200);
  assert.deepEqual(posted, [{ id: "up2", user: "victor", room: "R1" }], "posted once, as the editor, into the same room");
  assert.deepEqual(uploads.get("up2").data, saved);
  assert.deepEqual(uploads.get("up1").data, Buffer.from("PK original"), "the original message keeps its file");
  assert.deepEqual(Buffer.from(await (await call("/contents")).arrayBuffer()), saved, "GetFile reads the new version");
  assert.equal((await fetch(`${bridgeUrl}/rocketchat/pending`, { method: "POST", body: JSON.stringify({ call: signed(SECRET, { op: "pending", k: "used", e: Date.now() / 1000 + 60 }) }) })).status, 404, "a collected version is gone");
});
