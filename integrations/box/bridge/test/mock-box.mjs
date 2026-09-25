// A tiny stand-in for the Box API calls the bridge uses. Two servers, like Box itself:
//   api  POST /oauth2/token                      authorization_code / refresh_token grants
//        GET  /2.0/users/me                      the person behind the token
//        GET  /2.0/files/{id}?fields=…           metadata of the newest version
//        GET  /2.0/files/{id}/content            302 → a one-time URL on the "dl" server
//        POST /api/2.0/files/{id}/content        multipart upload of a new version (the upload host)
//   dl   GET  /d/{once}                          the bytes; refuses any Authorization header
// Roles per file and user: "editor" may upload, "viewer" may only read (upload → 403).
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";

const sha1 = (b) => createHash("sha1").update(b).digest("hex");

export function mockBox({ clientId, clientSecret, users = {}, files = [] }) {
  const byId = new Map();   // file id -> { name, owner, roles: { userId: role }, versions: [{ id, data, by }] }
  const codes = new Map();  // auth code -> { user, until }
  const access = new Map(); // access token -> user
  const refresh = new Map(); // refresh token -> user
  const once = new Map();   // download id -> Buffer
  const calls = []; const dlCalls = []; const grants = []; const issued = [];
  for (const f of files) {
    byId.set(f.id, { name: f.name, owner: f.owner, roles: { ...f.roles }, versions: [{ id: randomUUID(), data: f.data, by: f.owner }] });
  }
  const m = { byId, calls, dlCalls, grants, issued, dlBase: "" };

  const userObj = (id) => ({ type: "user", id, name: users[id]?.name ?? id, login: users[id]?.login ?? `${id}@example.com` });
  const fileObj = (id, f, fields) => {
    const v = f.versions.at(-1); const role = f.roles[fields.user];
    const full = {
      type: "file", id, name: f.name, size: v.data.length, etag: String(f.versions.length - 1), sha1: sha1(v.data),
      file_version: { type: "file_version", id: v.id, sha1: sha1(v.data) }, owned_by: userObj(f.owner),
      permissions: { can_download: true, can_preview: true, can_upload: role === "editor", can_rename: role === "editor", can_delete: role === "editor", can_share: true, can_comment: true },
    };
    if (!fields.list) return full;
    return Object.fromEntries(Object.entries(full).filter(([k]) => ["type", "id", ...fields.list].includes(k)));
  };
  const issue = (user) => {
    const a = `at-${randomUUID()}`; const r = `rt-${randomUUID()}`;
    access.set(a, user); refresh.set(r, user); issued.push(a, r);
    return { access_token: a, refresh_token: r, expires_in: 3600, token_type: "bearer", restricted_to: [] };
  };

  // Test helpers.
  m.code = (user) => { const c = `code-${randomUUID()}`; codes.set(c, { user, until: Date.now() + 30000 }); return c; };
  m.revokeAccess = (user) => { for (const [t, u] of access) if (u === user) access.delete(t); };
  m.changeInBox = (fileId, data, by) => byId.get(fileId).versions.push({ id: randomUUID(), data, by });

  m.server = createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    calls.push(`${req.method} ${u.pathname}`);
    const chunks = []; for await (const ch of req) chunks.push(ch);
    const body = Buffer.concat(chunks);
    const json = (status, obj, headers = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(obj)); };

    if (u.pathname === "/oauth2/token" && req.method === "POST") {
      const p = new URLSearchParams(body.toString());
      grants.push(p.get("grant_type"));
      if (p.get("client_id") !== clientId || p.get("client_secret") !== clientSecret) return json(400, { error: "invalid_client" });
      if (p.get("grant_type") === "authorization_code") {
        const c = codes.get(p.get("code")); codes.delete(p.get("code"));
        if (!c || c.until < Date.now()) return json(400, { error: "invalid_grant", error_description: "Auth code doesn't exist or is invalid for the client" });
        return json(200, issue(c.user));
      }
      if (p.get("grant_type") === "refresh_token") {
        const user = refresh.get(p.get("refresh_token")); refresh.delete(p.get("refresh_token")); // single-use
        if (!user) return json(400, { error: "invalid_grant", error_description: "Invalid refresh token" });
        return json(200, issue(user));
      }
      return json(400, { error: "unsupported_grant_type" });
    }

    const user = access.get(/^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "");
    if (!user) { res.writeHead(401, { "www-authenticate": 'Bearer realm="Service", error="invalid_token"' }); return res.end(); }
    if (u.pathname === "/2.0/users/me" && req.method === "GET") return json(200, userObj(user));

    let mm = u.pathname.match(/^\/2\.0\/files\/(\d+)(\/content)?$/);
    if (mm && req.method === "GET") {
      const f = byId.get(mm[1]);
      if (!f || !f.roles[user]) return json(404, { type: "error", status: 404, code: "not_found" });
      if (!mm[2]) return json(200, fileObj(mm[1], f, { user, list: u.searchParams.get("fields")?.split(",") }));
      const d = randomUUID(); once.set(d, f.versions.at(-1).data);
      res.writeHead(302, { location: `${m.dlBase}/d/${d}` }); return res.end();
    }
    mm = u.pathname.match(/^\/api\/2\.0\/files\/(\d+)\/content$/);
    if (mm && req.method === "POST") {
      const f = byId.get(mm[1]);
      if (!f || !f.roles[user]) return json(404, { type: "error", status: 404, code: "not_found" });
      if (f.roles[user] !== "editor") return json(403, { type: "error", status: 403, code: "access_denied_insufficient_permissions" });
      const ifMatch = req.headers["if-match"];
      if (ifMatch !== undefined && ifMatch !== String(f.versions.length - 1)) return json(412, { type: "error", status: 412, code: "precondition_failed" });
      const parts = multipart(body, /boundary=([^;]+)/.exec(req.headers["content-type"] ?? "")?.[1]);
      if (parts[0]?.name !== "attributes" || parts[1]?.name !== "file") return json(400, { type: "error", status: 400, code: "metadata_after_file_contents" });
      const attrs = JSON.parse(parts[0].data.toString());
      if (!attrs.name) return json(400, { type: "error", status: 400, code: "bad_request" });
      if (req.headers["content-md5"] && req.headers["content-md5"] !== sha1(parts[1].data)) return json(400, { type: "error", status: 400, code: "bad_digest" });
      f.name = attrs.name;
      f.versions.push({ id: randomUUID(), data: parts[1].data, by: user });
      return json(201, { total_count: 1, entries: [fileObj(mm[1], f, { user })] });
    }
    return json(404, { type: "error", status: 404, code: "not_found" });
  });

  m.dlServer = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    dlCalls.push({ path: u.pathname, authorization: req.headers.authorization ?? null });
    const d = u.pathname.match(/^\/d\/([\w-]+)$/)?.[1];
    if (req.headers.authorization) { res.writeHead(400); return res.end("no Authorization header on the download host"); }
    const data = d && once.get(d); once.delete(d);
    if (!data) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": "application/octet-stream" }); res.end(data);
  });

  m.listen = async (host = "127.0.0.1", port = 0, dlPort = 0) => {
    const up = (s, p) => new Promise((r) => s.listen(p, host, () => r(`http://${host}:${s.address().port}`)));
    const apiUrl = await up(m.server, port);
    m.dlBase = await up(m.dlServer, dlPort);
    return { apiUrl, dlUrl: m.dlBase };
  };
  m.close = () => { m.server.close(); m.dlServer.close(); };
  return m;
}

