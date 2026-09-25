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
const SCOPE = "https://www.googleapis.com/auth/drive.file";

function proofHeaders(key, token, url) {
  const ticks = BigInt(Date.now()) * 10000n + 621355968000000000n;
  const t = Buffer.from(token); const u = Buffer.from(url.toUpperCase());
  const n = (x) => { const b = Buffer.alloc(4); b.writeInt32BE(x); return b; };
  const ts = Buffer.alloc(8); ts.writeBigInt64BE(ticks);
  const sig = rsaSign("RSA-SHA256", Buffer.concat([n(t.length), t, n(u.length), u, n(8), ts]), key).toString("base64");
  return { "x-wopi-timestamp": String(ticks), "x-wopi-proof": sig, "x-wopi-proofold": sig };
}

test("Open with → Google sign-in → editor → CheckFileInfo → lock → GetFile → PutFile adds a revision; refusals", async (t) => {
  const original = Buffer.from("PK original xlsm with vbaProject.bin");
  const g = mockGoogle({
    clientId: "cid.apps.googleusercontent.com", clientSecret: "csecret",
    users: { "u-olga": { name: "Olga O", email: "olga@example.com" }, "u-victor": { name: "Victor V", email: "victor@example.com" }, "u-anna": { name: "Anna A", email: "anna@example.com" } },
    files: [
      { id: "f1", name: "book one.xlsm", mimeType: XLSM, owner: "u-olga", writers: ["u-victor"], readers: ["u-anna"], data: original },
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
    <action name="view" ext="xlsm" urlsrc="https://office.example/f1/wopi/view?"/></app></net-zone>
    <proof-key value="x" modulus="${std(jwk.n)}" exponent="${std(jwk.e)}"/></wopi-discovery>`));
  const discoUrl = await listen(disco);
  const KEY = "k".repeat(24);
  const bridge = start(config({ PORT: "0", HOST: "127.0.0.1", TOKEN_KEY: KEY, PUBLIC_URL: "http://placeholder",
    SUMOFFICE_DISCOVERY_URL: `${discoUrl}/hosting/discovery`, GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "csecret", GOOGLE_API_BASE: gUrl, GOOGLE_OAUTH_BASE: gUrl }));
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
  assert.ok(!g.calls.some((c) => c.startsWith("PATCH") && c !== "PATCH /upload/drive/v3/files/f1"));

  // The person refused consent on Google's screen.
  const d1 = await openWith(driveState());
  const denied = new URL(`${base}/google/callback`); denied.searchParams.set("error", "access_denied");
  denied.searchParams.set("state", new URL(d1.headers.get("location")).searchParams.get("state"));
  assert.equal((await back(denied, cookieOf(d1))).status, 403);
});
