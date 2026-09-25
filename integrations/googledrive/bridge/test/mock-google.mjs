// A tiny stand-in for the Google endpoints the bridge uses:
//   GET   /o/oauth2/v2/auth                  sign-in; the person signing in is login_hint. Redirects
//                                            to redirect_uri with a one-time code and the state
//   POST  /token                             authorization_code and refresh_token grants
//   GET   /drive/v3/about                    the signed-in user
//   GET   /drive/v3/files/{id}               metadata; with ?alt=media the head revision's bytes
//   PATCH /upload/drive/v3/files/{id}?uploadType=media   a new revision of the same file
// Like Google, a refresh token comes only with the first consent, or with prompt=consent.
// A user may read a file they own, write or read; canEdit is true for the owner and writers,
// and a PATCH by anybody else is answered 403.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const SCOPE = "https://www.googleapis.com/auth/drive.file";

export function mockGoogle({ clientId, clientSecret, users = {}, files = [], consented = [] }) {
  const byId = new Map(); // id -> { name, mimeType, owner, writers:Set, readers:Set, version, revisions: [{ id, data, by }] }
  for (const f of files) {
    byId.set(f.id, { name: f.name, mimeType: f.mimeType, owner: f.owner, writers: new Set(f.writers ?? []), readers: new Set(f.readers ?? []),
      version: 1, revisions: [{ id: "r1", data: f.data, by: f.owner }] });
  }
  const codes = new Map();    // code -> { user, redirectUri, scope, refresh }
  const access = new Map();   // access token -> user
  const refreshes = new Map(); // refresh token -> user
  const agreed = new Set(consented);
  const issued = [];          // every token handed out, to check none of them reaches a page
  const stats = { refreshes: 0 };
  const calls = [];
  const rnd = (p) => `${p}${randomBytes(12).toString("base64url")}`;

  const server = createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    calls.push(`${req.method} ${u.pathname}`);
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const json = (status, obj) => { const b = Buffer.from(JSON.stringify(obj)); res.writeHead(status, { "content-type": "application/json" }); res.end(b); };
    const q = u.searchParams;

    if (u.pathname === "/o/oauth2/v2/auth" && req.method === "GET") {
      const user = q.get("login_hint") ?? "";
      if (q.get("client_id") !== clientId || q.get("response_type") !== "code" || !q.get("redirect_uri")) return json(400, { error: "invalid_request" });
      if (!String(q.get("scope")).split(" ").includes(SCOPE) || !users[user]) return json(400, { error: "invalid_scope" });
      const code = rnd("4/");
      const refresh = q.get("access_type") === "offline" && (!agreed.has(user) || q.get("prompt") === "consent");
      codes.set(code, { user, redirectUri: q.get("redirect_uri"), scope: SCOPE, refresh });
      agreed.add(user);
      const to = new URL(q.get("redirect_uri"));
      to.searchParams.set("code", code); to.searchParams.set("scope", SCOPE); to.searchParams.set("state", q.get("state") ?? "");
      res.writeHead(302, { location: String(to) }); return res.end();
    }

    if (u.pathname === "/token" && req.method === "POST") {
      const f = new URLSearchParams(body.toString());
      if (f.get("client_id") !== clientId || f.get("client_secret") !== clientSecret) return json(401, { error: "invalid_client" });
      let user;
      let refresh = null;
      if (f.get("grant_type") === "authorization_code") {
        const c = codes.get(f.get("code") ?? "");
        codes.delete(f.get("code") ?? "");
        if (!c || c.redirectUri !== f.get("redirect_uri")) return json(400, { error: "invalid_grant" });
        user = c.user;
        if (c.refresh) { refresh = rnd("1//"); refreshes.set(refresh, user); issued.push(refresh); }
      } else if (f.get("grant_type") === "refresh_token") {
        user = refreshes.get(f.get("refresh_token") ?? "");
        if (!user) return json(400, { error: "invalid_grant" });
        stats.refreshes++;
      } else return json(400, { error: "unsupported_grant_type" });
      const token = rnd("ya29.");
      access.set(token, user); issued.push(token);
      return json(200, { access_token: token, expires_in: 3599, token_type: "Bearer", scope: SCOPE, ...(refresh ? { refresh_token: refresh } : {}) });
    }

    const user = access.get(/^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "");
    if (!user) return json(401, { error: { code: 401, message: "Request had invalid authentication credentials." } });

    if (u.pathname === "/drive/v3/about" && req.method === "GET") {
      return json(200, { user: { kind: "drive#user", displayName: users[user].name, emailAddress: users[user].email, permissionId: user } });
    }
    const m = u.pathname.match(/^(\/upload)?\/drive\/v3\/files\/([\w-]+)$/);
    const f = m && byId.get(m[2]);
    const can = f && { edit: f.owner === user || f.writers.has(user), read: f.owner === user || f.writers.has(user) || f.readers.has(user) };
    if (m && !can?.read) return json(404, { error: { code: 404, message: `File not found: ${m[2]}.` } });
    if (m && !m[1] && req.method === "GET") {
      const head = f.revisions.at(-1);
      if (q.get("alt") === "media") { res.writeHead(200, { "content-type": f.mimeType }); return res.end(head.data); }
      return json(200, { name: f.name, mimeType: f.mimeType, size: String(head.data.length), version: String(f.version), headRevisionId: head.id,
        capabilities: { canEdit: can.edit }, owners: [{ displayName: users[f.owner]?.name, permissionId: f.owner }] });
    }
    if (m && m[1] && req.method === "PATCH") {
      if (q.get("uploadType") !== "media") return json(400, { error: { code: 400, message: "Bad uploadType" } });
      if (!can.edit) return json(403, { error: { code: 403, message: "The user does not have sufficient permissions for this file." } });
      const rev = { id: `r${f.revisions.length + 1}`, data: body, by: user };
      f.revisions.push(rev);
      f.version++;
      return json(200, { kind: "drive#file", id: m[2], name: f.name, mimeType: f.mimeType, version: String(f.version), headRevisionId: rev.id });
    }
    return json(404, { error: { code: 404, message: "Not found" } });
  });
  // Every access token stops working, as after an hour: the bridge must use the refresh token.
  const expireAccessTokens = () => access.clear();
  return { server, byId, calls, issued, stats, expireAccessTokens };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import("node:fs");
  const [port = "8793", ...paths] = process.argv.slice(2);
  const g = mockGoogle({
    clientId: process.env.GOOGLE_CLIENT_ID ?? "sumoffice-test", clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "sumoffice-test-secret",
    users: { "u-owner": { name: "Drive Owner", email: "owner@example.com" } },
    files: paths.map((p, i) => ({ id: `f${i + 1}`, name: p.split("/").pop(), mimeType: "application/octet-stream", owner: "u-owner", data: readFileSync(p) })),
  });
  g.server.listen(Number(port), "0.0.0.0", () => console.log(`mock Google on :${port}: ${[...g.byId.entries()].map(([id, f]) => `${id}=${f.name}`).join(", ")}`));
}
