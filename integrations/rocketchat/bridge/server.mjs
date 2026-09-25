// SumOffice ↔ Rocket.Chat bridge: the WOPI host SumOffice talks to for files posted
// in Rocket.Chat. It never touches Rocket.Chat's database or REST API directly: the
// SumOffice Rocket.Chat app (../app) reads uploads for it and posts new versions.
//
//   GET  /rocketchat/open?t=…            the link from the app's dialog: opens the editor
//   POST /rocketchat/pending             the app collects a saved version (signed call)
//   GET  /wopi/files/{id}                CheckFileInfo
//   POST /wopi/files/{id}                LOCK / UNLOCK / REFRESH_LOCK / GET_LOCK
//   GET  /wopi/files/{id}/contents       GetFile
//   POST /wopi/files/{id}/contents       PutFile — posted into the room as a new version
//
// A saved version is a new upload (Rocket.Chat does not replace files in place). The
// bridge remembers which upload is the latest for each opened file in STATE_FILE, so
// the next open and the next GetFile read the newest version.
//
// Node 20+, no dependencies. Configuration is in environment variables (README.md).

import { createServer } from "node:http";
import { createHmac, createPublicKey, randomBytes, timingSafeEqual, verify as rsaVerify } from "node:crypto";
import { readFileSync, writeFileSync, renameSync } from "node:fs";

const EXTENSIONS = ["xlsx", "xlsm", "xlsb", "docx"];
const TOKEN_TTL = 10 * 3600;       // seconds
const CALL_TTL = 120;              // seconds, bridge ↔ app calls
const PENDING_TTL = 5 * 60 * 1000; // a saved version waits this long for the app
const LOCK_TTL = 30 * 60 * 1000;   // MS-WOPI: 30 minutes
const PROOF_WINDOW = 20 * 60;      // MS-WOPI: 20 minutes of clock skew
const DISCOVERY_TTL = 3600 * 1000;
const MAX_FILE = 100 * 1024 * 1024;

export function config(env = process.env) {
  const c = {
    port: Number(env.PORT ?? 8789),
    host: env.HOST ?? "0.0.0.0",
    rocketchatUrl: (env.ROCKETCHAT_URL ?? "").replace(/\/+$/, ""),
    appId: env.APP_ID ?? "5b1d6a52-7f7e-4c0e-9a7b-3f2d0c8e9b41",
    secret: env.BRIDGE_SECRET ?? "",
    tokenKey: env.TOKEN_KEY ?? env.BRIDGE_SECRET ?? "",
    publicUrl: (env.PUBLIC_URL ?? "").replace(/\/+$/, ""),
    discoveryUrl: env.SUMOFFICE_DISCOVERY_URL ?? "",
    verifyProof: env.VERIFY_PROOF !== "0",
    stateFile: env.STATE_FILE ?? "",
  };
  for (const k of ["rocketchatUrl", "secret", "publicUrl", "discoveryUrl"]) {
    if (!c[k]) throw new Error(`missing setting: ${k}`);
  }
  if (c.secret.length < 16) throw new Error("BRIDGE_SECRET must be at least 16 characters");
  return c;
}

// ---- signatures ----------------------------------------------------------------

const b64 = (buf) => Buffer.from(buf).toString("base64url");
const unb64 = (s) => Buffer.from(s, "base64url");

