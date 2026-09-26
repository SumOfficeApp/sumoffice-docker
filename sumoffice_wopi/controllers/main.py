"""WOPI host for Odoo attachments.

Odoo is the storage (WOPI host); SumOffice is the editor (WOPI client). The flow:

1. A person clicks "Open in SumOffice" on an attachment. ``/sumoffice/open/<id>``
   checks their Odoo rights, mints a short-lived access token and posts it to the
   editor action URL taken from SumOffice's discovery.
2. The editor calls back ``/wopi/files/<id>`` (CheckFileInfo, locks) and
   ``/wopi/files/<id>/contents`` (GetFile, PutFile) with that token.

Every callback runs as the person who opened the file, so Odoo record rules and
attachment access checks apply as usual. Nothing is ever done as superuser on
their behalf except reading and writing the lock table.
"""

import base64
import hashlib
import hmac
import json
import logging
import re
import struct
import time
from datetime import timedelta
from html import escape
from urllib.parse import quote
from xml.etree import ElementTree

import requests

from odoo import fields, http
from odoo.exceptions import AccessError
from odoo.http import request

_logger = logging.getLogger(__name__)

EXTENSIONS = ("xlsx", "xlsm", "xlsb", "docx")
TOKEN_TTL = 10 * 3600          # seconds; the editor refreshes the page long before
LOCK_TTL = timedelta(minutes=30)  # MS-WOPI: a lock expires after 30 minutes
PROOF_WINDOW = 20 * 60          # seconds; MS-WOPI allows 20 minutes of clock skew
DISCOVERY_TTL = 3600
_discovery_cache = {"url": None, "at": 0, "actions": {}, "proof": None}


# ---- access token ------------------------------------------------------------

def _b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text):
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _secret(env):
    return env["ir.config_parameter"].sudo().get_param("database.secret").encode()


def make_token(env, uid, attachment_id, can_write):
    payload = {"u": uid, "a": attachment_id, "w": bool(can_write), "e": int(time.time()) + TOKEN_TTL}
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    mac = _b64(hmac.new(_secret(env), body.encode(), hashlib.sha256).digest())
    return f"{body}.{mac}", payload["e"]


