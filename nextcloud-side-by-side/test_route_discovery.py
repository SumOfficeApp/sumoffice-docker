# Tests for the routed discovery: python3 -m unittest nextcloud-side-by-side/test_route_discovery.py
import http.server, os, socket, subprocess, sys, threading, time, unittest, urllib.error, urllib.request
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
COOL = "http://collabora:9980/browser/0a1b2c3/cool.html?"
# Shape of Collabora CODE's discovery: ext-keyed apps (writer, calc, …) and MIME-keyed apps.
# Collabora lists .xlsm but not .xlsb.
COLLABORA_XML = f'''<?xml version="1.0" encoding="utf-8"?>
<wopi-discovery>
  <net-zone name="external-http">
    <app favIconUrl="http://collabora:9980/browser/0a1b2c3/images/x-office-document.svg" name="writer">
      <action default="true" ext="odt" name="edit" urlsrc="{COOL}"/>
      <action default="true" ext="docx" name="edit" urlsrc="{COOL}"/>
    </app>
    <app favIconUrl="http://collabora:9980/browser/0a1b2c3/images/x-office-spreadsheet.svg" name="calc">
      <action default="true" ext="ods" name="edit" urlsrc="{COOL}"/>
      <action default="true" ext="xlsx" name="edit" urlsrc="{COOL}"/>
      <action default="true" ext="xlsm" name="edit" urlsrc="{COOL}"/>
    </app>
    <app name="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"><action default="true" ext="" name="edit" urlsrc="{COOL}"/></app>
    <app name="application/vnd.openxmlformats-officedocument.wordprocessingml.document"><action default="true" ext="" name="edit" urlsrc="{COOL}"/></app>
    <app name="application/vnd.oasis.opendocument.text"><action default="true" ext="" name="edit" urlsrc="{COOL}"/></app>
    <app name="application/vnd.ms-excel.sheet.macroEnabled.12"><action default="true" ext="" name="edit" urlsrc="{COOL}"/></app>
    <app name="Capabilities"><action ext="" name="getinfo" urlsrc="http://collabora:9980/hosting/capabilities"/></app>
  </net-zone>
  <proof-key exponent="AQAB" modulus="MOD" oldexponent="AQAB" oldmodulus="OLDMOD" oldvalue="OLDVAL" value="VAL"/>
</wopi-discovery>'''
SHEET_XML = ('<wopi-discovery><net-zone name="external-http"><app name="SumSheet">'
             '<action name="edit" ext="xlsx" default="true" urlsrc="http://office.example.com/sheets/wopi/edit?"/></app>'
             '</net-zone></wopi-discovery>')


def fake(body, seen=None):
    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            if seen is not None: seen.append(self.headers.get("Host"))
            data = body.encode(); self.send_response(200); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
        def log_message(self, *a): pass
    s = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); return s.getsockname()[1]


def run(collabora_url, sheet_url, **env_extra):
    port = free_port()
    env = dict(os.environ, PUBLIC_URL="https://office.example.com", PORT=str(port), COLLABORA_URL=collabora_url, SUMSHEET_URL=sheet_url, **env_extra)
    p = subprocess.Popen([sys.executable, os.path.join(HERE, "route-discovery.py")], env=env, stderr=subprocess.DEVNULL)
    try:
        for _ in range(200):  # a busy machine can take seconds to start Python
            try:
                return 200, urllib.request.urlopen(f"http://127.0.0.1:{port}/hosting/discovery", timeout=2).read().decode()
            except urllib.error.HTTPError as e:
                return e.code, e.read().decode()
            except Exception:
                time.sleep(0.1)
        raise RuntimeError("route-discovery did not start")
    finally:
        p.kill()


def urlsrc_by_mime(xml, mime):
    """What Nextcloud Office does: the first action of app[@name=mime]."""
    for app in ET.fromstring(xml).iter("app"):
        if app.get("name") == mime:
            return app.find("action").get("urlsrc")