function multipart(body, boundary) {
  if (!boundary) return [];
  const sep = Buffer.from(`--${boundary.replace(/^"|"$/g, "")}`);
  const parts = []; let at = body.indexOf(sep);
  while (at !== -1) {
    const next = body.indexOf(sep, at + sep.length);
    if (next === -1) break;
    const chunk = body.subarray(at + sep.length + 2, next - 2); // skip CRLF after the boundary and before the next
    const split = chunk.indexOf("\r\n\r\n");
    const head = chunk.subarray(0, split).toString();
    parts.push({ name: /name="([^"]*)"/.exec(head)?.[1], data: Buffer.from(chunk.subarray(split + 4)) });
    at = next;
  }
  return parts;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import("node:fs");
  const [port = "8797", ...paths] = process.argv.slice(2);
  const m = mockBox({
    clientId: process.env.BOX_CLIENT_ID ?? "mock-client", clientSecret: process.env.BOX_CLIENT_SECRET ?? "mock-secret",
    users: { 11: { name: "Editor" }, 12: { name: "Viewer" } },
    files: paths.map((p, i) => ({ id: String(1001 + i), name: p.split("/").pop(), owner: "11", roles: { 11: "editor", 12: "viewer" }, data: readFileSync(p) })),
  });
  const { apiUrl, dlUrl } = await m.listen("0.0.0.0", Number(port), Number(port) + 1);
  console.log(`mock Box API ${apiUrl}, downloads ${dlUrl}: ${[...m.byId.entries()].map(([id, f]) => `${id}=${f.name}`).join(", ")}`);
  console.log(`auth codes: editor ${m.code("11")}  viewer ${m.code("12")} (30 s)`);
}
