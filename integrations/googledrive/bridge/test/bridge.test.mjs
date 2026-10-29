// node --test integrations/googledrive/bridge/test/bridge.test.mjs
// The bridge against a mock of Google's OAuth and Drive APIs and a mock SumOffice discovery with real proof keys.
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { generateKeyPairSync, sign as rsaSign } from "node:crypto";
import { mockGoogle } from "./mock-google.mjs";
import { start, config, signed } from "../server.mjs";

const listen = (s) => new Promise((r) => s.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${s.address().port}`)));
const XLSM = "application/vnd.ms-excel.sheet.macroEnabled.12";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const INSTALL_SCOPE = "https://www.googleapis.com/auth/drive.install";

function proofHeaders(key, token, url) {
  const ticks = BigInt(Date.now()) * 10000n + 621355968000000000n;
  const t = Buffer.from(token); const u = Buffer.from(url.toUpperCase());
  const n = (x) => { const b = Buffer.alloc(4); b.writeInt32BE(x); return b; };
  const ts = Buffer.alloc(8); ts.writeBigInt64BE(ticks);
  const sig = rsaSign("RSA-SHA256", Buffer.concat([n(t.length), t, n(u.length), u, n(8), ts]), key).toString("base64");
  return { "x-wopi-timestamp": String(ticks), "x-wopi-proof": sig, "x-wopi-proofold": sig };
}

test("Picker is unavailable until its browser key is supplied through the environment", async (t) => {
  const bridge = start(config({
    PORT: "0", HOST: "127.0.0.1", TOKEN_KEY: "k".repeat(24), PUBLIC_URL: "http://placeholder",
    SUMOFFICE_DISCOVERY_URL: "http://placeholder/hosting/discovery",
    GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "csecret",
  }));
  await new Promise((r) => bridge.once("listening", r));
  t.after(() => bridge.close());
  const base = `http://127.0.0.1:${bridge.address().port}`;
  assert.equal((await fetch(`${base}/google/`)).status, 200);
  assert.equal((await fetch(`${base}/google/pick`)).status, 503);
});