class RoutedDiscovery(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hosts = []
        cls.cool, cls.sheet = fake(COLLABORA_XML, cls.hosts), fake(SHEET_XML)
        cls.code, cls.xml = run(f"http://127.0.0.1:{cls.cool.server_port}", f"http://127.0.0.1:{cls.sheet.server_port}", COLLABORA_HOST="office.example.com")

    @classmethod
    def tearDownClass(cls):
        cls.cool.shutdown(); cls.sheet.shutdown()

    def test_macro_workbooks_go_to_sumsheet(self):
        self.assertEqual(self.code, 200)
        for mime in ("application/vnd.ms-excel.sheet.macroEnabled.12", "application/vnd.ms-excel.sheet.binary.macroEnabled.12"):
            self.assertEqual(urlsrc_by_mime(self.xml, mime), "https://office.example.com/sheets/wopi/edit?", mime)

    def test_xlsb_is_added_when_collabora_lacks_it(self):
        app = [a for a in ET.fromstring(self.xml).iter("app") if a.get("name") == "application/vnd.ms-excel.sheet.binary.macroEnabled.12"]
        self.assertEqual(len(app), 1)
        self.assertEqual({x.get("name") for x in app[0]}, {"edit", "view"})

    def test_everything_else_stays_with_collabora_on_the_front_origin(self):
        for mime in ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                     "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                     "application/vnd.oasis.opendocument.text"):
            self.assertEqual(urlsrc_by_mime(self.xml, mime), "https://office.example.com/browser/0a1b2c3/cool.html?", mime)
        self.assertEqual(urlsrc_by_mime(self.xml, "Capabilities"), "https://office.example.com/hosting/capabilities")

    def test_ext_keyed_actions(self):
        calc = [a for a in ET.fromstring(self.xml).iter("app") if a.get("name") == "calc"][0]
        src = {x.get("ext"): x.get("urlsrc") for x in calc}
        self.assertEqual(src["xlsm"], "https://office.example.com/sheets/wopi/edit?")
        self.assertEqual(src["xlsx"], "https://office.example.com/browser/0a1b2c3/cool.html?")
        self.assertEqual(src["ods"], "https://office.example.com/browser/0a1b2c3/cool.html?")

    def test_one_origin_for_every_urlsrc(self):
        # Nextcloud's CSP allows exactly one frame origin: public_wopi_url.
        for a in ET.fromstring(self.xml).iter("action"):
            self.assertTrue(a.get("urlsrc").startswith("https://office.example.com/"), a.attrib)

    def test_collabora_proof_key_passes_through(self):
        pk = ET.fromstring(self.xml).find("proof-key")
        self.assertEqual(pk.attrib, ET.fromstring(COLLABORA_XML).find("proof-key").attrib)

    def test_host_header_to_collabora(self):
        self.assertIn("office.example.com", self.hosts)


class Failures(unittest.TestCase):
    def test_no_collabora_no_discovery(self):
        # A discovery without Collabora would break every other format: 502, not a partial answer.
        sheet = fake(SHEET_XML)
        try:
            code, _ = run(f"http://127.0.0.1:{free_port()}", f"http://127.0.0.1:{sheet.server_port}")
        finally:
            sheet.shutdown()
        self.assertEqual(code, 502)

    def test_sumsheet_down_still_routes_to_its_address(self):
        cool = fake(COLLABORA_XML)
        try:
            code, xml = run(f"http://127.0.0.1:{cool.server_port}", f"http://127.0.0.1:{free_port()}")
        finally:
            cool.shutdown()
        self.assertEqual(code, 200)
        self.assertEqual(urlsrc_by_mime(xml, "application/vnd.ms-excel.sheet.macroEnabled.12"), "https://office.example.com/sheets/wopi/edit?")

    def test_route_set_is_configurable(self):
        cool, sheet = fake(COLLABORA_XML), fake(SHEET_XML)
        try:
            code, xml = run(f"http://127.0.0.1:{cool.server_port}", f"http://127.0.0.1:{sheet.server_port}",
                            ROUTE_MIMES="application/vnd.ms-excel.sheet.macroEnabled.12", ROUTE_EXTS="xlsm")
        finally:
            cool.shutdown(); sheet.shutdown()
        self.assertEqual(urlsrc_by_mime(xml, "application/vnd.ms-excel.sheet.macroEnabled.12"), "https://office.example.com/sheets/wopi/edit?")
        self.assertIsNone(urlsrc_by_mime(xml, "application/vnd.ms-excel.sheet.binary.macroEnabled.12"))


if __name__ == "__main__":
    unittest.main()
