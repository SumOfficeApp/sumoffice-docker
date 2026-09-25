// A tiny stand-in for the Egnyte Public API calls the bridge uses:
//   GET  /pubapi/v1/fs/ids/file/{group_id}          metadata of the newest version
//   GET  /pubapi/v1/fs-content/ids/file/{group_id}  the newest version's bytes
//   POST /pubapi/v1/fs-content/{path}               a new version of the file at that path
// Bearer tokens: "rw-…" may read and write, "ro-…" may only read.
import { createServer } from "node:http";
import { randomUUID, createHash } from "node:crypto";

export function mockEgnyte(files = []) {
  const byGroup = new Map(); // group_id -> { path, name, versions: [{ entry_id, data, by }] }
  const calls = [];
  for (const f of files) {
    byGroup.set(f.group_id ?? randomUUID(), { path: f.path, name: f.path.split("/").pop(), versions: [{ entry_id: randomUUID(), data: f.data, by: "owner" }] });
  }
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    calls.push(`${req.method} ${u.pathname}`);
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const json = (status, obj) => { const b = Buffer.from(JSON.stringify(obj)); res.writeHead(status, { "content-type": "application/json" }); res.end(b); };
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
    if (!/^(rw|ro)-/.test(token)) return json(401, { errorMessage: "Unauthorized" });
    let m = u.pathname.match(/^\/pubapi\/v1\/fs(-content)?\/ids\/file\/([\w-]+)$/);
    if (m && req.method === "GET") {
      const f = byGroup.get(m[2]);
      if (!f) return json(404, { errorMessage: "File not found" });
      const v = f.versions.at(-1);
      if (m[1]) { res.writeHead(200, { "content-type": "application/octet-stream" }); return res.end(v.data); }
      return json(200, { is_folder: false, name: f.name, path: f.path, group_id: m[2], entry_id: v.entry_id, size: v.data.length,
        checksum: createHash("sha512").update(v.data).digest("hex"), num_versions: f.versions.length, uploaded_by: v.by });
    }
    m = u.pathname.match(/^\/pubapi\/v1\/fs-content(\/.+)$/);
    if (m && req.method === "POST") {
      if (!token.startsWith("rw-")) return json(403, { errorMessage: "Access denied" });
      const path = decodeURIComponent(m[1]);
      const entry = [...byGroup.entries()].find(([, f]) => f.path === path);
      if (!entry) return json(404, { errorMessage: "Parent not found" });
      const v = { entry_id: randomUUID(), data: body, by: token.slice(3) };
      entry[1].versions.push(v);
      return json(200, { checksum: createHash("sha512").update(body).digest("hex"), group_id: entry[0], entry_id: v.entry_id });
    }
    return json(404, { errorMessage: "Not found" });
  });
  return { server, byGroup, calls };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import("node:fs");
  const [port = "8791", ...paths] = process.argv.slice(2);
  const m = mockEgnyte(paths.map((p, i) => ({ group_id: `g${i + 1}`, path: `/Shared/Documents/${p.split("/").pop()}`, data: readFileSync(p) })));
  m.server.listen(Number(port), "0.0.0.0", () => console.log(`mock Egnyte on :${port}: ${[...m.byGroup.entries()].map(([g, f]) => `${g}=${f.path}`).join(", ")}`));
}
