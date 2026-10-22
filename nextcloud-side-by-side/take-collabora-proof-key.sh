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
else src=$(docker exec "${1:?Collabora container name}" cat /etc/coolwsd/proof_key); fi
printf '%s\n' "$src" | openssl pkey -out proof-key.pem
chmod 600 proof-key.pem
echo "proof-key.pem written: SumSheet signs with Collabora's key"
