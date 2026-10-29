// SumOffice ↔ Google Drive bridge: the "Open with" app for Google Drive and the WOPI host
// SumOffice talks to for files stored in Drive.
//
//   GET  /google/                         A small entry page for opening a file with Google Picker
//   GET  /google/install                  "Connect SumOffice to Google Drive™": the drive.install consent page
//   GET  /google/install/start            Google sign-in with drive.install + drive.file → "Done"
//   GET  /google/pick                     Google sign-in → Google Picker
//   POST /google/picked                   Picker selection → the editor
//   GET  /google/open?state={…}           Drive's Open URL: the file chosen in "Open with" → Google sign-in
//   GET  /google/callback?code&state     the OAuth 2.0 redirect URI: code → tokens → the editor
//   GET  /wopi/files/{id}                CheckFileInfo
//   POST /wopi/files/{id}                LOCK / UNLOCK / REFRESH_LOCK / GET_LOCK
//   GET  /wopi/files/{id}/contents       GetFile
//   POST /wopi/files/{id}/contents       PutFile — a new revision of the same Drive file
//
// Refresh tokens never reach the browser. A short-lived Google access token is embedded only in
// the no-store Picker page because PickerBuilder requires it; editor pages receive only a signed
// WOPI token. The only file-content scope is drive.file. The Picker and install entries also
// request drive.install: that grant is what puts SumOffice into Drive's "Open with" menu.
//
// Google Docs, Sheets and Slides (Drive's "Importing" option) are exported with files.export to
// .docx, .xlsx or .pptx and saved as a new file next to the original; the editor opens that copy.
//
// Node 20+, no dependencies. Configuration is in environment variables (README.md).

import { createServer } from "node:http";
import { createHmac, createPublicKey, randomBytes, timingSafeEqual, verify as rsaVerify } from "node:crypto";

const EXTENSIONS = ["xlsx", "xlsm", "xlsb", "docx", "pptx"];
const MIME = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel.sheet.macroEnabled.12": "xlsm",
  "application/vnd.ms-excel.sheet.binary.macroEnabled.12": "xlsb",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};
// Drive's "Importing": a Google Workspace file is exported to the Office format and opened as a copy.
const GOOGLE_NATIVE = {
  "application/vnd.google-apps.document": "docx",
  "application/vnd.google-apps.spreadsheet": "xlsx",
  "application/vnd.google-apps.presentation": "pptx",
};
const MIME_OF = Object.fromEntries(Object.entries(MIME).map(([m, e]) => [e, m]));
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const INSTALL_SCOPE = "https://www.googleapis.com/auth/drive.install";
const PICKER_MIME_TYPES = [...Object.keys(MIME), ...Object.keys(GOOGLE_NATIVE)].join(",");
const DEFAULT_PICKER_APP_ID = "975087005549";
const FIELDS = "name,size,version,mimeType,parents,capabilities(canEdit),headRevisionId,owners(displayName,permissionId)";
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
    pickerKey: env.SUMOFFICE_GDRIVE_PICKER_KEY ?? "",
    pickerAppId: env.SUMOFFICE_GDRIVE_APP_ID ?? DEFAULT_PICKER_APP_ID,
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
const pickerSessions = new Map(); // one-time Picker handoff id -> { grant, user, userName, until }
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

async function exportAs(c, s, mimeType) {
  const res = await drive(c, s, "GET", `${filePath(s)}/export?mimeType=${encodeURIComponent(mimeType)}`, { follow: true });
  return Buffer.from(await res.arrayBuffer());
}

