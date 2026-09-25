// SumOffice ↔ Box bridge: the callback of a Box Web App Integration ("Open with SumOffice")
// and the WOPI host SumOffice talks to for files stored in Box.
//
//   GET|POST /box/callback              Box's popup integration sends file_id, auth_code, …;
//                                       we exchange the code and answer 303 → a one-time link
//   GET  /box/open/{id}                 the one-time link → the editor
//   GET  /wopi/files/{id}               CheckFileInfo
//   POST /wopi/files/{id}               LOCK / UNLOCK / REFRESH_LOCK / GET_LOCK
//   GET  /wopi/files/{id}/contents      GetFile
//   POST /wopi/files/{id}/contents      PutFile — a new version of the same Box file
//
// The Box access and refresh tokens never reach the browser: they stay in this process's
// memory, bound to the editing session. A restart of the bridge means the file has to be
// opened again from Box.
//
// Node 20+, no dependencies. Configuration is in environment variables (README.md).

import { createServer } from "node:http";
import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify as rsaVerify } from "node:crypto";

const EXTENSIONS = ["xlsx", "xlsm", "xlsb", "docx"];
const TOKEN_TTL = 10 * 3600;         // seconds, WOPI access token
const LINK_TTL = 2 * 60 * 1000;      // the one-time link the callback redirects to
const SESSION_TTL = 24 * 3600 * 1000; // a tab left open for a day still works
const LOCK_TTL = 30 * 60 * 1000;     // MS-WOPI: 30 minutes
const PROOF_WINDOW = 20 * 60;        // MS-WOPI: 20 minutes of clock skew
const DISCOVERY_TTL = 3600 * 1000;
const MAX_FILE = 50 * 1024 * 1024;   // Box's limit for a single-request upload
const FILE_FIELDS = "name,size,etag,sha1,permissions,owned_by";

export function config(env = process.env) {
  const c = {
    port: Number(env.PORT ?? 8796),
    host: env.HOST ?? "0.0.0.0",
    clientId: env.BOX_CLIENT_ID ?? "",
    clientSecret: env.BOX_CLIENT_SECRET ?? "",
    tokenKey: env.TOKEN_KEY ?? "",
    publicUrl: (env.PUBLIC_URL ?? "").replace(/\/+$/, ""),
    discoveryUrl: env.SUMOFFICE_DISCOVERY_URL ?? "",
    verifyProof: env.VERIFY_PROOF !== "0",
    // Tests only: where the Box API and the upload API live.
    apiBase: (env.BOX_API_BASE ?? "https://api.box.com").replace(/\/+$/, ""),
    uploadBase: (env.BOX_UPLOAD_BASE ?? "https://upload.box.com/api").replace(/\/+$/, ""),
  };
  for (const k of ["clientId", "clientSecret", "tokenKey", "publicUrl", "discoveryUrl"]) {
    if (!c[k]) throw new Error(`missing setting: ${k}`);
  }
  if (c.tokenKey.length < 16) throw new Error("TOKEN_KEY must be at least 16 characters");
  return c;
}

// ---- signatures and ids --------------------------------------------------------

const b64 = (buf) => Buffer.from(buf).toString("base64url");
const unb64 = (s) => Buffer.from(s, "base64url");
function same(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
function mac(key, body) { return createHmac("sha256", `sumoffice-box:${key}`).update(body).digest("base64url"); }
function signed(key, payload) { const body = b64(JSON.stringify(payload)); return `${body}.${mac(key, body)}`; }
function unsigned(key, text) {
  const [body, sig] = String(text ?? "").split(".");
  if (!body || !sig || !same(sig, mac(key, body))) return null;
  try { const p = JSON.parse(unb64(body).toString()); return p.e > Date.now() / 1000 ? p : null; } catch { return null; }
}
const newId = () => b64(randomBytes(18));

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

// ---- Box API -------------------------------------------------------------------

const links = new Map();    // one-time id -> { session, until }
const sessions = new Map(); // WOPI file id -> { fileId, access, refresh, expiresAt, user, userName, name, canWrite, etag, until }

const fail = (msg, status) => Object.assign(new Error(msg), { status });

// POST /oauth2/token with the app's own credentials: an authorization code or a refresh token.
async function grant(c, params) {
  const res = await fetch(`${c.apiBase}/oauth2/token`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, client_id: c.clientId, client_secret: c.clientSecret }).toString(),
  });
  const text = await res.text().catch(() => "");
  let j = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok || !j.access_token) throw fail(`box token (${params.grant_type}): ${res.status} ${String(j.error ?? text).slice(0, 200)}`, 401);
  return { access: j.access_token, refresh: j.refresh_token ?? "", expiresAt: Date.now() + Number(j.expires_in ?? 3600) * 1000 };
}

