// SumOffice ↔ kintone bridge: a small WOPI host backed by the kintone REST API.
//
// kintone keeps files in attachment fields and has no WOPI host of its own, so this
// service stands in for it. SumOffice (the WOPI client) calls the bridge; the bridge
// reads and writes the file in kintone with an app API token.
//
//   POST /kintone/ticket                 the kintone plugin asks to open one file
//   GET  /wopi/files/{id}                CheckFileInfo
//   POST /wopi/files/{id}                LOCK / UNLOCK / REFRESH_LOCK / GET_LOCK
//   GET  /wopi/files/{id}/contents       GetFile
//   POST /wopi/files/{id}/contents       PutFile — a new file in the same field slot
//
// The ticket call comes through kintone's plugin proxy, which adds the header
// X-SumOffice-Secret that the kintone administrator set in the plugin settings.
// People in kintone never see that secret.
//
// Node 20+, no dependencies. Configuration is in environment variables (README.md).

import { createServer } from "node:http";
import { createHmac, createPublicKey, timingSafeEqual, verify as rsaVerify } from "node:crypto";

const EXTENSIONS = ["xlsx", "xlsm", "xlsb", "docx"];
const TOKEN_TTL = 10 * 3600;       // seconds
const LOCK_TTL = 30 * 60 * 1000;   // MS-WOPI: 30 minutes
const PROOF_WINDOW = 20 * 60;      // MS-WOPI: 20 minutes of clock skew
const DISCOVERY_TTL = 3600 * 1000;
const MAX_FILE = 100 * 1024 * 1024;