// A new file (multipart upload). Under drive.file the app has full access to the files it creates.
async function create(c, s, { name, mimeType, parents, data, source }) {
  const boundary = `sumoffice_${newId()}`;
  const metadata = JSON.stringify({ name, mimeType, ...(parents?.length ? { parents } : {}), appProperties: { sumofficeSource: source } });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\ncontent-type: ${mimeType}\r\n\r\n`),
    data, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await drive(c, s, "POST", "/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name",
    { body, headers: { "content-type": `multipart/related; boundary=${boundary}` } });
  return res.json();
}

// Google Docs/Sheets/Slides → .docx/.xlsx/.pptx, saved next to the original. If the person may not
// add files to that folder (or drive.file cannot see it), the copy goes to the root of My Drive.
async function importCopy(c, s, m) {
  const ext = GOOGLE_NATIVE[m.mimeType];
  const mimeType = MIME_OF[ext];
  const data = await exportAs(c, s, mimeType);
  const base = String(m.name ?? "Untitled").replace(/[\u0000-\u001f]/g, " ").trim() || "Untitled";
  const name = base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
  const file = { name, mimeType, data, source: s.fileId };
  try {
    return await create(c, s, { ...file, parents: m.parents });
  } catch (e) {
    if (!m.parents?.length || ![403, 404].includes(e.status)) throw e;
    return create(c, s, file);
  }
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
function authorize(c, res, { f = "", rk = "", u = "", p = "" }, consent) {
  const n = newId();
  const route = p === "pick" || p === "install" ? p : "";
  const state = signed(c.tokenKey, { op: "oauth", f, rk, u, p: route, n, c: consent ? 1 : 0, e: Math.floor(Date.now() / 1000) + STATE_TTL });
  const q = new URLSearchParams({
    client_id: c.clientId, redirect_uri: redirectUri(c), response_type: "code", scope: route ? `${SCOPE} ${INSTALL_SCOPE}` : SCOPE,
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

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const isRu = (req) => /^ru\b/i.test(String(req.headers["accept-language"] ?? "").trim());
const PAGE_STYLE = "body{margin:0;background:#f6f8fb;color:#172033;font:16px/1.5 system-ui,sans-serif}main{box-sizing:border-box;max-width:620px;margin:12vh auto;padding:40px;border:1px solid #dce2ec;border-radius:20px;background:white}h1{margin:0 0 12px;font-size:32px;line-height:1.15}p,li{color:#526078}.button{display:inline-block;margin-top:14px;padding:13px 19px;border-radius:10px;background:#1a73e8;color:white;text-decoration:none;font-weight:650}.note{font-size:14px}.tm{font-size:12px;color:#8590a3}";
const TM_NOTE = "Google Drive™, Google Docs™, Google Sheets™ and Google Slides™ are trademarks of Google LLC. SumOffice is not affiliated with Google.";

function page(res, status, lang, title, inner) {
  send(res, status, `<!doctype html><html lang="${lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${PAGE_STYLE}</style><main>${inner}<p class="tm">${esc(TM_NOTE)}</p></main></html>`, {
    "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer",
    "x-frame-options": "DENY", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
  });
}

const INSTALL_TEXT = {
  en: {
    title: "Connect SumOffice to Google Drive™",
    lead: "One step: allow SumOffice to appear in Google Drive™ under “Open with”. SumOffice gets access only to the files you open with it.",
    button: "Connect SumOffice to Google Drive™",
    doneTitle: "Done",
    done: "In Google Drive™, right-click a .docx, .xlsx or .pptx file → Open with → SumOffice.",
    native: "Google Docs™, Sheets™ and Slides™ files open as a .docx, .xlsx or .pptx copy saved next to the original.",
    reload: "If SumOffice is not in the menu yet, reload the Google Drive™ tab.",
    drive: "Go to Google Drive™",
    pick: "Or choose a file here",
    missing: "Google did not grant the permission to add SumOffice to “Open with”. Try again and keep that box ticked.",
  },
  ru: {
    title: "Подключить SumOffice к Google Drive™",
    lead: "Один шаг: разрешите SumOffice появиться в Google Drive™ в меню «Открыть с помощью». SumOffice получит доступ только к тем файлам, которые вы откроете в нём.",
    button: "Подключить SumOffice к Google Drive™",
    doneTitle: "Готово",
    done: "В Google Drive™ правый клик по .docx, .xlsx или .pptx → Открыть с помощью → SumOffice.",
    native: "Google Документы™, Таблицы™ и Презентации™ открываются копией в .docx, .xlsx или .pptx рядом с оригиналом.",
    reload: "Если SumOffice ещё нет в меню, обновите вкладку Google Drive™.",
    drive: "Перейти в Google Drive™",
    pick: "Или выбрать файл здесь",
    missing: "Google не выдал разрешение добавить SumOffice в «Открыть с помощью». Повторите и оставьте эту галочку включённой.",
  },
};

