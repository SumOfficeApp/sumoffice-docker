// SumOffice ↔ Google Drive bridge: the "Open with" app for Google Drive and the WOPI host
// SumOffice talks to for files stored in Drive.
//
//   GET  /google/open?state={…}          Drive's Open URL: the file chosen in "Open with" → Google sign-in
//   GET  /google/callback?code&state     the OAuth 2.0 redirect URI: code → tokens → the editor
//   GET  /wopi/files/{id}                CheckFileInfo
//   POST /wopi/files/{id}                LOCK / UNLOCK / REFRESH_LOCK / GET_LOCK
//   GET  /wopi/files/{id}/contents       GetFile
//   POST /wopi/files/{id}/contents       PutFile — a new revision of the same Drive file
//
// The Google access and refresh tokens never reach the browser: they stay in this process's
// memory, bound to the Google user and the editing session. The only scope asked for is
// drive.file, which is what "Open with" needs. A restart of the bridge means the file has
// to be opened again from Drive.
//
// Node 20+, no dependencies. Configuration is in environment variables (README.md).

import { createServer } from "node:http";
import { createHmac, createPublicKey, randomBytes, timingSafeEqual, verify as rsaVerify } from "node:crypto";

const EXTENSIONS = ["xlsx", "xlsm", "xlsb", "docx"];
const MIME = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel.sheet.macroEnabled.12": "xlsm",
  "application/vnd.ms-excel.sheet.binary.macroEnabled.12": "xlsb",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const FIELDS = "name,size,version,mimeType,capabilities(canEdit),headRevisionId,owners(displayName,permissionId)";
const COOKIE = "so_oauth_";          // + the state's nonce: several sign-ins may run side by side
const TOKEN_TTL = 10 * 3600;         // seconds, WOPI access token
const STATE_TTL = 10 * 60;           // seconds, from Drive's redirect to the OAuth callback
const SESSION_TTL = 24 * 3600 * 1000; // a tab left open for a day still works
const LOCK_TTL = 30 * 60 * 1000;     // MS-WOPI: 30 minutes
const PROOF_WINDOW = 20 * 60;        // MS-WOPI: 20 minutes of clock skew
const DISCOVERY_TTL = 3600 * 1000;
const MAX_FILE = 100 * 1024 * 1024;

export function config(env = process.env) {
  const oauthBase = (env.GOOGLE_OAUTH_BASE ?? "").replace(/\/+$/, "");
  const c = {
    port: Number(env.PORT ?? 8792),
    host: env.HOST ?? "0.0.0.0",
    tokenKey: env.TOKEN_KEY ?? "",
    publicUrl: (env.PUBLIC_URL ?? "").replace(/\/+$/, ""),
    discoveryUrl: env.SUMOFFICE_DISCOVERY_URL ?? "",
    verifyProof: env.VERIFY_PROOF !== "0",
    clientId: env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
    // Tests only: where Google's sign-in, token endpoint and Drive API live.
    authUrl: oauthBase ? `${oauthBase}/o/oauth2/v2/auth` : "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: oauthBase ? `${oauthBase}/token` : "https://oauth2.googleapis.com/token",
    apiBase: (env.GOOGLE_API_BASE ?? "https://www.googleapis.com").replace(/\/+$/, ""),
  };
  for (const k of ["tokenKey", "publicUrl", "discoveryUrl", "clientId", "clientSecret"]) {
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
function mac(key, body) { return createHmac("sha256", `sumoffice-google:${key}`).update(body).digest("base64url"); }
export function signed(key, payload) { const body = b64(JSON.stringify(payload)); return `${body}.${mac(key, body)}`; }
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

// ---- Google OAuth 2.0 ----------------------------------------------------------

const grants = new Map();     // Google user (permissionId) -> { access, refresh, exp, pending }
const sessions = new Map();   // WOPI file id -> { grant, fileId, resourceKey, name, mimeType, user, userName, canWrite, until }
const usedStates = new Map(); // state nonce -> expiry (seconds); a state works once

const redirectUri = (c) => `${c.publicUrl}/google/callback`;
const expiry = (j) => Date.now() + (Number(j.expires_in ?? 3600) - 60) * 1000;

function useOnce(n, e) {
  const now = Date.now() / 1000;
  for (const [k, x] of usedStates) if (x < now) usedStates.delete(k);
  if (usedStates.has(n)) return false;
  usedStates.set(n, e);
  return true;
}

async function tokenCall(c, params) {
  const res = await fetch(c.tokenUrl, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, ...params }),
    redirect: "error", signal: AbortSignal.timeout(15000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw Object.assign(new Error(`google token (${params.grant_type}): ${res.status} ${j.error ?? ""}`), { status: 401 });
  return j;
}

// One refresh at a time per Google user; every session of that user shares the result.
function refresh(c, g) {
  if (!g.refresh) return Promise.reject(Object.assign(new Error("google: access token expired, no refresh token"), { status: 401 }));
  g.pending ??= tokenCall(c, { grant_type: "refresh_token", refresh_token: g.refresh })
    .then((j) => { g.access = j.access_token; g.exp = expiry(j); if (j.refresh_token) g.refresh = j.refresh_token; })
    .finally(() => { g.pending = null; });
  return g.pending;
}

// ---- Google Drive API ----------------------------------------------------------

async function drive(c, s, method, path, { body, headers = {}, follow = false } = {}) {
  const g = s.grant;
  if (g.exp < Date.now() && g.refresh) await refresh(c, g);
  // Files shared by link may need their resource key (Drive's 2021 security update).
  const rk = s.resourceKey ? { "x-goog-drive-resource-keys": `${s.fileId}/${s.resourceKey}` } : {};
  for (let retried = false; ; retried = true) {
    const res = await fetch(`${c.apiBase}${path}`, {
      method, body, headers: { authorization: `Bearer ${g.access}`, ...rk, ...headers },
      redirect: follow ? "follow" : "error", signal: AbortSignal.timeout(120000),
    });
    if (res.status === 401 && !retried && g.refresh) { await res.body?.cancel(); await refresh(c, g); continue; }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw Object.assign(new Error(`drive ${method} ${path.split("?")[0]}: ${res.status} ${text.slice(0, 200)}`), { status: res.status });
    }
    return res;
  }
}

const filePath = (s) => `/drive/v3/files/${encodeURIComponent(s.fileId)}`;

async function whoami(c, s) {
  return ((await (await drive(c, s, "GET", `/drive/v3/about?fields=${encodeURIComponent("user(displayName,emailAddress,permissionId)")}`)).json()).user ?? {});
}

async function meta(c, s) {
  return (await drive(c, s, "GET", `${filePath(s)}?fields=${encodeURIComponent(FIELDS)}&supportsAllDrives=true`)).json();
}

async function download(c, s) {
  const res = await drive(c, s, "GET", `${filePath(s)}?alt=media&supportsAllDrives=true`, { follow: true });
  return Buffer.from(await res.arrayBuffer());
}

// A PATCH of the media adds a new revision of the same file (same id, same sharing).
async function upload(c, s, data) {
  const res = await drive(c, s, "PATCH", `/upload${filePath(s)}?uploadType=media&supportsAllDrives=true&fields=version,headRevisionId`,
    { body: data, headers: { "content-type": s.mimeType || "application/octet-stream" } });
  return res.json();
}

function extOf(m) {
  const ext = String(m.name ?? "").includes(".") ? String(m.name).split(".").pop().toLowerCase() : "";
  return EXTENSIONS.includes(ext) ? ext : MIME[m.mimeType] ?? ext;
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

function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie ?? "").split(";").map((p) => p.trim().split("=")).filter((p) => p[0]).map(([k, ...v]) => [k, v.join("=")]));
}

