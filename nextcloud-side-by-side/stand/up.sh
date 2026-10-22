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
dc up -d nextcloud collabora
echo "waiting for Collabora and Nextcloud…"
i=0; until docker exec p29b-collabora-1 sh -c 'test -s /etc/coolwsd/proof_key' 2>/dev/null; do
  i=$((i+1)); [ $i -lt 90 ] || { echo "Collabora has no /etc/coolwsd/proof_key after 3 minutes" >&2; exit 1; }; sleep 2; done
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
occ config:app:set richdocuments wopi_callback_url --value http://nextcloud     # how editors call Nextcloud back
until curl -sf http://127.0.0.1:18293/hosting/discovery | grep -q sheets/wopi; do sleep 3; done
occ richdocuments:activate-config
echo "stand up: http://localhost:18280 (user admin, password in stand/nc-admin.env)"
