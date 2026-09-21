# One WOPI discovery for two editors: DOCX → SumDoc (/a4), XLSX/XLSM/XLSB → SumSheet (/f1).
# Nextcloud reads discovery from one address; each action's urlsrc may point to its own editor.
# Temporary glue until the images publish a joint discovery themselves.
import http.server, urllib.request, re, sys, os
PUBLIC = os.environ.get("PUBLIC_URL", "http://localhost:8093").rstrip("/")
A4 = "http://sumdoc:8090"; F1 = "http://sumsheet:8092"
def fetch(u):
    try: return urllib.request.urlopen(u, timeout=10).read().decode("utf-8", "replace")
    except Exception as e: return ""
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/hosting/discovery"):
            a = fetch(A4 + "/hosting/discovery"); f = fetch(F1 + "/hosting/discovery")
            apps = re.findall(r"<app .*?</app>", a, re.S) + re.findall(r"<app .*?</app>", f, re.S)
            # xlsm/xlsb для Nextcloud: те же urlsrc, что у xlsx; mime-имена как у Collabora
            xl = [x for x in apps if 'name="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"' in x]
            extra = []
            if xl:
                src = re.search(r'urlsrc="([^"]+)"', xl[0]).group(1)
                for mime, ext in (("application/vnd.ms-excel.sheet.macroEnabled.12","xlsm"),("application/vnd.ms-excel.sheet.binary.macroEnabled.12","xlsb")):
                    extra.append(f'<app name="{mime}"><action name="edit" default="true" urlsrc="{src}"/><action name="view" urlsrc="{src}"/></app><app name="calc"><action name="edit" ext="{ext}" default="true" urlsrc="{src}"/></app>')
            # Nextcloud ждёт приложение Capabilities с адресом /hosting/capabilities (как у Collabora).
            extra.append(f'<app name="Capabilities"><action name="getinfo" ext="" default="true" urlsrc="{PUBLIC}/hosting/capabilities"/></app>')
            proof = re.search(r"<proof-key[^>]*/>|<proof-key.*?</proof-key>", a, re.S)
            body = '<?xml version="1.0" encoding="UTF-8"?><wopi-discovery><net-zone name="external-http">' + "".join(apps) + "".join(extra) + "</net-zone>" + (proof.group(0) if proof else "") + "</wopi-discovery>"
            data = body.encode(); self.send_response(200); self.send_header("Content-Type","text/xml; charset=utf-8"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data); return
        if self.path.startswith("/hosting/capabilities"):
            import json
            try: caps = json.loads(fetch(A4 + "/hosting/capabilities") or "{}")
            except Exception: caps = {}
            # Nextcloud shows productName in its admin page: the stack is SumOffice, whatever each editor calls itself.
            caps = {"hasMobileSupport": False, "hasProxyPrefix": False, "hasTemplateSaveAs": False, "hasTemplateSource": False, "hasZoteroSupport": False, "hasWASMSupport": False, "convert-to": {"available": False}, **caps, "productName": "SumOffice", "productVersion": caps.get("productVersion", "2026.3"), "productVersionHash": caps.get("productVersionHash", "sumoffice")}
            data = json.dumps(caps).encode()
            self.send_response(200); self.send_header("Content-Type","application/json"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data); return
        self.send_response(404); self.end_headers()
    def log_message(self, *a): sys.stderr.write("[merge] " + (a[0] % a[1:]) + "\n")
http.server.ThreadingHTTPServer(("0.0.0.0", 8093), H).serve_forever()