def read_token(env, token, attachment_id):
    try:
        body, mac = token.split(".", 1)
        want = _b64(hmac.new(_secret(env), body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(mac, want):
            return None
        payload = json.loads(_unb64(body))
    except (ValueError, TypeError):
        return None
    if payload.get("a") != attachment_id or payload.get("e", 0) < time.time():
        return None
    return payload


# ---- discovery and proof keys --------------------------------------------------

def _config(env, key, default=None):
    return env["ir.config_parameter"].sudo().get_param(key, default)


def discovery(env):
    url = _config(env, "sumoffice.discovery_url")
    if not url:
        return None
    cache = _discovery_cache
    if cache["url"] == url and time.time() - cache["at"] < DISCOVERY_TTL:
        return cache
    verify = _config(env, "sumoffice.ca_bundle") or True
    xml = requests.get(url, timeout=15, verify=verify).content
    root = ElementTree.fromstring(xml)
    actions = {}
    for action in root.iter("action"):
        ext, name, src = action.get("ext"), action.get("name"), action.get("urlsrc")
        if ext and name and src:
            # Placeholders like <ui=UI_LLCC&> are optional parameters; drop them.
            actions.setdefault((ext.lower(), name), re.sub(r"<[^>]*>", "", src))
    proof = root.find("proof-key")
    cache.update(url=url, at=time.time(), actions=actions,
                 proof=dict(proof.attrib) if proof is not None else None)
    return cache


def _rsa_key(modulus_b64, exponent_b64):
    from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicNumbers
    n = int.from_bytes(base64.b64decode(modulus_b64), "big")
    e = int.from_bytes(base64.b64decode(exponent_b64), "big")
    return RSAPublicNumbers(e, n).public_key()


def _signed_bytes(token, url, ticks):
    token_b = token.encode()
    url_b = url.upper().encode()
    return (struct.pack(">i", len(token_b)) + token_b
            + struct.pack(">i", len(url_b)) + url_b
            + struct.pack(">i", 8) + struct.pack(">q", ticks))


def _verify(key, data, signature_b64):
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding
    try:
        key.verify(base64.b64decode(signature_b64), data, padding.PKCS1v15(), hashes.SHA256())
        return True
    except (InvalidSignature, ValueError):
        return False


def proof_ok(env, token):
    """MS-WOPI proof check: the call was signed by the editor named in discovery."""
    if _config(env, "sumoffice.verify_proof", "True") in ("False", "0", ""):
        return True
    info = discovery(env)
    keys = (info or {}).get("proof")
    if not keys:
        _logger.warning("SumOffice: discovery has no proof-key, refusing WOPI call")
        return False
    headers = request.httprequest.headers
    ticks = headers.get("X-WOPI-TimeStamp", "")
    proof, proof_old = headers.get("X-WOPI-Proof", ""), headers.get("X-WOPI-ProofOld", "")
    if not ticks.isdigit() or not proof:
        return False
    # .NET ticks: 100 ns since 0001-01-01.
    sent = (int(ticks) - 621355968000000000) / 10_000_000
    if abs(time.time() - sent) > PROOF_WINDOW:
        return False
    base = _config(env, "web.base.url", "").rstrip("/")
    url = base + request.httprequest.full_path.rstrip("?")
    data = _signed_bytes(token, url, int(ticks))
    current = _rsa_key(keys["modulus"], keys["exponent"])
    if _verify(current, data, proof) or (proof_old and _verify(current, data, proof_old)):
        return True
    if keys.get("oldmodulus") and keys.get("oldexponent"):
        return _verify(_rsa_key(keys["oldmodulus"], keys["oldexponent"]), data, proof)
    return False


# ---- helpers ------------------------------------------------------------------

def _can_write(attachment):
    try:
        attachment.check("write")
        return True
    except AccessError:
        return False


def _version(attachment):
    return attachment.checksum or str(fields.Datetime.to_string(attachment.write_date))


def _live_lock(env, attachment_id):
    lock = env["sumoffice.lock"].sudo().search([("attachment_id", "=", attachment_id)], limit=1)
    if lock and lock.expires_at < fields.Datetime.now():
        lock.unlink()
        return env["sumoffice.lock"]
    return lock


def _reply(status=200, body=b"", headers=None, mimetype="application/octet-stream"):
    return request.make_response(body, headers=[("Content-Type", mimetype), *(headers or {}).items()], status=status)


class SumofficeWopi(http.Controller):

    # ---- the button ----------------------------------------------------------

    @http.route("/sumoffice/open/<int:attachment_id>", type="http", auth="user")
    def open(self, attachment_id, **_kw):
        env = request.env
        attachment = env["ir.attachment"].browse(attachment_id).exists()
        if not attachment:
            return request.not_found()
        attachment.check("read")
        ext = (attachment.name or "").rsplit(".", 1)[-1].lower()
        if ext not in EXTENSIONS:
            return _reply(415, f"SumOffice does not open .{ext} files".encode(), mimetype="text/plain")
        info = discovery(env)
        if not info:
            return _reply(503, b"SumOffice is not configured: Settings > SumOffice > Discovery URL", mimetype="text/plain")
        can_write = _can_write(attachment)
        action = info["actions"].get((ext, "edit" if can_write else "view")) or info["actions"].get((ext, "edit"))
        if not action:
            return _reply(503, f"SumOffice discovery has no action for .{ext}".encode(), mimetype="text/plain")
        base = _config(env, "web.base.url", "").rstrip("/")
        wopi_src = f"{base}/wopi/files/{attachment.id}"
        target = action + ("" if action.endswith(("?", "&")) else ("&" if "?" in action else "?")) + "WOPISrc=" + quote(wopi_src, safe="")
        token, expires = make_token(env, env.uid, attachment.id, can_write)
        html = f"""<!doctype html><html><head><meta charset="utf-8"><title>{escape(attachment.name)}</title>
<style>html,body{{margin:0;height:100%;overflow:hidden}}iframe{{border:0;width:100%;height:100%;display:block}}</style></head>
<body><form id="sumoffice" action="{escape(target)}" method="post" target="sumoffice_frame">
<input type="hidden" name="access_token" value="{escape(token)}"><input type="hidden" name="access_token_ttl" value="{expires * 1000}"></form>
<iframe name="sumoffice_frame" title="SumOffice" allow="clipboard-read; clipboard-write; fullscreen"></iframe>
<script>document.getElementById("sumoffice").submit();</script></body></html>"""
        return _reply(200, html.encode(), mimetype="text/html; charset=utf-8")

    # ---- WOPI --------------------------------------------------------------------

    def _enter(self, attachment_id):
        """Validate token and proof, switch to the token's user. Returns (payload, attachment) or a response."""
        token = request.params.get("access_token", "")
        payload = read_token(request.env, token, attachment_id)
        if not payload:
            return None, _reply(401)
        if not proof_ok(request.env, token):
            _logger.warning("SumOffice: WOPI proof rejected for attachment %s", attachment_id)
            return None, _reply(500, b"proof")
        request.update_env(user=payload["u"])
        attachment = request.env["ir.attachment"].browse(attachment_id).exists()
        if not attachment:
            return None, _reply(404)
        try:
            attachment.check("read")
        except AccessError:
            return None, _reply(401)
        return payload, attachment

    @http.route("/wopi/files/<int:attachment_id>", type="http", auth="none", methods=["GET"], csrf=False, save_session=False)
    def check_file_info(self, attachment_id, **_kw):
        payload, attachment = self._enter(attachment_id)
        if payload is None:
            return attachment
        user = request.env.user
        can_write = payload["w"] and _can_write(attachment)
        base = _config(request.env, "web.base.url", "").rstrip("/")
        info = {
            "BaseFileName": attachment.name,
            "Size": attachment.file_size,
            "OwnerId": str(attachment.create_uid.id),
            "UserId": str(user.id),
            "UserFriendlyName": user.name,
            "Version": _version(attachment),
            "LastModifiedTime": attachment.write_date.strftime("%Y-%m-%dT%H:%M:%S.0000000Z"),
            "UserCanWrite": can_write,
            "ReadOnly": not can_write,
            "UserCanNotWriteRelative": True,
            "SupportsLocks": True,
            "SupportsGetLock": True,
            "SupportsUpdate": True,
            "PostMessageOrigin": base,
        }
        return _reply(200, json.dumps(info).encode(), mimetype="application/json")

    @http.route("/wopi/files/<int:attachment_id>/contents", type="http", auth="none", methods=["GET", "POST"], csrf=False, save_session=False)
    def contents(self, attachment_id, **_kw):
        payload, attachment = self._enter(attachment_id)
        if payload is None:
            return attachment
        if request.httprequest.method == "GET":
            return _reply(200, attachment.raw or b"", {"X-WOPI-ItemVersion": _version(attachment)})
        if request.httprequest.headers.get("X-WOPI-Override", "") != "PUT":
            return _reply(400)
        if not (payload["w"] and _can_write(attachment)):
            return _reply(401)
        body = request.httprequest.get_data()
        lock = _live_lock(request.env, attachment.id)
        sent = request.httprequest.headers.get("X-WOPI-Lock", "")
        if lock and lock.lock_id != sent:
            return _reply(409, headers={"X-WOPI-Lock": lock.lock_id})
        if not lock and attachment.file_size:
            # MS-WOPI: an unlocked, non-empty file is only written under a lock.
            return _reply(409, headers={"X-WOPI-Lock": ""})
        attachment.write({"raw": body})
        return _reply(200, headers={"X-WOPI-ItemVersion": _version(attachment)})

    @http.route("/wopi/files/<int:attachment_id>", type="http", auth="none", methods=["POST"], csrf=False, save_session=False)
    def locks(self, attachment_id, **_kw):
        payload, attachment = self._enter(attachment_id)
        if payload is None:
            return attachment
        headers = request.httprequest.headers
        op, sent = headers.get("X-WOPI-Override", ""), headers.get("X-WOPI-Lock", "")
        locks = request.env["sumoffice.lock"].sudo()
        lock = _live_lock(request.env, attachment.id)
        until = fields.Datetime.now() + LOCK_TTL
        if op == "GET_LOCK":
            return _reply(200, headers={"X-WOPI-Lock": lock.lock_id if lock else ""})
        if op in ("LOCK", "REFRESH_LOCK", "UNLOCK") and not (payload["w"] and _can_write(attachment)):
            return _reply(401)
        if op == "LOCK":
            old = headers.get("X-WOPI-OldLock")
            if lock and lock.lock_id not in (sent, old):
                return _reply(409, headers={"X-WOPI-Lock": lock.lock_id})
            if lock:
                lock.write({"lock_id": sent, "expires_at": until})
            else:
                locks.create({"attachment_id": attachment.id, "lock_id": sent, "expires_at": until})
            return _reply(200, headers={"X-WOPI-ItemVersion": _version(attachment)})
        if op in ("REFRESH_LOCK", "UNLOCK"):
            if not lock or lock.lock_id != sent:
                return _reply(409, headers={"X-WOPI-Lock": lock.lock_id if lock else ""})
            if op == "UNLOCK":
                lock.unlink()
            else:
                lock.write({"expires_at": until})
            return _reply(200, headers={"X-WOPI-ItemVersion": _version(attachment)})
        return _reply(501)