function same(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// The same format as the app: base64url(JSON) "." HMAC-SHA256 with "sumoffice-rocketchat:<secret>".
function mac(key, body) { return createHmac("sha256", `sumoffice-rocketchat:${key}`).update(body).digest("base64url"); }
export function signed(key, payload) { const body = b64(JSON.stringify(payload)); return `${body}.${mac(key, body)}`; }
export function unsigned(key, text) {
  const [body, sig] = String(text ?? "").split(".");
  if (!body || !sig || !same(sig, mac(key, body))) return null;
  try { const p = JSON.parse(unb64(body).toString()); return p.e > Date.now() / 1000 ? p : null; } catch { return null; }
}
const soon = (s) => Math.floor(Date.now() / 1000) + s;

export function fileId(uploadId, roomId) { return b64(JSON.stringify([String(uploadId), String(roomId)])); }
function parseFileId(id) {
  try {
    const [f, r] = JSON.parse(unb64(id).toString());
    return typeof f === "string" && typeof r === "string" && /^[\w-]+$/.test(f) && /^[\w-]+$/.test(r) ? { f, r } : null;
  } catch { return null; }
}

// ---- latest version of each opened file ---------------------------------------

let latest = {};
function loadState(c) { try { if (c.stateFile) latest = JSON.parse(readFileSync(c.stateFile, "utf8")); } catch { latest = {}; } }
function saveState(c) {
  if (!c.stateFile) return;
  writeFileSync(`${c.stateFile}.tmp`, JSON.stringify(latest));
  renameSync(`${c.stateFile}.tmp`, c.stateFile);
}
const current = (id, f) => latest[id]?.f ?? f.f;

// ---- discovery and proof keys --------------------------------------------------

const unxml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

let discoveryCache = { at: 0, url: "", actions: {}, proof: null };

async function discovery(c) {
  if (discoveryCache.url === c.discoveryUrl && Date.now() - discoveryCache.at < DISCOVERY_TTL) return discoveryCache;
  const res = await fetch(c.discoveryUrl, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`discovery: ${res.status}`);
  const xml = await res.text();
  const actions = {};
  for (const m of xml.matchAll(/<action\b([^>]*)>/g)) {
    const attr = Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], unxml(a[2])]));
    const key = `${(attr.ext ?? "").toLowerCase()}|${attr.name}`;
    if (attr.ext && attr.name && attr.urlsrc && !actions[key]) actions[key] = attr.urlsrc.replace(/<[^>]*>/g, "");
  }
  const pk = xml.match(/<proof-key\b([^>]*)>/);
  const proof = pk ? Object.fromEntries([...pk[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])) : null;
  discoveryCache = { at: Date.now(), url: c.discoveryUrl, actions, proof };
  return discoveryCache;
}

function rsaKey(modulus, exponent) {
  const url = (s) => Buffer.from(s, "base64").toString("base64url");
  return createPublicKey({ key: { kty: "RSA", n: url(modulus), e: url(exponent) }, format: "jwk" });
}

async function proofOk(c, req, token, url) {
  if (!c.verifyProof) return true;
  const keys = (await discovery(c)).proof;
  const ticks = String(req.headers["x-wopi-timestamp"] ?? "");
  const proof = String(req.headers["x-wopi-proof"] ?? "");
  const proofOld = String(req.headers["x-wopi-proofold"] ?? "");
  if (!keys?.modulus || !/^\d+$/.test(ticks) || !proof) return false;
  const seconds = Number((BigInt(ticks) - 621355968000000000n) / 10000000n);
  if (Math.abs(Date.now() / 1000 - seconds) > PROOF_WINDOW) return false;
  const t = Buffer.from(token); const u = Buffer.from(url.toUpperCase());
  const n = (x) => { const b = Buffer.alloc(4); b.writeInt32BE(x); return b; };
  const ts = Buffer.alloc(8); ts.writeBigInt64BE(BigInt(ticks));
  const data = Buffer.concat([n(t.length), t, n(u.length), u, n(8), ts]);
  const check = (key, sig) => { try { return !!sig && rsaVerify("RSA-SHA256", data, key, Buffer.from(sig, "base64")); } catch { return false; } };
  const current = rsaKey(keys.modulus, keys.exponent);
  if (check(current, proof) || check(current, proofOld)) return true;
  return !!(keys.oldmodulus && keys.oldexponent && check(rsaKey(keys.oldmodulus, keys.oldexponent), proof));
}

// ---- the Rocket.Chat app -------------------------------------------------------

