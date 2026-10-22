# SumOffice next to Collabora: one WOPI discovery for Nextcloud Office (richdocuments),
# taken from Collabora, with only the macro workbooks (.xlsm, .xlsb) sent to SumSheet.
#
# Nextcloud Office reads one discovery from one address (wopi_url) and allows one
# origin for the editor frame (public_wopi_url). This service serves that discovery:
#   * every app and action exactly as Collabora publishes it, except
#   * the MIME types in ROUTE_MIMES and the extensions in ROUTE_EXTS, whose urlsrc
#     is replaced by SumSheet's;
#   * every urlsrc is moved to PUBLIC_URL, the address of the front (nginx) that
#     proxies Collabora and SumSheet under one origin;
#   * Collabora's proof key is passed through unchanged. SumSheet is started with the
#     same private key (see take-collabora-proof-key.sh), so the one key in discovery
#     is right for both editors.
# If Collabora cannot be reached the answer is 502: a discovery without Collabora
# would break every other file type in Nextcloud.
import http.server, os, re, sys, urllib.parse, urllib.request

PUBLIC = os.environ.get("PUBLIC_URL", "http://localhost:8093").rstrip("/")
COLLABORA = os.environ.get("COLLABORA_URL", "http://collabora:9980").rstrip("/")
SUMSHEET = os.environ.get("SUMSHEET_URL", "http://sumsheet:8092").rstrip("/")
# Host header for Collabora: it builds urlsrc from it when server_name is not set.
COLLABORA_HOST = os.environ.get("COLLABORA_HOST", "")
# Default: .xlsm only. .xlsb opens in SumSheet but the SumSheet images up to 2026.10.20b cannot
# save it (stand 22.10: "xlsb-save-current-source-only"); Collabora shows .xlsb read-only.
# Add it with ROUTE_EXTS=xlsm,xlsb and ROUTE_MIMES=…macroEnabled.12,…binary.macroEnabled.12.
ROUTE_MIMES = tuple(m for m in os.environ.get("ROUTE_MIMES", "application/vnd.ms-excel.sheet.macroEnabled.12").split(",") if m)
ROUTE_EXTS = tuple(e for e in os.environ.get("ROUTE_EXTS", "xlsm").split(",") if e)
EXT_OF = {"application/vnd.ms-excel.sheet.macroEnabled.12": "xlsm", "application/vnd.ms-excel.sheet.binary.macroEnabled.12": "xlsb"}


def fetch(url, host=""):
    req = urllib.request.Request(url, headers={"Host": host} if host else {})
    return urllib.request.urlopen(req, timeout=10).read().decode("utf-8", "replace")


def origin(url):
    p = urllib.parse.urlsplit(url)
    return f"{p.scheme}://{p.netloc}"


def to_public(urlsrc):
    """The same path and query on the front's origin."""
    p = urllib.parse.urlsplit(urlsrc)
    return origin(PUBLIC) + urllib.parse.urlunsplit(("", "", p.path, p.query, p.fragment)) + ("?" if urlsrc.endswith("?") and not p.query else "")


def sumsheet_urlsrc(xml):
    m = (re.search(r'<action [^>]*ext="xlsx"[^>]*urlsrc="([^"]+)"', xml)
         or re.search(r'<app name="application/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet">.*?urlsrc="([^"]+)"', xml, re.S))
    return to_public(m.group(1)) if m else PUBLIC + "/sheets/wopi/edit?"


def route(collabora_xml, sheet_src):
    """Collabora's discovery with the routed types pointing at SumSheet."""
    out = re.sub(r'urlsrc="([^"]+)"', lambda m: f'urlsrc="{to_public(m.group(1))}"', collabora_xml)

    to_sheet = lambda s: re.sub(r'urlsrc="[^"]+"', f'urlsrc="{sheet_src}"', s)
    routed_ext = re.compile(r'\bext="(' + "|".join(map(re.escape, ROUTE_EXTS)) + r')"') if ROUTE_EXTS else None

    def action(a):
        # ext-keyed actions (app "calc" and the like): only the routed extensions
        return to_sheet(a.group(0)) if routed_ext and routed_ext.search(a.group(0)) else a.group(0)

    def app(m):
        block, name = m.group(0), m.group(1)
        return to_sheet(block) if name in ROUTE_MIMES else re.sub(r"<action [^>]*>", action, block)
    out = re.sub(r'<app [^>]*?\bname="([^"]*)".*?</app>', app, out, flags=re.S)
    # A routed MIME type Collabora does not list at all: add it, or Nextcloud Office will not offer it.
    listed = set(re.findall(r'<app [^>]*?\bname="([^"]*)"', out))
    missing = [m for m in ROUTE_MIMES if m not in listed]
    if missing:
        extra = "".join(f'<app name="{m}"><action name="edit" ext="{EXT_OF.get(m, "")}" default="true" urlsrc="{sheet_src}"/>'
                        f'<action name="view" ext="{EXT_OF.get(m, "")}" urlsrc="{sheet_src}"/></app>' for m in missing)
        out = re.sub(r"(<net-zone [^>]*>)", lambda z: z.group(1) + extra, out, count=1)
    return out


class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if not self.path.startswith("/hosting/discovery"):
            self.send_response(404); self.end_headers(); return
        try:
            collabora = fetch(COLLABORA + "/hosting/discovery", COLLABORA_HOST)
        except Exception as e:
            return self.reply(502, f"Collabora discovery unavailable: {e}".encode(), "text/plain")
        try:
            sheet = sumsheet_urlsrc(fetch(SUMSHEET + "/hosting/discovery"))
        except Exception:
            sheet = PUBLIC + "/sheets/wopi/edit?"
        self.reply(200, route(collabora, sheet).encode(), "text/xml; charset=utf-8")

    def reply(self, code, data, ctype):
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(data)))
        self.end_headers(); self.wfile.write(data)

    def log_message(self, *a): sys.stderr.write("[route] " + (a[0] % a[1:]) + "\n")


if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8093"))), H).serve_forever()
