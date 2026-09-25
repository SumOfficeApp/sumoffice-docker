// SumOffice ↔ Egnyte bridge: a UI Integration Framework app and the WOPI host SumOffice
// talks to for files stored in Egnyte.
//
//   POST /egnyte/invoke?mode=edit|view   Egnyte's back end sends the invocation (selected file,
//                                        user, domain, Public API token); we answer {redirect}
//   GET  /egnyte/open/{id}               the one-time link Egnyte opens in a new tab → the editor
//   GET  /wopi/files/{id}                CheckFileInfo
//   POST /wopi/files/{id}                LOCK / UNLOCK / REFRESH_LOCK / GET_LOCK
//   GET  /wopi/files/{id}/contents       GetFile
//   POST /wopi/files/{id}/contents       PutFile — a new version of the same Egnyte file
//
// The Egnyte token never reaches the browser: it stays in this process's memory, bound to
// the editing session (Egnyte's own rule for UI integrations). A restart of the bridge
// means the file has to be opened again from Egnyte.
//
// Node 20+, no dependencies. Configuration is in environment variables (README.md).

import { createServer } from "node:http";
import { createHmac, createPublicKey, randomBytes, timingSafeEqual, verify as rsaVerify } from "node:crypto";

const EXTENSIONS = ["xlsx", "xlsm", "xlsb", "docx"];
const TOKEN_TTL = 10 * 3600;         // seconds, WOPI access token
const INVOCATION_TTL = 5 * 60 * 1000; // Egnyte: the browser-facing URL expires in 2–5 minutes
const SESSION_TTL = 24 * 3600 * 1000; // a tab left open for a day still works
const LOCK_TTL = 30 * 60 * 1000;     // MS-WOPI: 30 minutes
const PROOF_WINDOW = 20 * 60;        // MS-WOPI: 20 minutes of clock skew
const DISCOVERY_TTL = 3600 * 1000;
const MAX_FILE = 100 * 1024 * 1024;  // Egnyte's single-request upload limit

