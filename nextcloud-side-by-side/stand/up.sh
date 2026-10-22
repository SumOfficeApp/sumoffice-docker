#!/bin/sh
# Local demo stand for the side-by-side stack (compose project p29b, 127.0.0.1 only).
#   Nextcloud  http://localhost:18280   (admin password in stand/nc-admin.env, created on first run)
#   editors    http://localhost:18293   (front: Collabora + SumSheet under one origin)
# Stop: docker compose -p p29b stop        Start again: this script (idempotent).
set -e
cd "$(dirname "$0")/.."
[ -f stand/nc-admin.env ] || (umask 077; printf 'NEXTCLOUD_ADMIN_USER=admin\nNEXTCLOUD_ADMIN_PASSWORD=%s\n' "$(openssl rand -hex 12)" > stand/nc-admin.env)
dc() { docker compose -p p29b --env-file stand/stand.env -f docker-compose.yml -f stand/compose.stand.yml "$@"; }
occ() { docker exec -u www-data p29b-nextcloud-1 php occ "$@"; }
# Collabora's proof key, the way coolwsd-generate-proof-key makes it (PKCS#1 PEM).
# Readable by the container's user "cool": the stand's key protects nothing else.
[ -s stand/collabora-proof_key ] || { ssh-keygen -q -t rsa -b 2048 -N "" -m PEM -f stand/collabora-proof_key && rm -f stand/collabora-proof_key.pub && chmod 644 stand/collabora-proof_key; }
dc up -d nextcloud collabora
echo "waiting for Nextcloud…"
until occ status 2>/dev/null | grep -q 'installed: true'; do sleep 3; done
# SumSheet signs WOPI calls with Collabora's key (the one key in the routed discovery).
./take-collabora-proof-key.sh p29b-collabora-1
dc up -d
dc restart sumsheet >/dev/null   # pick up a key that changed with a recreated Collabora
occ app:disable firstrunwizard >/dev/null 2>&1 || true
occ app:list --enabled | grep -q richdocuments: || occ app:install richdocuments || occ app:enable richdocuments
occ config:system:set allow_local_remote_servers --type=boolean --value=true
occ config:app:set richdocuments wopi_url --value http://front:8093           # what Nextcloud fetches
occ config:app:set richdocuments public_wopi_url --value http://localhost:18293 # what the browser frames
until curl -sf http://127.0.0.1:18293/hosting/discovery | grep -q sheets/wopi; do sleep 3; done
# --callback-url: activate-config otherwise resets wopi_callback_url to "autodetect".
occ richdocuments:activate-config --callback-url=http://nextcloud
# Without a distributed cache (Redis) richdocuments keeps discovery in APCu, which the CLI does
# not share with Apache: the web process keeps the old discovery for up to an hour. Restart it.
docker restart p29b-nextcloud-1 >/dev/null
until curl -sf -o /dev/null http://127.0.0.1:18280/status.php; do sleep 2; done
echo "stand up: http://localhost:18280 (user admin, password in stand/nc-admin.env)"