// Box refresh tokens are single-use: concurrent calls share one refresh.
async function refresh(c, s, seen) {
  if (s.access !== seen) return;
  if (!s.refreshing) {
    s.refreshing = (async () => {
      try {
        if (!s.refresh) throw fail("box token: no refresh token", 401);
        Object.assign(s, await grant(c, { grant_type: "refresh_token", refresh_token: s.refresh }));
      } finally { s.refreshing = null; }
    })();
  }
  await s.refreshing;
}

async function box(c, s, method, url, { body, headers = {}, redirect = "error" } = {}) {
  if (s.expiresAt - 60000 < Date.now()) await refresh(c, s, s.access);
  const once = () => fetch(url, { method, body, redirect, headers: { authorization: `Bearer ${s.access}`, ...headers }, signal: AbortSignal.timeout(120000) });
  const used = s.access;
  let res = await once();
  if (res.status === 401) { await res.arrayBuffer().catch(() => {}); await refresh(c, s, used); res = await once(); }
  if (!res.ok && !(redirect === "manual" && res.status >= 300 && res.status < 400)) {
    const text = await res.text().catch(() => "");
    throw fail(`box ${method} ${new URL(url).pathname}: ${res.status} ${text.slice(0, 200)}`, res.status);
  }
  return res;
}

async function meta(c, s) {
  return (await box(c, s, "GET", `${c.apiBase}/2.0/files/${encodeURIComponent(s.fileId)}?fields=${FILE_FIELDS}`)).json();
}

// /content answers 302 with a short-lived download URL on another host. It is followed
// without the Authorization header: the Box token must not leave api.box.com.
async function download(c, s) {
  const url = `${c.apiBase}/2.0/files/${encodeURIComponent(s.fileId)}/content`;
  const res = await box(c, s, "GET", url, { redirect: "manual" });
  if (res.status === 202) throw fail("box: the file is not ready for download yet", 503);
  if (res.status < 300) return Buffer.from(await res.arrayBuffer());
  const location = res.headers.get("location");
  if (!location) throw fail(`box download: ${res.status} without a location`, 502);
  const dl = await fetch(new URL(location, url), { redirect: "follow", signal: AbortSignal.timeout(120000) });
  if (!dl.ok) throw fail(`box download: ${dl.status}`, 502);
  return Buffer.from(await dl.arrayBuffer());
}