export function config(env = process.env) {
  const c = {
    port: Number(env.PORT ?? 8790),
    host: env.HOST ?? "0.0.0.0",
    tokenKey: env.TOKEN_KEY ?? "",
    publicUrl: (env.PUBLIC_URL ?? "").replace(/\/+$/, ""),
    discoveryUrl: env.SUMOFFICE_DISCOVERY_URL ?? "",
    verifyProof: env.VERIFY_PROOF !== "0",
    // Egnyte domains this bridge serves, comma-separated (acme.egnyte.com). Empty: any *.egnyte.com.
    domains: (env.EGNYTE_DOMAINS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    // Tests only: where the Public API of a domain lives. Default https://{domain}.
    apiBase: env.EGNYTE_API_BASE ?? "https://{domain}",
  };
  for (const k of ["tokenKey", "publicUrl", "discoveryUrl"]) {
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
function mac(key, body) { return createHmac("sha256", `sumoffice-egnyte:${key}`).update(body).digest("base64url"); }
function signed(key, payload) { const body = b64(JSON.stringify(payload)); return `${body}.${mac(key, body)}`; }
function unsigned(key, text) {
  const [body, sig] = String(text ?? "").split(".");
  if (!body || !sig || !same(sig, mac(key, body))) return null;
  try { const p = JSON.parse(unb64(body).toString()); return p.e > Date.now() / 1000 ? p : null; } catch { return null; }
}
const newId = () => b64(randomBytes(18));

function domainOk(c, domain) {
  const d = String(domain ?? "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.(qa-)?egnyte\.com$/.test(d)) return false;
  return c.domains.length === 0 || c.domains.includes(d);
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

// ---- Egnyte Public API ---------------------------------------------------------

const invocations = new Map(); // one-time id -> { input, mode, until }
const sessions = new Map();    // WOPI file id -> { domain, token, groupId, name, user, canWrite, until }

function pathUrl(path) { return String(path).split("/").map(encodeURIComponent).join("/"); }

async function egnyte(c, s, method, path, { body, headers = {} } = {}) {
  const res = await fetch(`${c.apiBase.replace("{domain}", s.domain)}${path}`, {
    method, body, headers: { authorization: `Bearer ${s.token}`, ...headers }, redirect: "error", signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`egnyte ${method} ${path.split("?")[0]}: ${res.status} ${text.slice(0, 200)}`), { status: res.status });
  }
  return res;
}

async function meta(c, s) {
  return (await egnyte(c, s, "GET", `/pubapi/v1/fs/ids/file/${encodeURIComponent(s.groupId)}`)).json();
}

async function download(c, s) {
  const res = await egnyte(c, s, "GET", `/pubapi/v1/fs-content/ids/file/${encodeURIComponent(s.groupId)}`);
  return Buffer.from(await res.arrayBuffer());
}

// A POST to the file's path adds a new version of the same file (same group_id).
async function upload(c, s, data) {
  const m = await meta(c, s);
  const res = await egnyte(c, s, "POST", `/pubapi/v1/fs-content${pathUrl(m.path)}`, { body: data, headers: { "content-type": "application/octet-stream" } });
  return res.json();
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

async function invoke(c, req, res) {
  const url = new URL(req.url, "http://x");
  const mode = url.searchParams.get("mode") === "view" ? "view" : "edit";
  const input = JSON.parse((await readBody(req, 1024 * 1024)).toString() || "{}");
  const item = input.items?.[0];
  if (!domainOk(c, input.domain) || !input.token || !item || item.is_folder || !item.group_id) return send(res, 400, { error: "bad invocation" }, { "content-type": "application/json" });
  const id = newId();
  invocations.set(id, { input, mode, until: Date.now() + INVOCATION_TTL });
  send(res, 200, { redirect: `${c.publicUrl}/egnyte/open/${id}` }, { "content-type": "application/json" });
}

async function open(c, req, res, invId) {
  const inv = invocations.get(invId);
  invocations.delete(invId); // one-time
  const text = (status, msg) => send(res, status, msg, { "content-type": "text/plain; charset=utf-8" });
  if (!inv || inv.until < Date.now()) return text(410, "This link has expired. Open the file again from Egnyte.");
  const { input, mode } = inv;
  const item = input.items[0];
  const ext = String(item.name).split(".").pop().toLowerCase();
  if (!EXTENSIONS.includes(ext)) return text(415, `SumOffice does not open .${ext} files.`);
  const d = await discovery(c);
  const action = d.actions[`${ext}|${mode}`] ?? d.actions[`${ext}|edit`];
  if (!action) return text(503, `SumOffice discovery has no action for .${ext}.`);
  const u = input.userInfo ?? {};
  const id = newId();
  sessions.set(id, {
    domain: String(input.domain).toLowerCase(), token: input.token, groupId: item.group_id, name: item.name,
    user: String(u.username ?? u.id ?? ""), userName: [u.first_name, u.last_name].filter(Boolean).join(" ") || String(u.username ?? ""),
    canWrite: mode === "edit", until: Date.now() + SESSION_TTL,
  });
  const expires = Math.floor(Date.now() / 1000) + TOKEN_TTL;
  const token = signed(c.tokenKey, { op: "wopi", id, e: expires });
  const wopiSrc = `${c.publicUrl}/wopi/files/${id}`;
  const sep = /[?&]$/.test(action) ? "" : action.includes("?") ? "&" : "?";
  const h = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  send(res, 200, `<!doctype html><meta charset="utf-8"><title>${h(item.name)}</title>
<style>html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style>
<form id="f" method="post" target="ed" action="${h(`${action}${sep}WOPISrc=${encodeURIComponent(wopiSrc)}`)}">
<input type="hidden" name="access_token" value="${h(token)}"><input type="hidden" name="access_token_ttl" value="${expires * 1000}"></form>
<iframe name="ed" title="SumOffice" allow="clipboard-read; clipboard-write; fullscreen"></iframe>
<script>document.getElementById("f").submit()</script>`, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
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
    const data = await download(c, s);
    return send(res, 200, data, { "content-type": "application/octet-stream" });
  }
  if (contents && method === "POST") {
    if (override !== "PUT") return send(res, 400);
    if (!s.canWrite) return send(res, 401);
    const lock = lockOf(id);
    if (lock !== null && lock !== sent) return send(res, 409, "", { "x-wopi-lock": lock });
    if (lock === null) return send(res, 409, "", { "x-wopi-lock": "" }); // an existing file is never empty here
    const data = await readBody(req, MAX_FILE);
    try {
      const r = await upload(c, s, data);
      return send(res, 200, "", { "x-wopi-itemversion": String(r.entry_id ?? r.checksum ?? "") });
    } catch (e) {
      // Egnyte refuses a write the person has no right to: the editor shows it as read-only.
      if (e.status === 403 || e.status === 401) return send(res, 401);
      throw e;
    }
  }
  if (method === "GET") {
    const m = await meta(c, s);
    return send(res, 200, {
      BaseFileName: m.name ?? s.name,
      Size: Number(m.size ?? 0),
      OwnerId: String(m.uploaded_by ?? s.domain),
      UserId: s.user,
      UserFriendlyName: s.userName,
      Version: String(m.entry_id ?? m.checksum ?? ""),
      UserCanWrite: s.canWrite,
      ReadOnly: !s.canWrite,
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
      if (path === "/egnyte/invoke" && req.method === "POST") return await invoke(c, req, res);
      const o = path.match(/^\/egnyte\/open\/([A-Za-z0-9_-]+)$/);
      if (o && req.method === "GET") return await open(c, req, res, o[1]);
      const m = path.match(/^\/wopi\/files\/([A-Za-z0-9_-]+)(\/contents)?$/);
      if (m) return await wopi(c, req, res, m[1], !!m[2]);
      return send(res, 404);
    } catch (e) {
      console.error(`[sumoffice-egnyte] ${req.method} ${req.url.split("?")[0]}: ${e.message}`);
      if (!res.headersSent) send(res, e.status === 413 ? 413 : e.status === 404 ? 404 : 500);
    }
  });
  server.listen(c.port, c.host);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const c = config();
  start(c);
  console.log(`[sumoffice-egnyte] listening on ${c.host}:${c.port}, domains ${c.domains.join(",") || "any *.egnyte.com"}`);
}
