# One WOPI discovery for two editors: DOCX → SumDoc (/a4), XLSX/XLSM/XLSB → SumSheet (/f1).
# Nextcloud reads discovery from one address; each action's urlsrc may point to its own editor.
# Temporary glue until the images publish a joint discovery themselves.
import http.server, urllib.request, re, sys, os
PUBLIC = os.environ.get("PUBLIC_URL", "http://localhost:8093").rstrip("/")
A4 = os.environ.get("SUMDOC_URL", "http://sumdoc:8090"); F1 = os.environ.get("SUMSHEET_URL", "http://sumsheet:8092")
def fetch(u):
    try: return urllib.request.urlopen(u, timeout=10).read().decode("utf-8", "replace")
    except Exception as e: return ""
def sharepoint_zone(a, f):
    # SharePoint Server looks for actions in the "internal-https" zone by default
    # (Set-SPWOPIZone) and lists them under the Microsoft application names Word
    # and Excel. The zone above stays exactly as Nextcloud, ownCloud and others
    # already read it; this second zone only adds the SharePoint view of the same
    # editors. Only over https: SharePoint expects https for this zone.
    if not PUBLIC.startswith("https://"):
        return ""
    def src(xml, ext):
        m = re.search(r'<action [^>]*ext="' + ext + r'"[^>]*urlsrc="([^"]+)"', xml) or re.search(r'urlsrc="([^"]+)"', xml)
        return m.group(1) if m else ""
    def app(name, pairs):
        # view before edit: hosts that key actions by extension keep the last one.
        # view is the default action, as Office Online Server publishes it: SharePoint opens a document
        # "in the browser" only through a binding marked IsDefaultAction, which comes from default="true".
        acts = "".join(f'<action name="view" ext="{e}" default="true" urlsrc="{u}"/><action name="edit" ext="{e}" urlsrc="{u}"/>' for e, u in pairs if u)
        return f'<app name="{name}">{acts}</app>' if acts else ""
    word = app("Word", [("docx", src(a, "docx"))])
    xl = src(f, "xlsx")
    excel = app("Excel", [("xlsx", xl), ("xlsm", xl), ("xlsb", xl)])
    return '<net-zone name="internal-https">' + word + excel + "</net-zone>" if (word or excel) else ""
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/hosting/discovery"):
            a = fetch(A4 + "/hosting/discovery"); f = fetch(F1 + "/hosting/discovery")
            apps = re.findall(r"<app .*?</app>", a, re.S) + re.findall(r"<app .*?</app>", f, re.S)
            # xlsm/xlsb for Nextcloud: same urlsrc as xlsx, MIME names as Collabora uses them
            xl = [x for x in apps if 'name="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"' in x]
            extra = []
            if xl:
                src = re.search(r'urlsrc="([^"]+)"', xl[0]).group(1)
                for mime, ext in (("application/vnd.ms-excel.sheet.macroEnabled.12","xlsm"),("application/vnd.ms-excel.sheet.binary.macroEnabled.12","xlsb")):
                    extra.append(f'<app name="{mime}"><action name="edit" ext="{ext}" default="true" urlsrc="{src}"/><action name="view" ext="{ext}" urlsrc="{src}"/></app><app name="calc"><action name="edit" ext="{ext}" default="true" urlsrc="{src}"/></app>')
            # Nextcloud expects a Capabilities app pointing at /hosting/capabilities, the way Collabora publishes it.
            extra.append(f'<app name="Capabilities"><action name="getinfo" ext="" default="true" urlsrc="{PUBLIC}/hosting/capabilities"/></app>')
            proof = re.search(r"<proof-key[^>]*/>|<proof-key.*?</proof-key>", a, re.S)
            body = '<?xml version="1.0" encoding="UTF-8"?><wopi-discovery><net-zone name="external-http">' + "".join(apps) + "".join(extra) + "</net-zone>" + sharepoint_zone(a, f) + (proof.group(0) if proof else "") + "</wopi-discovery>"
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
http.server.ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8093"))), H).serve_forever()