export function config(env = process.env) {
  const tokens = {};
  for (const pair of (env.KINTONE_API_TOKENS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [app, ...token] = pair.split(":");
    tokens[app] = token.join(":");
  }
  const c = {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? "0.0.0.0",
    kintoneBase: (env.KINTONE_BASE_URL ?? "").replace(/\/+$/, ""),
    tokens,
    secret: env.BRIDGE_SECRET ?? "",
    tokenKey: env.TOKEN_KEY ?? env.BRIDGE_SECRET ?? "",
    publicUrl: (env.PUBLIC_URL ?? "").replace(/\/+$/, ""),
    discoveryUrl: env.SUMOFFICE_DISCOVERY_URL ?? "",
    verifyProof: env.VERIFY_PROOF !== "0",
  };
  for (const k of ["kintoneBase", "secret", "publicUrl", "discoveryUrl"]) {
    if (!c[k]) throw new Error(`missing setting: ${k}`);
  }
  if (c.secret.length < 16) throw new Error("BRIDGE_SECRET must be at least 16 characters");
  return c;
}

// ---- tokens and file ids -------------------------------------------------------

const b64 = (buf) => Buffer.from(buf).toString("base64url");
const unb64 = (s) => Buffer.from(s, "base64url");

export function fileId(app, record, field, index) {
  return b64(JSON.stringify([String(app), String(record), String(field), Number(index)]));
}

function parseFileId(id) {
  try {
    const [app, record, field, index] = JSON.parse(unb64(id).toString());
    if (/^\d+$/.test(app) && /^\d+$/.test(record) && typeof field === "string" && Number.isInteger(index) && index >= 0) {
      return { app, record, field, index };
    }
  } catch { /* falls through */ }
  return null;
}

function sign(key, body) {
  return createHmac("sha256", `sumoffice-kintone:${key}`).update(body).digest("base64url");
}

function same(a, b) {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function makeToken(c, { id, user, name, canWrite }) {
  const expires = Math.floor(Date.now() / 1000) + TOKEN_TTL;
  const body = b64(JSON.stringify({ f: id, u: user.code, n: user.name ?? user.code, w: !!canWrite, e: expires, fn: name }));
  return { token: `${body}.${sign(c.tokenKey, body)}`, expires };
}

function readToken(c, token, id) {
  const [body, mac] = String(token).split(".");
  if (!body || !mac || !same(mac, sign(c.tokenKey, body))) return null;
  try {
    const p = JSON.parse(unb64(body).toString());
    return p.f === id && p.e > Date.now() / 1000 ? p : null;
  } catch { return null; }
}

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

// ---- kintone REST --------------------------------------------------------------

async function kintone(c, app, method, path, { json, form } = {}) {
  const token = c.tokens[app];
  if (!token) throw Object.assign(new Error(`no API token for app ${app}`), { status: 403 });
  const headers = { "X-Cybozu-API-Token": token };
  let body;
  if (json) { headers["content-type"] = "application/json"; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await fetch(`${c.kintoneBase}${path}`, { method, headers, body, signal: AbortSignal.timeout(60000) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`kintone ${method} ${path.split("?")[0]}: ${res.status} ${text.slice(0, 200)}`), { status: res.status });
  }
  return res;
}

async function slot(c, f) {
  const res = await kintone(c, f.app, "GET", `/k/v1/record.json?app=${f.app}&id=${f.record}`);
  const { record } = await res.json();
  const field = record?.[f.field];
  if (!field || field.type !== "FILE") return null;
  const file = field.value?.[f.index];
  return file ? { record, field, file, revision: record.$revision?.value ?? "" } : null;
}

async function download(c, f, fileKey) {
  const res = await kintone(c, f.app, "GET", `/k/v1/file.json?fileKey=${encodeURIComponent(fileKey)}`);
  return Buffer.from(await res.arrayBuffer());
}

async function upload(c, f, name, contentType, data) {
  const form = new FormData();
  form.append("file", new Blob([data], { type: contentType || "application/octet-stream" }), name);
  const res = await kintone(c, f.app, "POST", "/k/v1/file.json", { form });
  return (await res.json()).fileKey;
}

// Replaces the file in its slot and keeps every other file of the field as it was.
async function replace(c, f, expectedName, data) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const s = await slot(c, f);
    if (!s || s.file.name !== expectedName) return false;
    const fileKey = await upload(c, f, s.file.name, s.file.contentType, data);
    const value = s.field.value.map((v, i) => ({ fileKey: i === f.index ? fileKey : v.fileKey }));
    try {
      await kintone(c, f.app, "PUT", "/k/v1/record.json", { json: { app: f.app, id: f.record, revision: s.revision, record: { [f.field]: { value } } } });
      return true;
    } catch (e) {
      if (e.status !== 409) throw e; // someone saved the record meanwhile: read it again
    }
  }
  throw new Error("kintone record keeps changing");
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

async function ticket(c, req, res) {
  if (!same(String(req.headers["x-sumoffice-secret"] ?? ""), c.secret)) return send(res, 401);
  const q = JSON.parse((await readBody(req, 64 * 1024)).toString() || "{}");
  const f = { app: String(q.app ?? ""), record: String(q.record ?? ""), field: String(q.field ?? ""), index: Number(q.index) };
  const id = parseFileId(fileId(f.app, f.record, f.field, Number.isInteger(f.index) ? f.index : -1));
  if (!id || !q.user?.code) return send(res, 400, { error: "bad request" }, { "content-type": "application/json" });
  const s = await slot(c, id);
  if (!s || s.file.name !== q.name) return send(res, 404, { error: "no such file" }, { "content-type": "application/json" });
  const ext = s.file.name.split(".").pop().toLowerCase();
  if (!EXTENSIONS.includes(ext)) return send(res, 415, { error: `SumOffice does not open .${ext}` }, { "content-type": "application/json" });
  const d = await discovery(c);
  const canWrite = !!q.canWrite;
  const action = d.actions[`${ext}|${canWrite ? "edit" : "view"}`] ?? d.actions[`${ext}|edit`];
  if (!action) return send(res, 503, { error: `discovery has no action for .${ext}` }, { "content-type": "application/json" });
  const idText = fileId(id.app, id.record, id.field, id.index);
  const wopiSrc = `${c.publicUrl}/wopi/files/${idText}`;
  const sep = /[?&]$/.test(action) ? "" : action.includes("?") ? "&" : "?";
  const { token, expires } = makeToken(c, { id: idText, user: q.user, name: s.file.name, canWrite });
  send(res, 200, { action: `${action}${sep}WOPISrc=${encodeURIComponent(wopiSrc)}`, access_token: token, access_token_ttl: expires * 1000 },
    { "content-type": "application/json" });
}

async function wopi(c, req, res, idText, contents) {
  const url = new URL(req.url, "http://x");
  const token = url.searchParams.get("access_token") ?? "";
  const p = readToken(c, token, idText);
  const f = parseFileId(idText);
  if (!p || !f) return send(res, 401);
  if (!(await proofOk(c, req, token, `${c.publicUrl}${req.url}`))) return send(res, 500, "proof");
  const method = req.method;
  const override = String(req.headers["x-wopi-override"] ?? "");
  const sent = String(req.headers["x-wopi-lock"] ?? "");

  if (contents && method === "GET") {
    const s = await slot(c, f);
    if (!s || s.file.name !== p.fn) return send(res, 404);
    return send(res, 200, await download(c, f, s.file.fileKey), { "content-type": "application/octet-stream", "x-wopi-itemversion": s.revision });
  }
  if (contents && method === "POST") {
    if (override !== "PUT") return send(res, 400);
    if (!p.w) return send(res, 401);
    const lock = lockOf(idText);
    if (lock !== null && lock !== sent) return send(res, 409, "", { "x-wopi-lock": lock });
    const data = await readBody(req, MAX_FILE);
    if (lock === null) {
      // MS-WOPI: without a lock only an empty file may be written.
      const s = await slot(c, f);
      if (s && Number(s.file.size ?? 0) > 0) return send(res, 409, "", { "x-wopi-lock": "" });
    }
    if (!(await replace(c, f, p.fn, data))) return send(res, 404);
    const s = await slot(c, f);
    return send(res, 200, "", { "x-wopi-itemversion": s?.revision ?? "" });
  }
  if (method === "GET") {
    const s = await slot(c, f);
    if (!s || s.file.name !== p.fn) return send(res, 404);
    return send(res, 200, {
      BaseFileName: s.file.name,
      Size: Number(s.file.size ?? 0),
      OwnerId: String(s.record.$id?.value ?? f.record),
      UserId: p.u,
      UserFriendlyName: p.n,
      Version: `${s.revision}`,
      UserCanWrite: p.w,
      ReadOnly: !p.w,
      UserCanNotWriteRelative: true,
      SupportsLocks: true,
      SupportsGetLock: true,
      SupportsUpdate: true,
      PostMessageOrigin: c.kintoneBase,
    }, { "content-type": "application/json" });
  }
  if (method !== "POST") return send(res, 405);
  const lock = lockOf(idText);
  if (override === "GET_LOCK") return send(res, 200, "", { "x-wopi-lock": lock ?? "" });
  if (!["LOCK", "UNLOCK", "REFRESH_LOCK"].includes(override)) return send(res, 501);
  if (!p.w) return send(res, 401);
  if (override === "LOCK") {
    const old = req.headers["x-wopi-oldlock"];
    if (lock !== null && lock !== sent && lock !== old) return send(res, 409, "", { "x-wopi-lock": lock });
    setLock(idText, sent);
    return send(res, 200);
  }
  if (lock === null || lock !== sent) return send(res, 409, "", { "x-wopi-lock": lock ?? "" });
  setLock(idText, override === "UNLOCK" ? null : sent);
  return send(res, 200);
}

export function start(c = config()) {
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://x").pathname;
      if (path === "/healthz") return send(res, 200, "ok");
      if (path === "/kintone/ticket" && req.method === "POST") return await ticket(c, req, res);
      const m = path.match(/^\/wopi\/files\/([A-Za-z0-9_-]+)(\/contents)?$/);
      if (m) return await wopi(c, req, res, m[1], !!m[2]);
      return send(res, 404);
    } catch (e) {
      console.error(`[sumoffice-kintone] ${req.method} ${req.url.split("?")[0]}: ${e.message}`);
      if (!res.headersSent) send(res, e.status === 413 ? 413 : 500);
    }
  });
  server.listen(c.port, c.host);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const c = config();
  start(c);
  console.log(`[sumoffice-kintone] listening on ${c.host}:${c.port}, kintone ${c.kintoneBase}, apps ${Object.keys(c.tokens).join(",") || "none"}`);
}
