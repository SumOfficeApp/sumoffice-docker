// One origin for both editors: /f1 → SumSheet, /a4 → SumDoc, /hosting/* → joint WOPI discovery.
// Plain Node (no nginx/python in the image). WebSocket upgrades are passed through.
import http from "node:http";
import net from "node:net";

const PORT = Number(process.env.FRONT_PORT || 8093);
const PUBLIC = String(process.env.PUBLIC_URL || "").replace(/\/$/, "");
const F1 = { host: "127.0.0.1", port: 8092 };
const A4 = { host: "127.0.0.1", port: 8090 };

function upstreamFor(path) {
  if (path === "/f1" || path.startsWith("/f1/")) return F1;
  if (path === "/a4" || path.startsWith("/a4/")) return A4;
  return null;
}

function fetchText(up, path) {
  return new Promise((resolve) => {
    const req = http.get({ ...up, path, timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); resolve(""); return; }
      let body = ""; res.setEncoding("utf8");
      res.on("data", (c) => { body += c; }); res.on("end", () => resolve(body));
    });
    req.on("error", () => resolve("")); req.on("timeout", () => { req.destroy(); resolve(""); });
  });
}

const apps = (xml) => xml.match(/<app .*?<\/app>/gs) ?? [];
const srcFor = (xml, ext) => (xml.match(new RegExp(`<action [^>]*ext="${ext}"[^>]*urlsrc="([^"]+)"`)) ?? xml.match(/urlsrc="([^"]+)"/) ?? [])[1] ?? "";

async function discovery() {
  const a = await fetchText(A4, "/hosting/discovery");
  const f = await fetchText(F1, "/hosting/discovery");
  const all = [...apps(a), ...apps(f)];
  const extra = [];
  // xlsm/xlsb: same urlsrc as xlsx, MIME names as Collabora uses them (ext= for oCIS/OpenCloud).
  const xl = all.find((x) => x.includes('name="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"'));
  if (xl) {
    const src = xl.match(/urlsrc="([^"]+)"/)[1];
    for (const [mime, ext] of [["application/vnd.ms-excel.sheet.macroEnabled.12", "xlsm"], ["application/vnd.ms-excel.sheet.binary.macroEnabled.12", "xlsb"]]) {
      extra.push(`<app name="${mime}"><action name="edit" ext="${ext}" default="true" urlsrc="${src}"/><action name="view" ext="${ext}" urlsrc="${src}"/></app><app name="calc"><action name="edit" ext="${ext}" default="true" urlsrc="${src}"/></app>`);
    }
  }
  extra.push(`<app name="Capabilities"><action name="getinfo" ext="" default="true" urlsrc="${PUBLIC}/hosting/capabilities"/></app>`);
  // SharePoint reads the internal-https zone and the Word/Excel app names; view before edit per extension.
  let sp = "";
  if (PUBLIC.startsWith("https://")) {
    const acts = (pairs) => pairs.filter(([, u]) => u).map(([e, u]) => `<action name="view" ext="${e}" urlsrc="${u}"/><action name="edit" ext="${e}" urlsrc="${u}"/>`).join("");
    const w = acts([["docx", srcFor(a, "docx")]]);
    const xs = srcFor(f, "xlsx");
    const x = acts([["xlsx", xs], ["xlsm", xs], ["xlsb", xs]]);
    sp = `<net-zone name="internal-https">${w ? `<app name="Word">${w}</app>` : ""}${x ? `<app name="Excel">${x}</app>` : ""}</net-zone>`;
  }
  const proof = (a.match(/<proof-key[^>]*\/>|<proof-key.*?<\/proof-key>/s) ?? [""])[0];
  return `<?xml version="1.0" encoding="UTF-8"?><wopi-discovery><net-zone name="external-http">${all.join("")}${extra.join("")}</net-zone>${sp}${proof}</wopi-discovery>`;
}

async function capabilities() {
  let caps = {};
  try { caps = JSON.parse(await fetchText(A4, "/hosting/capabilities") || "{}"); } catch { caps = {}; }
  return JSON.stringify({
    hasMobileSupport: false, hasProxyPrefix: false, hasTemplateSaveAs: false, hasTemplateSource: false,
    hasZoteroSupport: false, hasWASMSupport: false, "convert-to": { available: false },
    ...caps, productName: "SumOffice",
    productVersion: caps.productVersion ?? "2026.3", productVersionHash: caps.productVersionHash ?? "sumoffice",
  });
}

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (path.startsWith("/hosting/discovery")) {
    const body = await discovery(); res.writeHead(200, { "content-type": "text/xml; charset=utf-8" }).end(body); return;
  }
  if (path.startsWith("/hosting/capabilities")) {
    const body = await capabilities(); res.writeHead(200, { "content-type": "application/json" }).end(body); return;
  }
  if (path === "/health") { res.writeHead(200).end("ok"); return; }
  const up = upstreamFor(path);
  if (!up) { res.writeHead(404).end(); return; }
  const headers = { ...req.headers, "x-forwarded-proto": req.headers["x-forwarded-proto"] ?? (PUBLIC.startsWith("https://") ? "https" : "http") };
  const p = http.request({ ...up, method: req.method, path: req.url, headers }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
  p.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(p);
});

server.on("upgrade", (req, socket, head) => {
  const up = upstreamFor(new URL(req.url, "http://x").pathname);
  if (!up) { socket.destroy(); return; }
  const s = net.connect(up.port, up.host, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`, ...Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`)];
    s.write(lines.join("\r\n") + "\r\n\r\n"); if (head?.length) s.write(head);
    s.pipe(socket); socket.pipe(s);
  });
  s.on("error", () => socket.destroy()); socket.on("error", () => s.destroy());
});

server.listen(PORT, "0.0.0.0", () => console.error(`[front] :${PORT} → /f1 ${F1.port}, /a4 ${A4.port}, /hosting/* joint discovery`));