// Sends the browser to Google's sign-in. The state is HMAC-signed, lives ten minutes, works once,
// and is bound to this browser by a cookie named after its nonce.
function authorize(c, res, { f, rk, u }, consent) {
  const n = newId();
  const state = signed(c.tokenKey, { op: "oauth", f, rk, u, n, c: consent ? 1 : 0, e: Math.floor(Date.now() / 1000) + STATE_TTL });
  const q = new URLSearchParams({
    client_id: c.clientId, redirect_uri: redirectUri(c), response_type: "code", scope: SCOPE,
    access_type: "offline", include_granted_scopes: "true", state,
  });
  if (u) q.set("login_hint", u); // the Drive user who chose "Open with", for people signed in to several accounts
  if (consent) q.set("prompt", "consent");
  const secure = c.publicUrl.startsWith("https:") ? "; Secure" : "";
  send(res, 302, "", {
    location: `${c.authUrl}?${q}`, "cache-control": "no-store",
    "set-cookie": `${COOKIE}${n}=1; Path=/google/; HttpOnly; SameSite=Lax; Max-Age=${STATE_TTL}${secure}`,
  });
}

async function openWith(c, req, res) {
  let st = null;
  try { st = JSON.parse(new URL(req.url, "http://x").searchParams.get("state") ?? ""); } catch { /* not Drive's state */ }
  const fileId = Array.isArray(st?.ids) && st.ids.length === 1 ? String(st.ids[0]) : "";
  if (st?.action !== "open" || !/^[\w-]{1,200}$/.test(fileId)) {
    return text(res, 400, "SumOffice opens one Google Drive file at a time: choose it in Drive, then Open with → SumOffice.");
  }
  const rk = String(st.resourceKeys?.[fileId] ?? "");
  const u = typeof st.userId === "string" && /^[\w.@+-]{1,200}$/.test(st.userId) ? st.userId : "";
  return authorize(c, res, { f: fileId, rk: /^[\w-]{1,200}$/.test(rk) ? rk : "", u }, false);
}