function installPage(req, res) {
  const lang = isRu(req) ? "ru" : "en"; const t = INSTALL_TEXT[lang];
  page(res, 200, lang, t.title, `<h1>${esc(t.title)}</h1><p>${esc(t.lead)}</p>
<a class="button" href="/google/install/start">${esc(t.button)}</a>
<p class="note">${esc(t.native)}</p>`);
}

function installDone(req, res) {
  const lang = isRu(req) ? "ru" : "en"; const t = INSTALL_TEXT[lang];
  page(res, 200, lang, t.doneTitle, `<h1>${esc(t.doneTitle)}</h1><p>${esc(t.done)}</p><p>${esc(t.native)}</p><p class="note">${esc(t.reload)}</p>
<a class="button" href="https://drive.google.com/">${esc(t.drive)}</a> <a class="button" href="/google/pick">${esc(t.pick)}</a>`);
}

function googleHome(res) {
  send(res, 200, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Open a file</title><style>${PAGE_STYLE}</style>
<main><h1>Open a file</h1><p>Choose a supported document from Google Drive™. It opens in the editor and saves back to the same file.</p>
<a class="button" href="/google/pick">Open a file from Google Drive™</a>
<p class="note">Supported: DOCX, XLSX, XLSM, XLSB and PPTX. Google Docs™, Sheets™ and Slides™ open as a .docx, .xlsx or .pptx copy next to the original.</p>
<p class="note"><a href="/google/install">Add SumOffice to “Open with” in Google Drive™</a></p><p class="tm">${esc(TM_NOTE)}</p></main></html>`, {
    "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer",
    "x-frame-options": "DENY", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
  });
}

function pickerPage(c, res, grant, user, userName) {
  if (!c.pickerKey) return text(res, 503, "Google Picker is not configured.");
  for (const [key, value] of pickerSessions) if (value.until < Date.now()) pickerSessions.delete(key);
  const id = newId();
  const e = Math.floor(Date.now() / 1000) + STATE_TTL;
  pickerSessions.set(id, { grant, user, userName, until: e * 1000 });
  const pickToken = signed(c.tokenKey, { op: "pick", id, e });
  const nonce = newId();
  const cfg = JSON.stringify({
    accessToken: grant.access, apiKey: c.pickerKey, appId: c.pickerAppId,
    mimeTypes: PICKER_MIME_TYPES, origin: c.publicUrl,
  }).replace(/</g, "\\u003c");
  const h = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  send(res, 200, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Choose a file from Google Drive™</title><style nonce="${nonce}">body{margin:0;background:#f6f8fb;color:#172033;font:16px/1.5 system-ui,sans-serif}main{box-sizing:border-box;max-width:620px;margin:12vh auto;padding:40px;border:1px solid #dce2ec;border-radius:20px;background:white}h1{margin:0 0 12px;font-size:30px;line-height:1.15}p{color:#526078}button{padding:13px 19px;border:0;border-radius:10px;background:#1a73e8;color:white;font:inherit;font-weight:650;cursor:pointer}</style>
<main><h1>Choose a file from Google Drive™</h1><p id="status">Opening the file picker…</p><button id="again" type="button" hidden>Choose a file</button></main>
<form id="picked" method="post" action="/google/picked" hidden><input type="hidden" name="pick_token" value="${h(pickToken)}"><input id="fileId" type="hidden" name="fileId"><input id="resourceKey" type="hidden" name="resourceKey"></form>
<script src="https://apis.google.com/js/api.js"></script><script nonce="${nonce}">const cfg=${cfg};
const status=document.getElementById("status"),again=document.getElementById("again"),form=document.getElementById("picked");
function showPicker(){const view=new google.picker.DocsView(google.picker.ViewId.DOCS).setMimeTypes(cfg.mimeTypes);const picker=new google.picker.PickerBuilder().addView(view).setOAuthToken(cfg.accessToken).setDeveloperKey(cfg.apiKey).setAppId(cfg.appId).setOrigin(cfg.origin).setTitle("Open a file from Google Drive™").setCallback((data)=>{if(data.action===google.picker.Action.PICKED){const docs=data[google.picker.Response.DOCUMENTS]||data.docs||[],doc=docs[0];if(!doc||!doc.id){status.textContent="No file was selected.";again.hidden=false;return}document.getElementById("fileId").value=doc.id;document.getElementById("resourceKey").value=doc.resourceKey||"";status.textContent="Opening the selected file…";form.submit()}else if(data.action===google.picker.Action.CANCEL){status.textContent="No file was selected.";again.hidden=false}}).build();picker.setVisible(true)}
again.addEventListener("click",()=>{again.hidden=true;status.textContent="Opening the file picker…";showPicker()});gapi.load("picker",{callback:showPicker});</script></html>`, {
    "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "strict-origin",
    "x-frame-options": "DENY", "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}' https://apis.google.com https://www.gstatic.com; style-src 'nonce-${nonce}'; frame-src https://docs.google.com https://drive.google.com; connect-src https://www.googleapis.com https://oauth2.googleapis.com https://apis.google.com`,
  });
}

