"""WOPI host for Frappe files.

Frappe is the WOPI host (storage), SumOffice is the WOPI client (editor).

``/sumoffice/open/<file>`` checks the signed-in person's rights, mints a short-lived
access token and posts it to the editor action URL from SumOffice's discovery.
The editor calls back ``/wopi/files/<file>`` (CheckFileInfo, locks) and
``/wopi/files/<file>/contents`` (GetFile, PutFile). Every callback runs as the
person who opened the file: Frappe's own permission checks for ``File`` and for
the document it is attached to apply.
"""

import base64
import hashlib
import hmac
import json
import re
import struct
import time
from html import escape
from urllib.parse import quote
from xml.etree import ElementTree

import frappe
import requests
from werkzeug.wrappers import Response

from frappe.website.page_renderers.base_renderer import BaseRenderer

EXTENSIONS = ("xlsx", "xlsm", "xlsb", "docx")
TOKEN_TTL = 10 * 3600
LOCK_TTL = 30 * 60          # MS-WOPI: 30 minutes
PROOF_WINDOW = 20 * 60      # MS-WOPI: 20 minutes of clock skew
DISCOVERY_TTL = 3600
ROUTE = re.compile(r"^(?:sumoffice/open/(?P<open>[^/]+)|wopi/files/(?P<file>[^/]+)(?P<contents>/contents)?)$")


def _b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text):
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _secret():
    from frappe.utils.password import get_encryption_key
    return ("sumoffice-wopi:" + get_encryption_key()).encode()


def make_token(user, file_name, can_write):
    payload = {"u": user, "f": file_name, "w": bool(can_write), "e": int(time.time()) + TOKEN_TTL}
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    return f"{body}.{_b64(hmac.new(_secret(), body.encode(), hashlib.sha256).digest())}", payload["e"]


def read_token(token, file_name):
    try:
        body, mac = token.split(".", 1)
        if not hmac.compare_digest(mac, _b64(hmac.new(_secret(), body.encode(), hashlib.sha256).digest())):
            return None
        payload = json.loads(_unb64(body))
    except (ValueError, TypeError):
        return None
    if payload.get("f") != file_name or payload.get("e", 0) < time.time():
        return None
    return payload


def _conf(key, default=None):
    return frappe.conf.get(key, default)


def discovery():
    url = _conf("sumoffice_discovery_url")
    if not url:
        return None
    cached = frappe.cache().get_value("sumoffice_discovery")
    if cached and cached.get("url") == url and time.time() - cached.get("at", 0) < DISCOVERY_TTL:
        return cached
    xml = requests.get(url, timeout=15, verify=_conf("sumoffice_ca_bundle") or True).content
    root = ElementTree.fromstring(xml)
    actions = {}
    for action in root.iter("action"):
        ext, name, src = action.get("ext"), action.get("name"), action.get("urlsrc")
        if ext and name and src:
            actions.setdefault(f"{ext.lower()}|{name}", re.sub(r"<[^>]*>", "", src))
    proof = root.find("proof-key")
    info = {"url": url, "at": time.time(), "actions": actions, "proof": dict(proof.attrib) if proof is not None else None}
    frappe.cache().set_value("sumoffice_discovery", info)
    return info


def _rsa(modulus, exponent):
    from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicNumbers
    return RSAPublicNumbers(int.from_bytes(base64.b64decode(exponent), "big"),
                            int.from_bytes(base64.b64decode(modulus), "big")).public_key()


def _verify(key, data, signature):
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding
    try:
        key.verify(base64.b64decode(signature), data, padding.PKCS1v15(), hashes.SHA256())
        return True
    except (InvalidSignature, ValueError):
        return False


