#!/bin/sh
# SumSheet for Nextcloud: the cabin manager plus the WOPI facade that speaks to Nextcloud.
set -e
mkdir -p /data/cabins /data/wopi
cd /app
node apps/desktop-shell/webhost/cabin-manager.mjs --docs-dir /data/cabins --template /app/blank.xlsx --port 8095 --base-path /f1 --max-cabins 8 --idle-min 15 \
  --auth-url http://127.0.0.1:8092/v1/me --attach-url 'http://127.0.0.1:8092/v1/attachments/{id}/content' &
sleep 3
exec node apps/desktop-shell/webhost/wopi-facade.mjs --port 8092 --manager http://127.0.0.1:8095 \
  --public-url "${PUBLIC_URL}/f1" --state-dir /data/wopi --idle-min 30 --wopi-allow "${NEXTCLOUD_HOST}"