test("Open with → Google sign-in → editor → CheckFileInfo → lock → GetFile → PutFile adds a revision; refusals", async (t) => {
  const original = Buffer.from("PK original xlsm with vbaProject.bin");
  const g = mockGoogle({
    clientId: "cid.apps.googleusercontent.com", clientSecret: "csecret",
    users: { "u-olga": { name: "Olga O", email: "olga@example.com" }, "u-victor": { name: "Victor V", email: "victor@example.com" }, "u-anna": { name: "Anna A", email: "anna@example.com" } },
    files: [
      { id: "f1", name: "book one.xlsm", mimeType: XLSM, owner: "u-olga", writers: ["u-victor"], readers: ["u-anna"], data: original },
      { id: "p2", name: "slides.pptx", mimeType: PPTX, owner: "u-olga", data: Buffer.from("PK original pptx") },
      { id: "p1", name: "scan.pdf", mimeType: "application/pdf", owner: "u-victor", data: Buffer.from("%PDF") },
    ],
    consented: ["u-anna"], // Anna agreed before this bridge started: Google sends no refresh token without prompt=consent
  });
  const gUrl = await listen(g.server);
  const k = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = k.publicKey.export({ format: "jwk" });
  const std = (s) => Buffer.from(s, "base64url").toString("base64");
  const disco = createServer((req, res) => res.end(`<wopi-discovery><net-zone name="external-https"><app name="Excel">
    <action name="edit" ext="xlsm" urlsrc="https://office.example/f1/wopi/edit?&lt;ui=UI_LLCC&amp;&gt;"/>
    <action name="view" ext="xlsm" urlsrc="https://office.example/f1/wopi/view?"/>
    <action name="edit" ext="pptx" urlsrc="https://office.example/p2/wopi/edit?"/></app></net-zone>
    <proof-key value="x" modulus="${std(jwk.n)}" exponent="${std(jwk.e)}"/></wopi-discovery>`));
  const discoUrl = await listen(disco);
  const KEY = "k".repeat(24);
  const bridge = start(config({ PORT: "0", HOST: "127.0.0.1", TOKEN_KEY: KEY, PUBLIC_URL: "http://placeholder",
    SUMOFFICE_DISCOVERY_URL: `${discoUrl}/hosting/discovery`, GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "csecret", SUMOFFICE_GDRIVE_PICKER_KEY: "picker-key-for-test",
    GOOGLE_API_BASE: gUrl, GOOGLE_OAUTH_BASE: gUrl }));
  await new Promise((r) => bridge.once("listening", r));
  const base = `http://127.0.0.1:${bridge.address().port}`;
  t.after(() => { bridge.close(); g.server.close(); disco.close(); });

  const driveState = (over = {}) => JSON.stringify({ ids: ["f1"], action: "open", userId: "u-victor", ...over });
  const cookieOf = (r) => r.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
  // Drive's redirect to the Open URL → the bridge sends the browser to Google's sign-in.
  const openWith = (state) => fetch(`${base}/google/open?state=${encodeURIComponent(state)}`, { redirect: "manual" });
  // Google's sign-in → the redirect back to the bridge's callback (PUBLIC_URL is a placeholder).
  const signIn = async (authUrl) => {
    const r = await fetch(authUrl, { redirect: "manual" });
    assert.equal(r.status, 302, "Google accepted the authorization request");
    const cb = new URL(r.headers.get("location"));
    assert.equal(`${cb.origin}${cb.pathname}`, "http://placeholder/google/callback");
    return `${base}${cb.pathname}${cb.search}`;
  };
  const back = (cbUrl, cookie) => fetch(cbUrl, { headers: cookie ? { cookie } : {}, redirect: "manual" });

  const homeRes = await fetch(`${base}/google/`);
  assert.equal(homeRes.status, 200);
  assert.match(await homeRes.text(), /href="\/google\/pick"[^>]*>Open a file from Google Drive/);

  const pickStart = await fetch(`${base}/google/pick`, { redirect: "manual" });
  assert.equal(pickStart.status, 302, "picker entry starts Google sign-in");
  const pickAuth = new URL(pickStart.headers.get("location"));
  const pickScopes = new Set(pickAuth.searchParams.get("scope").split(" "));
  assert.deepEqual(pickScopes, new Set([SCOPE, INSTALL_SCOPE]));
  const pickState = JSON.parse(Buffer.from(pickAuth.searchParams.get("state").split(".")[0], "base64url"));
  assert.equal(pickState.op, "oauth");
  assert.equal(pickState.p, "pick", "signed OAuth state remembers the picker route");

  const pickCbUrl = await signIn(pickAuth);
  const pickerRes = await back(pickCbUrl, cookieOf(pickStart));
  assert.equal(pickerRes.status, 200);
  assert.equal(pickerRes.headers.get("cache-control"), "no-store");
  assert.equal(pickerRes.headers.get("referrer-policy"), "strict-origin");
  assert.match(pickerRes.headers.get("content-security-policy"), /frame-src https:\/\/docs\.google\.com/);
  const pickerPage = await pickerRes.text();
  assert.match(pickerPage, /google\.picker\.PickerBuilder/);
  assert.match(pickerPage, /picker-key-for-test/);
  assert.match(pickerPage, /975087005549/);
  assert.match(pickerPage, /application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation/);
  const pickToken = pickerPage.match(/name="pick_token" value="([^"]+)"/)[1];
  const selectBody = new URLSearchParams({ pick_token: pickToken, fileId: "p2", resourceKey: "" });
  const pickedRes = await fetch(`${base}/google/picked`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: selectBody,
  });
  assert.equal(pickedRes.status, 200, "a Picker selection opens the editor");
  const pickedPage = await pickedRes.text();
  const pickedAction = pickedPage.match(/action="([^"]+)"/)[1].replace(/&#38;/g, "&");
  const pickedWopiToken = pickedPage.match(/name="access_token" value="([^"]+)"/)[1];
  const pickedWopiPath = new URL(decodeURIComponent(pickedAction.split("WOPISrc=")[1])).pathname;
  assert.match(pickedAction, /^https:\/\/office\.example\/p2\/wopi\/edit\?WOPISrc=/);
  for (const tok of g.issued) assert.ok(!pickedPage.includes(tok), "the editor page does not receive a Google token");
  assert.equal((await fetch(`${base}/google/picked`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: selectBody,
  })).status, 400, "a Picker selection state works once");

  assert.equal((await openWith(driveState({ action: "create", ids: undefined, folderId: "x" }))).status, 400, "New → SumOffice is not offered");
  assert.equal((await openWith(driveState({ ids: ["f1", "f2"] }))).status, 400, "one file at a time");
  assert.equal((await openWith("not json")).status, 400, "not Drive's state");

  // Victor, first time: consent gives a refresh token.
  const r1 = await openWith(driveState());
  assert.equal(r1.status, 302);
  const auth = new URL(r1.headers.get("location"));
  assert.equal(`${auth.origin}${auth.pathname}`, `${gUrl}/o/oauth2/v2/auth`);
  assert.equal(auth.searchParams.get("scope"), SCOPE, "only drive.file");
  assert.equal(auth.searchParams.get("access_type"), "offline");
  assert.equal(auth.searchParams.get("login_hint"), "u-victor");
  assert.equal(auth.searchParams.get("redirect_uri"), "http://placeholder/google/callback");
  assert.equal(auth.searchParams.get("prompt"), null, "no consent screen forced the first time");
  const cookie = cookieOf(r1);
  assert.match(r1.headers.get("set-cookie"), /HttpOnly; SameSite=Lax/);
  const cbUrl = await signIn(auth);

  assert.equal((await back(cbUrl)).status, 400, "the callback without the browser's cookie (CSRF)");
  const forged = new URL(cbUrl); const st = forged.searchParams.get("state");
  forged.searchParams.set("state", `${st.split(".")[0]}.${"A".repeat(43)}`);
  assert.equal((await back(forged, cookie)).status, 400, "forged state");
  const expired = signed(KEY, { op: "oauth", f: "f1", rk: "", u: "u-victor", n: "N1", c: 0, e: Math.floor(Date.now() / 1000) - 1 });
  assert.equal((await back(`${base}/google/callback?code=x&state=${expired}`, `so_oauth_N1=1`)).status, 400, "expired state");

  const pageRes = await back(cbUrl, cookie);
  assert.equal(pageRes.status, 200);
  const page = await pageRes.text();
  assert.equal((await back(cbUrl, cookie)).status, 400, "a state works once");
  assert.ok(g.issued.length >= 2, "the mock issued an access and a refresh token");
  for (const tok of g.issued) assert.ok(!page.includes(tok), "no Google token reaches the browser");
  assert.ok(!/ya29\.|1\/\//.test(page));
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
  assert.equal(info.Size, original.length);
  assert.equal(info.UserId, "u-victor");
  assert.equal(info.UserFriendlyName, "Victor V");
  assert.equal(info.OwnerId, "u-olga");
  assert.equal(info.UserCanWrite, true);

  const pickedInfo = await (await call("", { tok: pickedWopiToken, path: pickedWopiPath })).json();
  assert.equal(pickedInfo.BaseFileName, "slides.pptx");
  assert.equal(pickedInfo.UserCanWrite, true);
  assert.equal((await call("", { method: "POST", tok: pickedWopiToken, path: pickedWopiPath,
    headers: { "x-wopi-override": "LOCK", "x-wopi-lock": "P" } })).status, 200);
  const pickedSaved = Buffer.from("PK edited pptx");
  assert.equal((await call("/contents", { method: "POST", tok: pickedWopiToken, path: pickedWopiPath,
    headers: { "x-wopi-override": "PUT", "x-wopi-lock": "P" }, body: pickedSaved })).status, 200);
  assert.deepEqual(g.byId.get("p2").revisions.at(-1).data, pickedSaved, "Picker file is saved to the same Drive id");
  assert.equal((await call("", { proof: false })).status, 500, "no proof");
  assert.equal((await call("", { headers: { "x-wopi-proof": Buffer.alloc(256).toString("base64"), "x-wopi-proofold": Buffer.alloc(256, 1).toString("base64") } })).status, 500, "forged proof");
  assert.equal((await call("", { tok: token + "x" })).status, 401, "broken token");
  assert.equal((await call("", { path: "/wopi/files/AAAAAAAAAAAAAAAAAAAAAAAA" })).status, 401, "token for another session");
  assert.deepEqual(Buffer.from(await (await call("/contents")).arrayBuffer()), original);

  const saved = Buffer.from("PK edited xlsm, longer, vbaProject.bin kept");
  assert.equal((await call("/contents", { method: "POST", headers: { "x-wopi-override": "PUT" }, body: saved })).status, 409, "PutFile without the lock");
  assert.equal((await call("", { method: "POST", headers: { "x-wopi-override": "LOCK", "x-wopi-lock": "L" } })).status, 200);
  const put = await call("/contents", { method: "POST", headers: { "x-wopi-override": "PUT", "x-wopi-lock": "L" }, body: saved });
  assert.equal(put.status, 200);
  assert.equal(put.headers.get("x-wopi-itemversion"), "2");
  const f = g.byId.get("f1");
  assert.equal(f.revisions.length, 2, "a new revision of the same file");
  assert.deepEqual(f.revisions[1].data, saved);
  assert.equal(f.revisions[1].by, "u-victor", "written with the person's own token");
  assert.ok(g.calls.includes("PATCH /upload/drive/v3/files/f1"), "media upload to the same file id");
  assert.deepEqual(Buffer.from(await (await call("/contents")).arrayBuffer()), saved, "GetFile reads the new revision");

  // An hour later Google refuses the access token: the bridge refreshes it once and carries on.
  g.expireAccessTokens();
  assert.deepEqual(Buffer.from(await (await call("/contents")).arrayBuffer()), saved, "GetFile after the access token expired");
  assert.equal(g.stats.refreshes, 1);

  // Victor again, now without a refresh token from Google: the one the bridge keeps is reused, no consent screen.
  const r2 = await openWith(driveState({ ids: ["p1"] }));
  assert.equal((await back(await signIn(new URL(r2.headers.get("location"))), cookieOf(r2))).status, 415, "a PDF is not opened");

  // Anna reads only, and had consented before: the bridge asks once more with prompt=consent to get a refresh token.
  const a1 = await openWith(driveState({ userId: "u-anna" }));
  const a2 = await back(await signIn(new URL(a1.headers.get("location"))), cookieOf(a1));
  assert.equal(a2.status, 302, "back to Google for a refresh token");
  const again = new URL(a2.headers.get("location"));
  assert.equal(again.searchParams.get("prompt"), "consent");
  const roRes = await back(await signIn(again), cookieOf(a2));
  assert.equal(roRes.status, 200);
  const roPage = await roRes.text();
  assert.match(roPage, /\/f1\/wopi\/view\?/, "a reader gets the view action");
  const roTok = roPage.match(/name="access_token" value="([^"]+)"/)[1];
  const roPath = new URL(decodeURIComponent(roPage.match(/action="([^"]+)"/)[1].replace(/&#38;/g, "&").split("WOPISrc=")[1])).pathname;
  const roInfo = await (await call("", { tok: roTok, path: roPath })).json();
  assert.equal(roInfo.UserCanWrite, false);
  assert.equal(roInfo.ReadOnly, true);
  assert.equal(roInfo.UserFriendlyName, "Anna A");
  assert.equal((await call("", { tok: token, path: roPath })).status, 401, "Victor's token on Anna's session");
  assert.equal((await call("", { method: "POST", tok: roTok, path: roPath, headers: { "x-wopi-override": "LOCK", "x-wopi-lock": "R" } })).status, 401);
  assert.equal((await call("/contents", { method: "POST", tok: roTok, path: roPath, headers: { "x-wopi-override": "PUT", "x-wopi-lock": "R" }, body: Buffer.from("x") })).status, 401, "a reader cannot save");
  assert.equal(f.revisions.length, 2);

  // The owner takes Victor's edit right away while his tab is open: Drive answers 403, the editor is told no.
  f.writers.delete("u-victor"); f.readers.add("u-victor");
  assert.equal((await call("/contents", { method: "POST", headers: { "x-wopi-override": "PUT", "x-wopi-lock": "L" }, body: Buffer.from("late") })).status, 401, "Drive refuses, the editor is told no");
  assert.equal(f.revisions.length, 2);
  assert.equal((await (await call("")).json()).UserCanWrite, false, "CheckFileInfo follows the new rights");
  assert.ok(!g.calls.some((c) => c.startsWith("PATCH") && ![
    "PATCH /upload/drive/v3/files/f1", "PATCH /upload/drive/v3/files/p2",
  ].includes(c)));

  // The person refused consent on Google's screen.
  const d1 = await openWith(driveState());
  const denied = new URL(`${base}/google/callback`); denied.searchParams.set("error", "access_denied");
  denied.searchParams.set("state", new URL(d1.headers.get("location")).searchParams.get("state"));
  assert.equal((await back(denied, cookieOf(d1))).status, 403);
});

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// A bridge against the Google mock and a discovery with real proof keys, for the tests below.
async function rig(t, mock) {
  const g = mockGoogle({ clientId: "cid.apps.googleusercontent.com", clientSecret: "csecret", ...mock });
  const gUrl = await listen(g.server);
  const k = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = k.publicKey.export({ format: "jwk" });
  const std = (s) => Buffer.from(s, "base64url").toString("base64");
  const disco = createServer((req, res) => res.end(`<wopi-discovery><net-zone name="external-https"><app name="Office">
    <action name="edit" ext="docx" urlsrc="https://office.example/a4/wopi/edit?"/>
    <action name="edit" ext="xlsx" urlsrc="https://office.example/f1/wopi/edit?"/>
    <action name="edit" ext="pptx" urlsrc="https://office.example/p2/wopi/edit?"/></app></net-zone>
    <proof-key value="x" modulus="${std(jwk.n)}" exponent="${std(jwk.e)}"/></wopi-discovery>`));
  const discoUrl = await listen(disco);
  const bridge = start(config({ PORT: "0", HOST: "127.0.0.1", TOKEN_KEY: "k".repeat(24), PUBLIC_URL: "http://placeholder",
    SUMOFFICE_DISCOVERY_URL: `${discoUrl}/hosting/discovery`, GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "csecret", SUMOFFICE_GDRIVE_PICKER_KEY: "picker-key-for-test",
    GOOGLE_API_BASE: gUrl, GOOGLE_OAUTH_BASE: gUrl }));
  await new Promise((r) => bridge.once("listening", r));
  const base = `http://127.0.0.1:${bridge.address().port}`;
  t.after(() => { bridge.close(); g.server.close(); disco.close(); });
  const cookieOf = (r) => r.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
  // Follows the bridge → Google sign-in → callback round trip; edit(auth) may change the request first.
  const through = async (start, { headers = {}, edit = (a) => a } = {}) => {
    assert.equal(start.status, 302, "the bridge sends the browser to Google");
    const auth = edit(new URL(start.headers.get("location")));
    const r = await fetch(auth, { redirect: "manual" });
    assert.equal(r.status, 302, "Google accepted the authorization request");
    const cb = new URL(r.headers.get("location"));
    return fetch(`${base}${cb.pathname}${cb.search}`, { headers: { cookie: cookieOf(start), ...headers }, redirect: "manual" });
  };
  const call = (page, sub = "", { method = "GET", headers = {}, body } = {}) => {
    const action = page.match(/action="([^"]+)"/)[1].replace(/&#38;/g, "&");
    const tok = page.match(/name="access_token" value="([^"]+)"/)[1];
    const p = `${new URL(decodeURIComponent(action.split("WOPISrc=")[1])).pathname}${sub}?access_token=${encodeURIComponent(tok)}`;
    return fetch(`${base}${p}`, { method, body, headers: { ...proofHeaders(k.privateKey, tok, `http://placeholder${p}`), ...headers } });
  };
  return { g, base, through, call };
}