function editor(c, res, id, name, action) {
  const expires = Math.floor(Date.now() / 1000) + TOKEN_TTL;
  const token = signed(c.tokenKey, { op: "wopi", id, e: expires });
  const wopiSrc = `${c.publicUrl}/wopi/files/${id}`;
  const sep = /[?&]$/.test(action) ? "" : action.includes("?") ? "&" : "?";
  const h = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  send(res, 200, `<!doctype html><meta charset="utf-8"><title>${h(name)}</title>
<style>html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style>
<form id="f" method="post" target="ed" action="${h(`${action}${sep}WOPISrc=${encodeURIComponent(wopiSrc)}`)}">
<input type="hidden" name="access_token" value="${h(token)}"><input type="hidden" name="access_token_ttl" value="${expires * 1000}"></form>
<iframe name="ed" title="SumOffice" allow="clipboard-read; clipboard-write; fullscreen"></iframe>
<script>document.getElementById("f").submit()</script>`, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
}

async function callback(c, req, res) {
  const url = new URL(req.url, "http://x");
  const st = unsigned(c.tokenKey, url.searchParams.get("state"));
  if (!st || st.op !== "oauth" || cookies(req)[`${COOKIE}${st.n}`] !== "1" || !useOnce(st.n, st.e)) {
    return text(res, 400, "This sign-in link is not valid or has expired. Open the file again from Google Drive.");
  }
  if (url.searchParams.get("error")) return text(res, 403, "Access to Google Drive was not granted, so SumOffice cannot open the file.");
  const code = url.searchParams.get("code");
  if (!code) return text(res, 400, "Google did not send an authorization code.");
  const tok = await tokenCall(c, { grant_type: "authorization_code", code, redirect_uri: redirectUri(c) });
  // With granular consent a person may untick the Drive permission.
  if (tok.scope && !String(tok.scope).split(" ").includes(SCOPE)) {
    return text(res, 403, "SumOffice needs the permission to see and edit the Drive files you open with it.");
  }
  const fresh = { access: tok.access_token, refresh: tok.refresh_token ?? "", exp: expiry(tok), pending: null };
  const me = await whoami(c, { grant: fresh });
  const user = String(me.permissionId ?? "");
  if (!user) throw new Error("drive about: no user");
  // Google gives a refresh token on the first consent only. If this process has none for the
  // person (a restart), ask once more with prompt=consent.
  let g = grants.get(user);
  if (fresh.refresh) { g = fresh; grants.set(user, g); }
  else if (g?.refresh) { g.access = fresh.access; g.exp = fresh.exp; }
  else if (!st.c) return authorize(c, res, st, true);
  else { g = fresh; grants.set(user, g); } // works until the access token expires

  const s0 = { grant: g, fileId: st.f, resourceKey: st.rk };
  let m;
  try { m = await meta(c, s0); } catch (e) {
    if (e.status === 404 || e.status === 403) return text(res, 404, "Google Drive did not find this file for your account.");
    throw e;
  }
  const ext = extOf(m);
  if (!EXTENSIONS.includes(ext)) return text(res, 415, `SumOffice does not open .${ext || "?"} files.`);
  const canWrite = m.capabilities?.canEdit === true;
  const d = await discovery(c);
  const action = (canWrite ? null : d.actions[`${ext}|view`]) ?? d.actions[`${ext}|edit`];
  if (!action) return text(res, 503, `SumOffice discovery has no action for .${ext}.`);
  const id = newId();
  sessions.set(id, {
    ...s0, name: m.name, mimeType: m.mimeType, user, userName: String(me.displayName || me.emailAddress || user),
    canWrite, until: Date.now() + SESSION_TTL,
  });
  editor(c, res, id, m.name, action);
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
      return send(res, 200, "", { "x-wopi-itemversion": String(r.version ?? r.headRevisionId ?? "") });
    } catch (e) {
      // Drive refuses a write the person has no right to: the editor shows it as read-only.
      if (e.status === 403 || e.status === 401) return send(res, 401);
      throw e;
    }
  }
  if (method === "GET") {
    const m = await meta(c, s);
    s.canWrite = m.capabilities?.canEdit === true; // rights may change while the tab is open
    return send(res, 200, {
      BaseFileName: m.name ?? s.name,
      Size: Number(m.size ?? 0),
      OwnerId: String(m.owners?.[0]?.permissionId ?? "shared-drive"),
      UserId: s.user,
      UserFriendlyName: s.userName,
      Version: String(m.version ?? m.headRevisionId ?? ""),
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
      if (path === "/google/open" && req.method === "GET") return await openWith(c, req, res);
      if (path === "/google/callback" && req.method === "GET") return await callback(c, req, res);
      const m = path.match(/^\/wopi\/files\/([A-Za-z0-9_-]+)(\/contents)?$/);
      if (m) return await wopi(c, req, res, m[1], !!m[2]);
      return send(res, 404);
    } catch (e) {
      console.error(`[sumoffice-googledrive] ${req.method} ${req.url.split("?")[0]}: ${e.message}`);
      if (!res.headersSent) send(res, [401, 404, 413].includes(e.status) ? e.status : 500);
    }
  });
  server.listen(c.port, c.host);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const c = config();
  start(c);
  console.log(`[sumoffice-googledrive] listening on ${c.host}:${c.port}, Open URL ${c.publicUrl}/google/open`);
}
