#!/bin/sh
# Give SumSheet the proof key of your Collabora. Run once, before `docker compose up -d`.
#
# WHY. Nextcloud Office (richdocuments; read in 9.2.3, WOPIMiddleware) verifies the X-WOPI-Proof signature of EVERY
# WOPI call whenever its discovery carries a <proof-key>, and rejects the call otherwise
# ("Invalid WOPI proof"). The routed discovery carries Collabora's key unchanged, so SumSheet
# has to sign with that very key. Collabora keeps it in /etc/coolwsd/proof_key.
#
# Usage:  ./take-collabora-proof-key.sh <collabora-container>        (Collabora in Docker here)
#         ./take-collabora-proof-key.sh --file /path/to/proof_key     (copied from the Collabora host)
# Collabora generates a new key only if the file is missing; keep /etc/coolwsd/proof_key on a
# volume (or mount this same file there) so an image update does not change it.
set -e
cd "$(dirname "$0")"
umask 077
if [ "$1" = "--file" ]; then src=$(cat "${2:?path to Collabora proof_key}")
else src=$(docker cp "${1:?Collabora container name}:/etc/coolwsd/proof_key" - 2>/dev/null | tar -xOf - 2>/dev/null || true); fi
# The collabora/code image has no shell (no `docker exec … cat`) and ships WITHOUT a proof key:
# then its discovery has no <proof-key>, Nextcloud Office checks no signatures and SumSheet's
# key is never looked at. SumSheet still needs a key file, so make a private one.
if [ -z "$src" ]; then
  echo "Collabora has no proof key: Nextcloud Office will not verify signatures. Using a key of SumSheet's own."
  echo "If you later give Collabora a key (coolwsd-generate-proof-key), run this script again."
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out proof-key.pem 2>/dev/null
else
  printf '%s\n' "$src" | openssl pkey -out proof-key.pem
  echo "proof-key.pem written: SumSheet signs with Collabora's key"
fi
chmod 600 proof-key.pem