test("Install entry: “Connect SumOffice to Google Drive™” asks for drive.install + drive.file and says where to find the app", async (t) => {
  const { g, base, through } = await rig(t, { users: { "u-rev": { name: "Reviewer", email: "rev@example.com" } } });

  const en = await fetch(`${base}/google/install`);
  assert.equal(en.status, 200);
  assert.equal(en.headers.get("cache-control"), "no-store");
  const enPage = await en.text();
  assert.match(enPage, /href="\/google\/install\/start">Connect SumOffice to Google Drive™</);
  assert.match(enPage, /trademarks of Google LLC/);
  const ru = await (await fetch(`${base}/google/install`, { headers: { "accept-language": "ru-RU,ru;q=0.9,en;q=0.5" } })).text();
  assert.match(ru, /<html lang="ru">/);
  assert.match(ru, />Подключить SumOffice к Google Drive™</);
  assert.match(await (await fetch(`${base}/google/`)).text(), /href="\/google\/install"/, "the entry page links to the install page");

  const s1 = await fetch(`${base}/google/install/start`, { redirect: "manual" });
  assert.equal(s1.status, 302);
  const auth = new URL(s1.headers.get("location"));
  assert.deepEqual(new Set(auth.searchParams.get("scope").split(" ")), new Set([SCOPE, INSTALL_SCOPE]));
  assert.equal(JSON.parse(Buffer.from(auth.searchParams.get("state").split(".")[0], "base64url")).p, "install");
  const done = await through(s1);
  assert.equal(done.status, 200);
  const donePage = await done.text();
  assert.match(donePage, /<h1>Done<\/h1>/);
  assert.match(donePage, /right-click a \.docx, \.xlsx or \.pptx file → Open with → SumOffice/);
  for (const tok of g.issued) assert.ok(!donePage.includes(tok), "no Google token on the page");
  assert.ok(!g.calls.some((x) => x.includes("/drive/v3/")), "installing reads no Drive data");

  const doneRu = await (await through(await fetch(`${base}/google/install/start`, { redirect: "manual" }),
    { headers: { "accept-language": "ru" } })).text();
  assert.match(doneRu, /Готово: |<h1>Готово<\/h1>/);
  assert.match(doneRu, /правый клик по \.docx, \.xlsx или \.pptx → Открыть с помощью → SumOffice/);

  // drive.install unticked on Google's screen: say so and offer the button again.
  const noInstall = await through(await fetch(`${base}/google/install/start`, { redirect: "manual" }),
    { edit: (a) => { a.searchParams.set("scope", SCOPE); return a; } });
  assert.equal(noInstall.status, 403);
  assert.match(await noInstall.text(), /href="\/google\/install\/start"/);

  // Consent refused: back to the install page.
  const s4 = await fetch(`${base}/google/install/start`, { redirect: "manual" });
  const denied = new URL(`${base}/google/callback`); denied.searchParams.set("error", "access_denied");
  denied.searchParams.set("state", new URL(s4.headers.get("location")).searchParams.get("state"));
  const back = await fetch(denied, { headers: { cookie: s4.headers.getSetCookie()[0].split(";")[0] } });
  assert.equal(back.status, 200);
  assert.match(await back.text(), /href="\/google\/install\/start"/);
});