def proof_ok(token):
    if not _conf("sumoffice_verify_proof", 1):
        return True
    keys = (discovery() or {}).get("proof")
    if not keys:
        return False
    headers = frappe.request.headers
    ticks, proof, proof_old = headers.get("X-WOPI-TimeStamp", ""), headers.get("X-WOPI-Proof", ""), headers.get("X-WOPI-ProofOld", "")
    if not ticks.isdigit() or not proof:
        return False
    if abs(time.time() - (int(ticks) - 621355968000000000) / 10_000_000) > PROOF_WINDOW:
        return False
    url = frappe.utils.get_url().rstrip("/") + frappe.request.full_path.rstrip("?")
    token_b, url_b = token.encode(), url.upper().encode()
    data = (struct.pack(">i", len(token_b)) + token_b + struct.pack(">i", len(url_b)) + url_b
            + struct.pack(">i", 8) + struct.pack(">q", int(ticks)))
    current = _rsa(keys["modulus"], keys["exponent"])
    if _verify(current, data, proof) or (proof_old and _verify(current, data, proof_old)):
        return True
    if keys.get("oldmodulus") and keys.get("oldexponent"):
        return _verify(_rsa(keys["oldmodulus"], keys["oldexponent"]), data, proof)
    return False


def _can_write(file_doc, user):
    if file_doc.attached_to_doctype and file_doc.attached_to_name:
        return frappe.has_permission(file_doc.attached_to_doctype, "write", file_doc.attached_to_name, user=user)
    return file_doc.owner == user or "System Manager" in frappe.get_roles(user)


def _read(file_doc):
    return file_doc.get_content()


def _write(file_doc, content):
    path = file_doc.get_full_path()
    with open(path, "wb") as fh:
        fh.write(content)
    file_doc.db_set({"file_size": len(content), "content_hash": hashlib.md5(content).hexdigest()}, update_modified=True)


def _lock_key(file_name):
    return f"sumoffice_lock|{file_name}"


def _lock(file_name):
    value = frappe.cache().get_value(_lock_key(file_name))
    if value and value.get("until", 0) > time.time():
        return value["id"]
    return None


def _set_lock(file_name, lock_id):
    if lock_id is None:
        frappe.cache().delete_value(_lock_key(file_name))
    else:
        frappe.cache().set_value(_lock_key(file_name), {"id": lock_id, "until": time.time() + LOCK_TTL}, expires_in_sec=LOCK_TTL)


def _reply(status=200, body=b"", headers=None, mimetype="application/octet-stream"):
    response = Response(body, status=status, mimetype=mimetype)
    for key, value in (headers or {}).items():
        response.headers[key] = value
    return response