async function appCall(c, op, payload) {
  const call = signed(c.secret, { op, ...payload, e: soon(CALL_TTL) });
  const res = await fetch(`${c.rocketchatUrl}/api/apps/public/${c.appId}/${op}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ call }), signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw Object.assign(new Error(`app ${op}: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`), { status: res.status });
  return res.json();
}

async function readFile(c, id, f) {
  const r = await appCall(c, "file", { f: current(id, f), r: f.r });
  return { name: r.name, data: Buffer.from(r.data, "base64") };
}

const pending = new Map(); // key -> { data, until }
function takePending(key) {
  const p = pending.get(key);
  pending.delete(key);
  return p && p.until > Date.now() ? p.data : null;
}

// ---- locks ---------------------------------------------------------------------

const locks = new Map();
function lockOf(id) {
  const l = locks.get(id);
  if (l && l.until < Date.now()) { locks.delete(id); return null; }
  return l?.value ?? null;
}
function setLock(id, value) {
  if (value === null) locks.delete(id); else locks.set(id, { value, until: Date.now() + LOCK_TTL });
}

// ---- HTTP ----------------------------------------------------------------------

function send(res, status, body = "", headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  res.writeHead(status, { "content-length": buf.length, ...headers });
  res.end(buf);
}

async function readBody(req, limit) {
  const chunks = []; let size = 0;
  for await (const ch of req) {
    size += ch.length;
    if (size > limit) throw Object.assign(new Error("too large"), { status: 413 });
    chunks.push(ch);
  }
  return Buffer.concat(chunks);
}

async function open(c, req, res) {
  const t = unsigned(c.secret, new URL(req.url, "http://x").searchParams.get("t"));
  if (!t || t.op !== "open" || !/^[\w-]+$/.test(t.f ?? "") || !/^[\w-]+$/.test(t.r ?? "")) return send(res, 401, "This link has expired. Open the file again from Rocket.Chat.", { "content-type": "text/plain; charset=utf-8" });
  const ext = String(t.n).split(".").pop().toLowerCase();
  if (!EXTENSIONS.includes(ext)) return send(res, 415, `SumOffice does not open .${ext} files.`, { "content-type": "text/plain; charset=utf-8" });
  const d = await discovery(c);
  const action = d.actions[`${ext}|${t.w ? "edit" : "view"}`] ?? d.actions[`${ext}|edit`];
  if (!action) return send(res, 503, `SumOffice discovery has no action for .${ext}.`, { "content-type": "text/plain; charset=utf-8" });
  const id = fileId(t.f, t.r);
  if (!latest[id]) { latest[id] = { f: t.f, n: t.n }; saveState(c); }
  const wopiSrc = `${c.publicUrl}/wopi/files/${id}`;
  const sep = /[?&]$/.test(action) ? "" : action.includes("?") ? "&" : "?";
  const expires = soon(TOKEN_TTL);
  const token = signed(c.tokenKey, { op: "wopi", id, u: t.u, un: t.un, w: !!t.w, n: t.n, e: expires });
  const h = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  send(res, 200, `<!doctype html><meta charset="utf-8"><title>${h(t.n)}</title>
<style>html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style>
<form id="f" method="post" target="ed" action="${h(`${action}${sep}WOPISrc=${encodeURIComponent(wopiSrc)}`)}">
<input type="hidden" name="access_token" value="${h(token)}"><input type="hidden" name="access_token_ttl" value="${expires * 1000}"></form>
<iframe name="ed" title="SumOffice" allow="clipboard-read; clipboard-write; fullscreen"></iframe>
<script>document.getElementById("f").submit()</script>`, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
}

async function collect(c, req, res) {
  const body = JSON.parse((await readBody(req, 16 * 1024)).toString() || "{}");
  const p = unsigned(c.secret, body.call);
  if (!p || p.op !== "pending") return send(res, 401);
  const data = takePending(String(p.k));
  if (!data) return send(res, 404);
  send(res, 200, { data: data.toString("base64") }, { "content-type": "application/json" });
}

async function wopi(c, req, res, id, contents) {
  const url = new URL(req.url, "http://x");
  const token = url.searchParams.get("access_token") ?? "";
  const p = unsigned(c.tokenKey, token);
  const f = parseFileId(id);
  if (!p || p.op !== "wopi" || p.id !== id || !f) return send(res, 401);
  if (!(await proofOk(c, req, token, `${c.publicUrl}${req.url}`))) return send(res, 500, "proof");
  const method = req.method;
  const override = String(req.headers["x-wopi-override"] ?? "");
  const sent = String(req.headers["x-wopi-lock"] ?? "");

  if (contents && method === "GET") {
    const file = await readFile(c, id, f);
    return send(res, 200, file.data, { "content-type": "application/octet-stream", "x-wopi-itemversion": current(id, f) });
  }
  if (contents && method === "POST") {
    if (override !== "PUT") return send(res, 400);
    if (!p.w) return send(res, 401);
    const lock = lockOf(id);
    if (lock !== null && lock !== sent) return send(res, 409, "", { "x-wopi-lock": lock });
    if (lock === null) return send(res, 409, "", { "x-wopi-lock": "" }); // files in a chat are never empty
    const data = await readBody(req, MAX_FILE);
    const key = b64(randomBytes(18));
    pending.set(key, { data, until: Date.now() + PENDING_TTL });
    try {
      const r = await appCall(c, "save", { r: f.r, u: p.u, n: latest[id]?.n ?? p.n, k: key });
      latest[id] = { f: r.fileId, n: latest[id]?.n ?? p.n };
      saveState(c);
    } finally {
      pending.delete(key);
    }
    return send(res, 200, "", { "x-wopi-itemversion": latest[id].f });
  }
  if (method === "GET") {
    const file = await readFile(c, id, f);
    return send(res, 200, {
      BaseFileName: latest[id]?.n ?? p.n,
      Size: file.data.length,
      OwnerId: f.r,
      UserId: p.u,
      UserFriendlyName: p.un,
      Version: current(id, f),
      UserCanWrite: p.w,
      ReadOnly: !p.w,
      UserCanNotWriteRelative: true,
      SupportsLocks: true,
      SupportsGetLock: true,
      SupportsUpdate: true,
      PostMessageOrigin: c.publicUrl,
    }, { "content-type": "application/json" });
  }
  if (method !== "POST") return send(res, 405);
  const lock = lockOf(id);
  if (override === "GET_LOCK") return send(res, 200, "", { "x-wopi-lock": lock ?? "" });
  if (!["LOCK", "UNLOCK", "REFRESH_LOCK"].includes(override)) return send(res, 501);
  if (!p.w) return send(res, 401);
  if (override === "LOCK") {
    const old = req.headers["x-wopi-oldlock"];
    if (lock !== null && lock !== sent && lock !== old) return send(res, 409, "", { "x-wopi-lock": lock });
    setLock(id, sent);
    return send(res, 200);
  }
  if (lock === null || lock !== sent) return send(res, 409, "", { "x-wopi-lock": lock ?? "" });
  setLock(id, override === "UNLOCK" ? null : sent);
  return send(res, 200);
}

export function start(c = config()) {
  loadState(c);
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://x").pathname;
      if (path === "/healthz") return send(res, 200, "ok");
      if (path === "/rocketchat/open" && req.method === "GET") return await open(c, req, res);
      if (path === "/rocketchat/pending" && req.method === "POST") return await collect(c, req, res);
      const m = path.match(/^\/wopi\/files\/([A-Za-z0-9_-]+)(\/contents)?$/);
      if (m) return await wopi(c, req, res, m[1], !!m[2]);
      return send(res, 404);
    } catch (e) {
      console.error(`[sumoffice-rocketchat] ${req.method} ${req.url.split("?")[0]}: ${e.message}`);
      if (!res.headersSent) send(res, e.status === 413 ? 413 : e.status === 404 ? 404 : 500);
    }
  });
  server.listen(c.port, c.host);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const c = config();
  start(c);
  console.log(`[sumoffice-rocketchat] listening on ${c.host}:${c.port}, Rocket.Chat ${c.rocketchatUrl}, app ${c.appId}`);
}