test("Importing: Google Docs, Sheets and Slides open as a .docx/.xlsx/.pptx copy next to the original", async (t) => {
  const exported = { doc: Buffer.from("PK exported docx"), sheet: Buffer.from("PK exported xlsx") };
  const { g, base, through, call } = await rig(t, {
    users: { "u-rev": { name: "Reviewer", email: "rev@example.com" } },
    folders: { "fold-own": { writers: ["u-rev"] }, "fold-ro": { writers: [] } },
    files: [
      { id: "gdoc", name: "Quarterly report", mimeType: "application/vnd.google-apps.document", owner: "u-rev", parents: ["fold-own"],
        data: Buffer.alloc(0), exports: { [DOCX]: exported.doc } },
      { id: "gsheet", name: "Budget", mimeType: "application/vnd.google-apps.spreadsheet", owner: "u-other", readers: ["u-rev"], parents: ["fold-ro"],
        data: Buffer.alloc(0), exports: { [XLSX]: exported.sheet } },
      { id: "gslides", name: "Huge deck", mimeType: "application/vnd.google-apps.presentation", owner: "u-rev", parents: ["fold-own"],
        data: Buffer.alloc(0), exports: { [PPTX]: "too-large" } },
      { id: "gform", name: "Survey", mimeType: "application/vnd.google-apps.form", owner: "u-rev", data: Buffer.alloc(0) },
    ],
  });
  const openWith = (state) => fetch(`${base}/google/open?state=${encodeURIComponent(JSON.stringify({ action: "open", userId: "u-rev", ...state }))}`, { redirect: "manual" });

  assert.equal((await openWith({ ids: ["x1"], exportIds: ["gdoc"] })).status, 400, "one file at a time, Office and Google mixed");
  assert.equal((await openWith({ exportIds: ["gdoc", "gsheet"] })).status, 400, "one Google file at a time");

  // A Google Doc in the reviewer's own folder: exported to .docx, saved next to it, opened in the editor.
  const docRes = await through(await openWith({ exportIds: ["gdoc"] }));
  assert.equal(docRes.status, 200);
  const docPage = await docRes.text();
  assert.match(docPage, /action="https:\/\/office\.example\/a4\/wopi\/edit\?WOPISrc=/);
  const copy = g.byId.get(g.created[0]);
  assert.equal(copy.name, "Quarterly report.docx");
  assert.equal(copy.mimeType, DOCX);
  assert.deepEqual(copy.parents, ["fold-own"], "the copy is next to the original");
  assert.deepEqual(copy.appProperties, { sumofficeSource: "gdoc" });
  assert.deepEqual(copy.revisions[0].data, exported.doc);
  const info = await (await call(docPage)).json();
  assert.equal(info.BaseFileName, "Quarterly report.docx");
  assert.equal(info.UserCanWrite, true);
  assert.deepEqual(Buffer.from(await (await call(docPage, "/contents")).arrayBuffer()), exported.doc);
  assert.equal((await call(docPage, "", { method: "POST", headers: { "x-wopi-override": "LOCK", "x-wopi-lock": "D" } })).status, 200);
  const edited = Buffer.from("PK edited docx");
  assert.equal((await call(docPage, "/contents", { method: "POST", headers: { "x-wopi-override": "PUT", "x-wopi-lock": "D" }, body: edited })).status, 200);
  assert.deepEqual(copy.revisions.at(-1).data, edited, "saving writes the copy");
  assert.equal(g.byId.get("gdoc").revisions.length, 1, "the Google Doc itself is untouched");

  // A Google Sheet shared read-only in someone else's folder: the copy goes to the root of My Drive.
  const sheetRes = await through(await openWith({ exportIds: ["gsheet"] }));
  assert.equal(sheetRes.status, 200);
  const sheetPage = await sheetRes.text();
  assert.match(sheetPage, /\/f1\/wopi\/edit\?/);
  const sheetCopy = g.byId.get(g.created[1]);
  assert.equal(sheetCopy.name, "Budget.xlsx");
  assert.deepEqual(sheetCopy.parents, ["root"]);
  assert.equal(sheetCopy.owner, "u-rev");
  assert.equal((await (await call(sheetPage)).json()).UserCanWrite, true, "the person owns the copy");

  // Google's 10 MB export limit, and a Google type without an Office format.
  const big = await through(await openWith({ exportIds: ["gslides"] }));
  assert.equal(big.status, 413);
  assert.match(await big.text(), /10 MB/);
  assert.equal((await through(await openWith({ exportIds: ["gform"] }))).status, 415);
  assert.equal(g.created.length, 2, "no copy for a refused export");

  // The Picker offers Google Docs, Sheets and Slides as well.
  const picker = await (await through(await fetch(`${base}/google/pick`, { redirect: "manual" }))).text();
  for (const m of ["document", "spreadsheet", "presentation"]) assert.match(picker, new RegExp(`application/vnd\\.google-apps\\.${m}`));
});