// POST upload.box.com/api/2.0/files/{id}/content adds a new version of the same file.
// If-Match: the etag the editor's copy came from, so a change made in Box meanwhile is not overwritten.
async function upload(c, s, data) {
  const boundary = `sumoffice-${newId()}`;
  const name = String(s.name).replace(/["\r\n\\]/g, "_");
  const attributes = JSON.stringify({ name: s.name, content_modified_at: new Date().toISOString().replace(/\.\d+Z$/, "Z") });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="attributes"\r\n\r\n${attributes}\r\n`),
    Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${name}"\r\ncontent-type: application/octet-stream\r\n\r\n`),
    data, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const headers = { "content-type": `multipart/form-data; boundary=${boundary}`, "content-md5": createHash("sha1").update(data).digest("hex") };
  if (s.etag) headers["if-match"] = s.etag;
  const res = await box(c, s, "POST", `${c.uploadBase}/2.0/files/${encodeURIComponent(s.fileId)}/content`, { body, headers });
  return (await res.json()).entries?.[0] ?? {};
}

function session(id) {
  const s = sessions.get(id);
  if (s && s.until < Date.now()) { sessions.delete(id); return null; }
  return s ?? null;
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

const text = (res, status, msg) => send(res, status, msg, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });

// Box opens the popup integration with the parameters configured in the developer console,
// in the query (GET) or as a form (POST). Only auth_code is trusted: the file is read with the
// token it yields, so a forged file_id reaches only what that person may reach anyway.
async function callback(c, req, res) {
  const url = new URL(req.url, "http://x");
  const params = new URLSearchParams(url.search);
  if (req.method === "POST") {
    for (const [k, v] of new URLSearchParams((await readBody(req, 64 * 1024)).toString())) params.set(k, v);
  }
  const fileId = params.get("file_id") ?? "";
  const code = params.get("auth_code") ?? "";
  if (!/^\d+$/.test(fileId) || !code) return text(res, 400, "Open the file from Box: More Options → Integrations → SumOffice.");
  let s;
  try {
    s = { fileId, ...(await grant(c, { grant_type: "authorization_code", code })) };
  } catch (e) {
    console.error(`[sumoffice-box] ${e.message}`);
    return text(res, 401, "Box did not accept the sign-in. Open the file again from Box.");
  }
  const me = await (await box(c, s, "GET", `${c.apiBase}/2.0/users/me?fields=id,name,login`)).json();
  const m = await meta(c, s);
  const ext = String(m.name).split(".").pop().toLowerCase();
  if (!EXTENSIONS.includes(ext)) return text(res, 415, `SumOffice does not open .${ext} files.`);
  const back = params.get("redirect_to_box_url") ?? "";
  Object.assign(s, {
    user: String(me.id ?? ""), userName: String(me.name ?? me.login ?? ""), name: m.name, etag: String(m.etag ?? ""),
    canWrite: !!m.permissions?.can_upload, closeUrl: /^https:\/\/([a-z0-9-]+\.)*box\.com\//i.test(back) ? back : "",
  });
  const id = newId();
  links.set(id, { session: s, until: Date.now() + LINK_TTL });
  send(res, 303, "", { location: `${c.publicUrl}/box/open/${id}`, "cache-control": "no-store" });
}

async function open(c, req, res, linkId) {
  const link = links.get(linkId);
  links.delete(linkId); // one-time
  if (!link || link.until < Date.now()) return text(res, 410, "This link has expired. Open the file again from Box.");
  const s = link.session;
  const ext = String(s.name).split(".").pop().toLowerCase();
  const d = await discovery(c);
  const action = d.actions[`${ext}|${s.canWrite ? "edit" : "view"}`] ?? d.actions[`${ext}|edit`];
  if (!action) return text(res, 503, `SumOffice discovery has no action for .${ext}.`);
  const id = newId();
  sessions.set(id, { ...s, until: Date.now() + SESSION_TTL });
  const expires = Math.floor(Date.now() / 1000) + TOKEN_TTL;
  const token = signed(c.tokenKey, { op: "wopi", id, e: expires });
  const wopiSrc = `${c.publicUrl}/wopi/files/${id}`;
  const sep = /[?&]$/.test(action) ? "" : action.includes("?") ? "&" : "?";
  const h = (v) => String(v).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  send(res, 200, `<!doctype html><meta charset="utf-8"><title>${h(s.name)}</title>
<style>html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style>
<form id="f" method="post" target="ed" action="${h(`${action}${sep}WOPISrc=${encodeURIComponent(wopiSrc)}`)}">
<input type="hidden" name="access_token" value="${h(token)}"><input type="hidden" name="access_token_ttl" value="${expires * 1000}"></form>
<iframe name="ed" title="SumOffice" allow="clipboard-read; clipboard-write; fullscreen"></iframe>
<script>document.getElementById("f").submit()</script>`, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" });
}

async function wopi(c, req, res, id, contents) {
  const url = new URL(req.url, "http://x");
  const token = url.searchParams.get("access_token") ?? "";
  const p = unsigned(c.tokenKey, token);
  const s = session(id);
  if (!p || p.op !== "wopi" || p.id !== id || !s) return send(res, 401);
  if (!(await proofOk(c, req, token, `${c.publicUrl}${req.url}`))) return send(res, 500, "proof");
  const method = req.method;
  const override = String(req.headers["x-wopi-override"] ?? "");
  const sent = String(req.headers["x-wopi-lock"] ?? "");

  if (contents && method === "GET") {
    const m = await meta(c, s);
    const data = await download(c, s);
    s.etag = String(m.etag ?? "");
    return send(res, 200, data, { "content-type": "application/octet-stream", "x-wopi-itemversion": s.etag });
  }
  if (contents && method === "POST") {
    if (override !== "PUT") return send(res, 400);
    if (!s.canWrite) return send(res, 401);
    const lock = lockOf(id);
    if (lock !== null && lock !== sent) return send(res, 409, "", { "x-wopi-lock": lock });
    if (lock === null) return send(res, 409, "", { "x-wopi-lock": "" }); // an existing file is never empty here
    const data = await readBody(req, MAX_FILE);
    try {
      const f = await upload(c, s, data);
      s.etag = String(f.etag ?? "");
      return send(res, 200, "", { "x-wopi-itemversion": s.etag });
    } catch (e) {
      // Box refuses a write the person has no right to: the editor shows it as read-only.
      if (e.status === 403 || e.status === 401) return send(res, 401);
      // The file changed in Box since the editor read it: never overwrite that version.
      if (e.status === 412) return send(res, 409, "", { "x-wopi-lock": lock, "x-wopi-lockfailurereason": "The file was changed in Box" });
      throw e;
    }
  }
  if (method === "GET") {
    const m = await meta(c, s);
    s.canWrite = !!m.permissions?.can_upload;
    return send(res, 200, {
      BaseFileName: m.name ?? s.name,
      Size: Number(m.size ?? 0),
      OwnerId: String(m.owned_by?.id ?? ""),
      UserId: s.user,
      UserFriendlyName: s.userName,
      Version: String(m.etag ?? m.sha1 ?? ""),
      UserCanWrite: s.canWrite,
      ReadOnly: !s.canWrite,
      UserCanNotWriteRelative: true,
      SupportsLocks: true,
      SupportsGetLock: true,
      SupportsUpdate: true,
      PostMessageOrigin: c.publicUrl,
      ...(s.closeUrl ? { CloseUrl: s.closeUrl } : {}),
    }, { "content-type": "application/json" });
  }
  if (method !== "POST") return send(res, 405);
  const lock = lockOf(id);
  if (override === "GET_LOCK") return send(res, 200, "", { "x-wopi-lock": lock ?? "" });
  if (!["LOCK", "UNLOCK", "REFRESH_LOCK"].includes(override)) return send(res, 501);
  if (!s.canWrite) return send(res, 401);
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
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://x").pathname;
      if (path === "/healthz") return send(res, 200, "ok");
      if (path === "/box/callback" && (req.method === "GET" || req.method === "POST")) return await callback(c, req, res);
      const o = path.match(/^\/box\/open\/([A-Za-z0-9_-]+)$/);
      if (o && req.method === "GET") return await open(c, req, res, o[1]);
      const m = path.match(/^\/wopi\/files\/([A-Za-z0-9_-]+)(\/contents)?$/);
      if (m) return await wopi(c, req, res, m[1], !!m[2]);
      return send(res, 404);
    } catch (e) {
      console.error(`[sumoffice-box] ${req.method} ${req.url.split("?")[0]}: ${e.message}`);
      if (!res.headersSent) send(res, [401, 404, 413].includes(e.status) ? e.status : 500);
    }
  });
  server.listen(c.port, c.host);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const c = config();
  start(c);
  console.log(`[sumoffice-box] listening on ${c.host}:${c.port}, Box API ${c.apiBase}`);
}
