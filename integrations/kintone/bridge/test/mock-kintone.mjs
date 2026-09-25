// A tiny stand-in for the kintone REST endpoints the bridge uses:
// GET/PUT /k/v1/record.json (with $revision and the 409 on a stale revision),
// GET/POST /k/v1/file.json. One app, API-token auth, files kept in memory.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

export function mockKintone({ app = "7", token = "tok-7", records = {} } = {}) {
  const files = new Map();      // fileKey -> { name, contentType, data }
  const store = new Map();      // record id -> { revision, fields: { code: [fileKey...] } }
  const calls = [];
  const put = (name, contentType, data) => { const k = randomUUID(); files.set(k, { name, contentType, data }); return k; };
  for (const [id, fields] of Object.entries(records)) {
    const f = {};
    for (const [code, list] of Object.entries(fields)) f[code] = list.map((x) => put(x.name, x.contentType ?? "application/octet-stream", x.data));
    store.set(id, { revision: 1, fields: f });
  }
  const view = (id) => {
    const r = store.get(id);
    const record = { $id: { type: "__ID__", value: id }, $revision: { type: "__REVISION__", value: String(r.revision) } };
    for (const [code, keys] of Object.entries(r.fields)) {
      record[code] = { type: "FILE", value: keys.map((k) => ({ fileKey: k, name: files.get(k).name, contentType: files.get(k).contentType, size: String(files.get(k).data.length) })) };
    }
    return record;
  };
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    calls.push(`${req.method} ${u.pathname}`);
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const json = (status, obj) => { const b = Buffer.from(JSON.stringify(obj)); res.writeHead(status, { "content-type": "application/json", "content-length": b.length }); res.end(b); };
    if (req.headers["x-cybozu-api-token"] !== token) return json(401, { code: "GAIA_IA02" });
    if (u.pathname === "/k/v1/record.json" && req.method === "GET") {
      if (u.searchParams.get("app") !== app || !store.has(u.searchParams.get("id"))) return json(404, { code: "GAIA_RE01" });
      return json(200, { record: view(u.searchParams.get("id")) });
    }
    if (u.pathname === "/k/v1/record.json" && req.method === "PUT") {
      const q = JSON.parse(body.toString());
      const r = store.get(String(q.id));
      if (String(q.app) !== app || !r) return json(404, { code: "GAIA_RE01" });
      if (q.revision !== undefined && String(q.revision) !== String(r.revision)) return json(409, { code: "GAIA_CO02" });
      for (const [code, { value }] of Object.entries(q.record)) {
        if (!r.fields[code]) return json(400, { code: "CB_VA01" });
        for (const v of value) if (!files.has(v.fileKey)) return json(400, { code: "GAIA_BL01" });
        r.fields[code] = value.map((v) => v.fileKey);
      }
      r.revision += 1;
      return json(200, { revision: String(r.revision) });
    }
    if (u.pathname === "/k/v1/file.json" && req.method === "GET") {
      const f = files.get(u.searchParams.get("fileKey"));
      if (!f) return json(404, { code: "GAIA_BL01" });
      res.writeHead(200, { "content-type": f.contentType, "content-length": f.data.length }); return res.end(f.data);
    }
    if (u.pathname === "/k/v1/file.json" && req.method === "POST") {
      // multipart/form-data with one "file" part
      const boundary = /boundary=([^;]+)/.exec(req.headers["content-type"] ?? "")?.[1];
      if (!boundary) return json(400, { code: "CB_IL02" });
      const text = body.toString("latin1");
      const start = text.indexOf("\r\n\r\n") + 4;
      const end = text.lastIndexOf(`\r\n--${boundary}`);
      const head = text.slice(0, start);
      const name = /filename="([^"]*)"/.exec(head)?.[1] ?? "file";
      const type = /Content-Type: ([^\r\n]+)/i.exec(head)?.[1] ?? "application/octet-stream";
      return json(200, { fileKey: put(name, type, body.subarray(start, end)) });
    }
    return json(404, { code: "GAIA_NF01" });
  });
  return { server, files, store, calls, view };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import("node:fs");
  const [port = "8788", ...paths] = process.argv.slice(2);
  const m = mockKintone({ records: { 1: { attachments: paths.map((p) => ({ name: p.split("/").pop(), data: readFileSync(p) })) } } });
  m.server.listen(Number(port), "0.0.0.0", () => console.log(`mock kintone on :${port}, app 7, record 1, field "attachments": ${paths.length} file(s)`));
  process.on("SIGUSR2", () => { for (const [k, f] of m.files) console.log(k, f.name, f.data.length); });
  globalThis.mock = m;
}
