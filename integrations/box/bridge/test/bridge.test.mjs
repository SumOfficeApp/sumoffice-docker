// node --test integrations/box/bridge/test/bridge.test.mjs
// The bridge against a mock Box API (with a separate download host) and a mock SumOffice
// discovery with real proof keys.
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { generateKeyPairSync, sign as rsaSign } from "node:crypto";
import { mockBox } from "./mock-box.mjs";
import { start, config } from "../server.mjs";

const listen = (s) => new Promise((r) => s.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${s.address().port}`)));

function proofHeaders(key, token, url) {
  const ticks = BigInt(Date.now()) * 10000n + 621355968000000000n;
  const t = Buffer.from(token); const u = Buffer.from(url.toUpperCase());
  const n = (x) => { const b = Buffer.alloc(4); b.writeInt32BE(x); return b; };
  const ts = Buffer.alloc(8); ts.writeBigInt64BE(ticks);
  const sig = rsaSign("RSA-SHA256", Buffer.concat([n(t.length), t, n(u.length), u, n(8), ts]), key).toString("base64");
  return { "x-wopi-timestamp": String(ticks), "x-wopi-proof": sig, "x-wopi-proofold": sig };
}

test("callback → one-time link → CheckFileInfo → lock → GetFile → PutFile adds a version; refusals", async (t) => {
  const original = Buffer.from("PK original xlsm");
  const box = mockBox({
    clientId: "cid", clientSecret: "csecret",
    users: { 11: { name: "Victor V", login: "victor@example.com" }, 12: { name: "Anna A", login: "anna@example.com" } },
    files: [{ id: "1001", name: "book one.xlsm", owner: "11", roles: { 11: "editor", 12: "viewer" }, data: original },
      { id: "1002", name: "notes.txt", owner: "11", roles: { 11: "editor" }, data: Buffer.from("x") }],
  });
  const { apiUrl, dlUrl } = await box.listen();
  const k = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = k.publicKey.export({ format: "jwk" });
  const std = (s) => Buffer.from(s, "base64url").toString("base64");
  const disco = createServer((req, res) => res.end(`<wopi-discovery><net-zone name="external-https"><app name="Excel">
    <action name="edit" ext="xlsm" urlsrc="https://office.example/f1/wopi/edit?&lt;ui=UI_LLCC&amp;&gt;"/>
    <action name="view" ext="xlsm" urlsrc="https://office.example/f1/wopi/view?"/></app></net-zone>
    <proof-key value="x" modulus="${std(jwk.n)}" exponent="${std(jwk.e)}"/></wopi-discovery>`));
  const discoUrl = await listen(disco);
  const bridge = start(config({ PORT: "0", HOST: "127.0.0.1", TOKEN_KEY: "k".repeat(24), PUBLIC_URL: "http://placeholder",
    BOX_CLIENT_ID: "cid", BOX_CLIENT_SECRET: "csecret", SUMOFFICE_DISCOVERY_URL: `${discoUrl}/hosting/discovery`,
    BOX_API_BASE: apiUrl, BOX_UPLOAD_BASE: `${apiUrl}/api` }));
  await new Promise((r) => bridge.once("listening", r));
  const base = `http://127.0.0.1:${bridge.address().port}`;
  t.after(() => { bridge.close(); box.close(); disco.close(); });

  // Box's popup integration: POST form with the parameters configured in the developer console.
  const callback = (params, method = "POST") => method === "POST"
    ? fetch(`${base}/box/callback`, { method, redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() })
    : fetch(`${base}/box/callback?${new URLSearchParams(params)}`, { redirect: "manual" });
  const openLink = async (params, method) => {
    const r = await callback(params, method);
    assert.equal(r.status, 303);
    return new URL(r.headers.get("location")).pathname;
  };
  const editorOf = (page) => {
    const action = page.match(/action="([^"]+)"/)[1].replace(/&#38;/g, "&");
    return { action, token: page.match(/name="access_token" value="([^"]+)"/)[1], path: new URL(decodeURIComponent(action.split("WOPISrc=")[1])).pathname };
  };

  assert.equal((await callback({ file_id: "1001" })).status, 400, "no auth_code");
  assert.equal((await callback({ file_id: "../1", auth_code: box.code("11") })).status, 400, "file ids are numbers");
  assert.equal((await callback({ file_id: "1001", auth_code: "made-up" })).status, 401, "a code Box did not issue");
  const code = box.code("11");
  const first = await openLink({ file_id: "1001", file_name: "book one.xlsm", user_id: "11", auth_code: code });
  assert.equal((await callback({ file_id: "1001", auth_code: code })).status, 401, "an auth code works once");
  assert.equal((await callback({ file_id: "1002", auth_code: box.code("11") })).status, 415, "not an office file");

  const openPath = first;
  assert.match(openPath, /^\/box\/open\/[\w-]+$/);
  const page = await (await fetch(`${base}${openPath}`)).text();
  assert.equal((await fetch(`${base}${openPath}`)).status, 410, "the link works once");
  assert.ok(box.issued.length >= 2);
  for (const secret of [...box.issued, "csecret", code]) assert.ok(!page.includes(secret), `the page holds no Box secret (${secret})`);

  // A link not opened in time expires.
  const late = await openLink({ file_id: "1001", auth_code: box.code("11") }, "GET");
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 3 * 60 * 1000 });
  const lateStatus = (await fetch(`${base}${late}`)).status;
  t.mock.timers.reset();
  assert.equal(lateStatus, 410, "an expired link");

  const { action, token, path: wopiPath } = editorOf(page);
  assert.match(action, /^https:\/\/office\.example\/f1\/wopi\/edit\?WOPISrc=/);
  const call = (sub, { method = "GET", headers = {}, body, proof = true, tok = token, path = wopiPath } = {}) => {
    const p = `${path}${sub}?access_token=${encodeURIComponent(tok)}`;
    return fetch(`${base}${p}`, { method, body, headers: proof ? { ...proofHeaders(k.privateKey, tok, `http://placeholder${p}`), ...headers } : headers });
  };

  const info = await (await call("")).json();
  assert.equal(info.BaseFileName, "book one.xlsm");
  assert.equal(info.UserId, "11");
  assert.equal(info.UserFriendlyName, "Victor V");
  assert.equal(info.OwnerId, "11");
  assert.equal(info.Size, original.length);
  assert.equal(info.UserCanWrite, true);
  assert.ok(box.calls.some((c) => c === "GET /2.0/files/1001"), "metadata from /2.0/files/{id}");
  assert.equal((await call("", { proof: false })).status, 500, "no proof");
  assert.equal((await call("", { headers: { "x-wopi-proof": Buffer.alloc(256).toString("base64"), "x-wopi-proofold": Buffer.alloc(256, 1).toString("base64") } })).status, 500, "forged proof");
  assert.equal((await call("", { tok: token + "x" })).status, 401, "broken token");
  assert.equal((await call("", { path: "/wopi/files/AAAAAAAAAAAAAAAAAAAAAAAA" })).status, 401, "token for another session");

  const saved = Buffer.from("PK edited xlsm, longer");
  assert.equal((await call("/contents", { method: "POST", headers: { "x-wopi-override": "PUT" }, body: saved })).status, 409, "PutFile without the lock");
  assert.equal((await call("", { method: "POST", headers: { "x-wopi-override": "LOCK", "x-wopi-lock": "L" } })).status, 200);
  assert.deepEqual(Buffer.from(await (await call("/contents")).arrayBuffer()), original);
  assert.ok(box.dlCalls.length >= 1 && box.dlCalls.every((d) => d.authorization === null), "the download host never sees the Box token");
  assert.ok(!dlUrl.startsWith(apiUrl), "the download host is a different origin");

  assert.equal((await call("/contents", { method: "POST", headers: { "x-wopi-override": "PUT", "x-wopi-lock": "L" }, body: saved })).status, 200);
  const f = box.byId.get("1001");
  assert.equal(f.versions.length, 2, "a new version of the same file");
  assert.deepEqual(f.versions[1].data, saved);
  assert.equal(f.versions[1].by, "11", "written with the person's own token");
  assert.equal(f.name, "book one.xlsm", "the name is kept");
  assert.ok(box.calls.includes("POST /api/2.0/files/1001/content"), "upload goes to the upload host, same file id");
  assert.deepEqual(Buffer.from(await (await call("/contents")).arrayBuffer()), saved, "GetFile reads the new version");

  // An expired Box access token is refreshed once and the call goes through.
  box.revokeAccess("11");
  assert.deepEqual(Buffer.from(await (await call("/contents")).arrayBuffer()), saved, "works after a refresh");
  assert.ok(box.grants.includes("refresh_token"));

  // Somebody changed the file in Box meanwhile: the save must not overwrite it.
  box.changeInBox("1001", Buffer.from("PK changed in Box"), "12");
  assert.equal((await call("/contents", { method: "POST", headers: { "x-wopi-override": "PUT", "x-wopi-lock": "L" }, body: saved })).status, 409, "If-Match refused");
  assert.equal(f.versions.length, 3);

  // A viewer opens read-only and cannot save.
  const viewPage = await (await fetch(`${base}${await openLink({ file_id: "1001", auth_code: box.code("12") })}`)).text();
  assert.match(viewPage, /\/f1\/wopi\/view\?/);
  const ro = editorOf(viewPage);
  const roInfo = await (await call("", { tok: ro.token, path: ro.path })).json();
  assert.equal(roInfo.UserCanWrite, false);
  assert.equal(roInfo.UserFriendlyName, "Anna A");
  assert.equal((await call("", { method: "POST", tok: ro.token, path: ro.path, headers: { "x-wopi-override": "LOCK", "x-wopi-lock": "R" } })).status, 401);
  assert.equal((await call("/contents", { method: "POST", tok: ro.token, path: ro.path, headers: { "x-wopi-override": "PUT", "x-wopi-lock": "R" }, body: Buffer.from("x") })).status, 401, "viewer cannot save");

  // Rights taken away in Box after opening: Box refuses the upload (403), the editor is told no.
  f.roles["11"] = "viewer";
  assert.equal((await call("/contents")).status, 200);
  assert.equal((await call("/contents", { method: "POST", headers: { "x-wopi-override": "PUT", "x-wopi-lock": "L" }, body: saved })).status, 401, "Box refuses, the editor is told no");
  assert.equal(f.versions.length, 3);
});