async function openWith(c, req, res) {
  let st = null;
  try { st = JSON.parse(new URL(req.url, "http://x").searchParams.get("state") ?? ""); } catch { /* not Drive's state */ }
  // Office files come in "ids"; Google Docs, Sheets and Slides (Importing) come in "exportIds".
  const all = [...(Array.isArray(st?.ids) ? st.ids : []), ...(Array.isArray(st?.exportIds) ? st.exportIds : [])];
  const fileId = all.length === 1 ? String(all[0]) : "";
  if (st?.action !== "open" || !/^[\w-]{1,200}$/.test(fileId)) {
    return text(res, 400, "SumOffice opens one Google Drive™ file at a time: choose it in Drive, then Open with → SumOffice.");
  }
  const rk = String(st.resourceKeys?.[fileId] ?? "");
  const u = typeof st.userId === "string" && /^[\w.@+-]{1,200}$/.test(st.userId) ? st.userId : "";
  return authorize(c, res, { f: fileId, rk: /^[\w-]{1,200}$/.test(rk) ? rk : "", u }, false);
}

function pick(c, res) {
  if (!c.pickerKey) return text(res, 503, "Google Picker is not configured.");
  return authorize(c, res, { p: "pick" }, false);
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

async function openEditorForFile(c, res, { grant, fileId, resourceKey = "", user, userName, imported = false }) {
  const s0 = { grant, fileId, resourceKey };
  let m;
  try { m = await meta(c, s0); } catch (e) {
    if (e.status === 404 || e.status === 403) return text(res, 404, "Google Drive™ did not find this file for your account.");
    throw e;
  }
  if (GOOGLE_NATIVE[m.mimeType] && !imported) {
    let copy;
    try { copy = await importCopy(c, s0, m); } catch (e) {
      if (/exportSizeLimitExceeded/.test(e.message)) {
        return text(res, 413, `Google Drive™ exports files up to 10 MB only. In Drive choose File → Download → .${GOOGLE_NATIVE[m.mimeType]}, upload that file and open it with SumOffice.`);
      }
      if (e.status === 403) return text(res, 403, "Google Drive™ does not allow this file to be exported or copied for your account.");
      throw e;
    }
    return openEditorForFile(c, res, { grant, fileId: String(copy.id), user, userName, imported: true });
  }
  const ext = extOf(m);
  if (!EXTENSIONS.includes(ext)) return text(res, 415, `The editor does not open .${ext || "?"} files.`);
  const canWrite = m.capabilities?.canEdit === true;
  const d = await discovery(c);
  const action = (canWrite ? null : d.actions[`${ext}|view`]) ?? d.actions[`${ext}|edit`];
  if (!action) return text(res, 503, `Editor discovery has no action for .${ext}.`);
  const id = newId();
  sessions.set(id, {
    ...s0, name: m.name, mimeType: m.mimeType, user, userName,
    canWrite, until: Date.now() + SESSION_TTL,
  });
  editor(c, res, id, m.name, action);
}

async function picked(c, req, res) {
  const form = new URLSearchParams((await readBody(req, 16 * 1024)).toString());
  const st = unsigned(c.tokenKey, form.get("pick_token"));
  const fileId = String(form.get("fileId") ?? "");
  const resourceKey = String(form.get("resourceKey") ?? "");
  const ps = st?.op === "pick" ? pickerSessions.get(st.id) : null;
  if (!st || !ps || ps.until < Date.now() || !/^[\w-]{1,200}$/.test(fileId) || (resourceKey && !/^[\w-]{1,200}$/.test(resourceKey)) || !useOnce(`pick:${st.id}`, st.e)) {
    return text(res, 400, "This file selection is not valid or has expired. Choose the file again.");
  }
  pickerSessions.delete(st.id);
  return openEditorForFile(c, res, { ...ps, fileId, resourceKey });
}

async function callback(c, req, res) {
  const url = new URL(req.url, "http://x");
  const st = unsigned(c.tokenKey, url.searchParams.get("state"));
  if (!st || st.op !== "oauth" || cookies(req)[`${COOKIE}${st.n}`] !== "1" || !useOnce(st.n, st.e)) {
    return text(res, 400, "This sign-in link is not valid or has expired. Open the file again from Google Drive.");
  }
  if (url.searchParams.get("error")) {
    if (st.p === "install") return installPage(req, res);
    return text(res, 403, "Access to Google Drive™ was not granted, so SumOffice cannot open the file.");
  }
  const code = url.searchParams.get("code");
  if (!code) return text(res, 400, "Google did not send an authorization code.");
  const tok = await tokenCall(c, { grant_type: "authorization_code", code, redirect_uri: redirectUri(c) });
  // With granular consent a person may untick the Drive permission.
  if (tok.scope && !String(tok.scope).split(" ").includes(SCOPE)) {
    return text(res, 403, "SumOffice needs the permission to see and edit the Drive files you open with it.");
  }
  // The install entry needs no tokens afterwards: the drive.install grant itself is the result.
  if (st.p === "install") {
    if (tok.scope && !String(tok.scope).split(" ").includes(INSTALL_SCOPE)) {
      const lang = isRu(req) ? "ru" : "en";
      return page(res, 403, lang, INSTALL_TEXT[lang].title, `<h1>${esc(INSTALL_TEXT[lang].title)}</h1><p>${esc(INSTALL_TEXT[lang].missing)}</p>
<a class="button" href="/google/install/start">${esc(INSTALL_TEXT[lang].button)}</a>`);
    }
    return installDone(req, res);
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

  const userName = String(me.displayName || me.emailAddress || user);
  if (st.p === "pick") return pickerPage(c, res, g, user, userName);
  return openEditorForFile(c, res, { grant: g, fileId: st.f, resourceKey: st.rk, user, userName });
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
      if (path === "/favicon.ico" && req.method === "GET") return send(res, 204);
      if ((path === "/google" || path === "/google/") && req.method === "GET") return googleHome(res);
      if (path === "/google/install" && req.method === "GET") return installPage(req, res);
      if (path === "/google/install/start" && req.method === "GET") return authorize(c, res, { p: "install" }, false);
      if (path === "/google/pick" && req.method === "GET") return pick(c, res);
      if (path === "/google/picked" && req.method === "POST") return await picked(c, req, res);
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
  console.log(`[sumoffice-googledrive] listening on ${c.host}:${c.port}, Install ${c.publicUrl}/google/install, Picker ${c.publicUrl}/google/pick, Open URL ${c.publicUrl}/google/open`);
}
