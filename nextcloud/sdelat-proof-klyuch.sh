#!/bin/sh
# One signing key for both editors. Run once, before `docker compose up -d`.
#
# WHY. A host that verifies WOPI signatures — Odoo by default, SharePoint always —
# takes the public key out of the shared /hosting/discovery and checks every call
# against it. But that discovery is merged from two editors and can carry only one
# key. If SumSheet and SumDoc have different keys, half the calls fail the check:
# Odoo answers "WOPI proof rejected" and the file never opens.
#
# Each editor keeps its key in its own place and its own shape, so we hand both of
# them the same private key, as two files.
set -e
cd "$(dirname "$0")"
if [ -f proof-key.pem ] && [ -f wopi-proof.json ]; then
  echo "key already present: proof-key.pem and wopi-proof.json"; exit 0
fi
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out proof-key.pem 2>/dev/null
chmod 600 proof-key.pem
python3 - <<'PY'
import json
pem = open('proof-key.pem').read()
json.dump({"current": {"privatePem": pem}, "old": None}, open('wopi-proof.json', 'w'))
PY
chmod 600 wopi-proof.json
echo "key created: proof-key.pem (SumSheet) and wopi-proof.json (SumDoc) — the same one"
