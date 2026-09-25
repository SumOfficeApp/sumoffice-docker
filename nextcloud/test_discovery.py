# Tests for the joint discovery: python3 -m unittest nextcloud/test_discovery.py
import http.server, os, re, subprocess, sys, threading, time, unittest, urllib.request
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
A4_XML = ('<wopi-discovery><net-zone name="external-https"><app name="writer">'
          '<action name="edit" ext="docx" default="true" urlsrc="https://office.example.com/a4/wopi/edit?"/>'
          '<action name="view" ext="docx" urlsrc="https://office.example.com/a4/wopi/edit?"/></app>'
          '<app name="application/vnd.openxmlformats-officedocument.wordprocessingml.document">'
          '<action name="edit" ext="" default="true" urlsrc="https://office.example.com/a4/wopi/edit?"/></app>'
          '</net-zone><proof-key value="AAA" modulus="MMM" exponent="AQAB"/></wopi-discovery>')
F1_XML = ('<wopi-discovery><net-zone name="external-https"><app name="FastSheet">'
          '<action name="edit" ext="xlsx" default="true" urlsrc="https://office.example.com/f1/wopi/edit?"/>'
          '<action name="view" ext="xlsx" urlsrc="https://office.example.com/f1/wopi/edit?"/></app>'
          '<app name="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">'
          '<action name="edit" ext="" default="true" urlsrc="https://office.example.com/f1/wopi/edit?"/></app>'
          '</net-zone><proof-key value="AAA" modulus="MMM" exponent="AQAB"/></wopi-discovery>')

def fake(body):
    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            data = body.encode(); self.send_response(200); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
        def log_message(self, *a): pass
    s = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s

def run(public, port, script=os.path.join(HERE, "discovery.py")):
    a4, f1 = fake(A4_XML), fake(F1_XML)
    env = dict(os.environ, PUBLIC_URL=public, PORT=str(port),
               SUMDOC_URL=f"http://127.0.0.1:{a4.server_port}", SUMSHEET_URL=f"http://127.0.0.1:{f1.server_port}")
    p = subprocess.Popen([sys.executable, script], env=env, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try: return urllib.request.urlopen(f"http://127.0.0.1:{port}/hosting/discovery", timeout=2).read().decode()
            except Exception: time.sleep(0.1)
        raise RuntimeError("discovery did not start")
    finally:
        p.kill(); a4.shutdown(); f1.shutdown()

def zones(xml):
    return {z.get("name"): z for z in ET.fromstring(xml).findall("net-zone")}

class JointDiscovery(unittest.TestCase):
    def test_sharepoint_zone_over_https(self):
        z = zones(run("https://office.example.com", 18931))
        self.assertIn("internal-https", z, "SharePoint reads internal-https by default")
        apps = {a.get("name"): a for a in z["internal-https"].findall("app")}
        self.assertEqual(set(apps), {"Word", "Excel"})
        word = [(x.get("name"), x.get("ext")) for x in apps["Word"].findall("action")]
        self.assertEqual(word, [("view", "docx"), ("edit", "docx")])
        excel = {(x.get("name"), x.get("ext")) for x in apps["Excel"].findall("action")}
        self.assertEqual(excel, {(n, e) for n in ("view", "edit") for e in ("xlsx", "xlsm", "xlsb")})
        for a in apps["Excel"].findall("action"):
            self.assertTrue(a.get("urlsrc").startswith("https://office.example.com/f1/"))
        for a in apps["Word"].findall("action"):
            self.assertTrue(a.get("urlsrc").startswith("https://office.example.com/a4/"))
        # hosts that key actions by extension keep the last action: it must be edit
        last = {}
        for a in apps["Excel"].findall("action"): last[a.get("ext")] = a.get("name")
        self.assertEqual(set(last.values()), {"edit"})

    def test_no_sharepoint_zone_over_http(self):
        self.assertNotIn("internal-https", zones(run("http://office.example.com", 18932)))

    def test_existing_zone_unchanged(self):
        # The zone Nextcloud, ownCloud, OpenCloud, Moodle, ILIAS and Mattermost read must stay byte for byte.
        new = run("https://office.example.com", 18933)
        old_script = os.environ.get("OLD_DISCOVERY")
        if not old_script:
            self.skipTest("set OLD_DISCOVERY to the previous discovery.py to compare")
        old = run("https://office.example.com", 18934, old_script)
        pick = lambda x: re.search(r'<net-zone name="external-http">.*?</net-zone>', x, re.S).group(0)
        self.assertEqual(pick(new), pick(old))
        self.assertEqual(re.search(r"<proof-key[^>]*/>", new).group(0), re.search(r"<proof-key[^>]*/>", old).group(0))

if __name__ == "__main__":
    unittest.main()