class WopiRenderer(BaseRenderer):
    def can_render(self):
        self.match = ROUTE.match(self.path.strip("/"))
        return bool(self.match)

    def render(self):
        if self.match.group("open"):
            return self.open(self.match.group("open"))
        return self.wopi(self.match.group("file"), bool(self.match.group("contents")))

    # ---- the link ----------------------------------------------------------------

    def open(self, file_name):
        if frappe.session.user == "Guest":
            return _reply(302, headers={"Location": "/login?redirect-to=" + quote(frappe.request.full_path)})
        if not frappe.db.exists("File", file_name):
            return _reply(404, b"no such file", mimetype="text/plain")
        file_doc = frappe.get_doc("File", file_name)
        if not frappe.has_permission("File", "read", file_doc):
            return _reply(403, b"no access", mimetype="text/plain")
        ext = (file_doc.file_name or "").rsplit(".", 1)[-1].lower()
        if ext not in EXTENSIONS:
            return _reply(415, f"SumOffice does not open .{ext} files".encode(), mimetype="text/plain")
        info = discovery()
        if not info:
            return _reply(503, b"SumOffice is not configured: bench set-config sumoffice_discovery_url ...", mimetype="text/plain")
        can_write = _can_write(file_doc, frappe.session.user)
        action = info["actions"].get(f"{ext}|{'edit' if can_write else 'view'}") or info["actions"].get(f"{ext}|edit")
        if not action:
            return _reply(503, f"SumOffice discovery has no action for .{ext}".encode(), mimetype="text/plain")
        wopi_src = frappe.utils.get_url().rstrip("/") + "/wopi/files/" + quote(file_doc.name, safe="")
        sep = "" if action.endswith(("?", "&")) else ("&" if "?" in action else "?")
        target = f"{action}{sep}WOPISrc={quote(wopi_src, safe='')}"
        token, expires = make_token(frappe.session.user, file_doc.name, can_write)
        html = f"""<!doctype html><html><head><meta charset="utf-8"><title>{escape(file_doc.file_name)}</title>
<style>html,body{{margin:0;height:100%;overflow:hidden}}iframe{{border:0;width:100%;height:100%;display:block}}</style></head>
<body><form id="sumoffice" action="{escape(target)}" method="post" target="sumoffice_frame">
<input type="hidden" name="access_token" value="{escape(token)}"><input type="hidden" name="access_token_ttl" value="{expires * 1000}"></form>
<iframe name="sumoffice_frame" title="SumOffice" allow="clipboard-read; clipboard-write; fullscreen"></iframe>
<script>document.getElementById("sumoffice").submit();</script></body></html>"""
        return _reply(200, html.encode(), mimetype="text/html")

    # ---- WOPI --------------------------------------------------------------------

    def wopi(self, file_name, contents):
        token = frappe.request.args.get("access_token", "")
        payload = read_token(token, file_name)
        if not payload:
            return _reply(401)
        if not proof_ok(token):
            return _reply(500, b"proof")
        user = payload["u"]
        frappe.set_user(user)
        if not frappe.db.exists("File", file_name):
            return _reply(404)
        file_doc = frappe.get_doc("File", file_name)
        if not frappe.has_permission("File", "read", file_doc, user=user):
            return _reply(401)
        method = frappe.request.method
        can_write = payload["w"] and _can_write(file_doc, user)
        if contents and method == "GET":
            return _reply(200, _read(file_doc), {"X-WOPI-ItemVersion": file_doc.content_hash or ""})
        if contents and method == "POST":
            if frappe.request.headers.get("X-WOPI-Override") != "PUT":
                return _reply(400)
            if not can_write:
                return _reply(401)
            lock, sent = _lock(file_name), frappe.request.headers.get("X-WOPI-Lock", "")
            if lock and lock != sent:
                return _reply(409, headers={"X-WOPI-Lock": lock})
            if not lock and file_doc.file_size:
                return _reply(409, headers={"X-WOPI-Lock": ""})
            body = frappe.request.get_data()
            _write(file_doc, body)
            frappe.db.commit()
            return _reply(200, headers={"X-WOPI-ItemVersion": hashlib.md5(body).hexdigest()})
        if method == "GET":
            full = frappe.get_doc("User", user)
            info = {
                "BaseFileName": file_doc.file_name,
                "Size": file_doc.file_size or 0,
                "OwnerId": file_doc.owner,
                "UserId": user,
                "UserFriendlyName": full.full_name or user,
                "Version": file_doc.content_hash or str(file_doc.modified),
                "UserCanWrite": bool(can_write),
                "ReadOnly": not can_write,
                "UserCanNotWriteRelative": True,
                "SupportsLocks": True,
                "SupportsGetLock": True,
                "SupportsUpdate": True,
                "PostMessageOrigin": frappe.utils.get_url().rstrip("/"),
            }
            return _reply(200, json.dumps(info).encode(), mimetype="application/json")
        # POST without /contents: locks
        op, sent = frappe.request.headers.get("X-WOPI-Override", ""), frappe.request.headers.get("X-WOPI-Lock", "")
        lock = _lock(file_name)
        if op == "GET_LOCK":
            return _reply(200, headers={"X-WOPI-Lock": lock or ""})
        if op not in ("LOCK", "UNLOCK", "REFRESH_LOCK"):
            return _reply(501)
        if not can_write:
            return _reply(401)
        if op == "LOCK":
            if lock and lock not in (sent, frappe.request.headers.get("X-WOPI-OldLock")):
                return _reply(409, headers={"X-WOPI-Lock": lock})
            _set_lock(file_name, sent)
            return _reply(200)
        if not lock or lock != sent:
            return _reply(409, headers={"X-WOPI-Lock": lock or ""})
        _set_lock(file_name, None if op == "UNLOCK" else sent)
        return _reply(200)
