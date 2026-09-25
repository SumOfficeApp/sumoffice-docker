#!/usr/bin/env bash
# All of SumOffice in one container: SumSheet (manager + WOPI facade), SumDoc (manager), joint front on :8093.
set -e
: "${PUBLIC_URL:?set PUBLIC_URL to the address the browser uses, e.g. https://office.example.com}"
: "${NEXTCLOUD_HOST:?set NEXTCLOUD_HOST to the host name of your file storage}"
NEXTCLOUD_URL="${NEXTCLOUD_URL:-https://$NEXTCLOUD_HOST}"
mkdir -p /data/sumsheet /data/wopi /data/sumdoc /data/proof

# One WOPI proof key for both editors (a host that verifies signatures knows only the key in discovery).
if [ ! -f /data/proof/proof-key.pem ]; then
  node -e 'const {generateKeyPairSync}=require("crypto");const fs=require("fs");const k=generateKeyPairSync("rsa",{modulusLength:2048}).privateKey.export({type:"pkcs8",format:"pem"});fs.writeFileSync("/data/proof/proof-key.pem",k,{mode:0o600,flag:"wx"})' || true
fi
# SumDoc builds older than the shared key read their own store file: give it the same key.
node -e 'const fs=require("fs");const p=fs.readFileSync("/data/proof/proof-key.pem","utf8");fs.writeFileSync("/data/sumdoc/wopi-proof.json",JSON.stringify({current:{privatePem:p},old:{privatePem:p}}),{mode:0o600})'
export SUMOFFICE_WOPI_PROOF_DIR=/data/proof

cd /app
node apps/desktop-shell/webhost/cabin-manager.mjs --docs-dir /data/sumsheet --template /app/blank.xlsx --port 8095 \
  --base-path /f1 --max-cabins "${MAX_CABINS:-8}" --idle-min 15 \
  --auth-url http://127.0.0.1:8092/v1/me --attach-url 'http://127.0.0.1:8092/v1/attachments/{id}/content' &
sleep 3
node apps/desktop-shell/webhost/wopi-facade.mjs --port 8092 --manager http://127.0.0.1:8095 \
  --public-url "$PUBLIC_URL/f1" --state-dir /data/wopi --idle-min 30 --wopi-allow "$NEXTCLOUD_HOST" &

cd /opt/sumdoc
FASTDOC_CLI_BIN=/opt/sumdoc/release/runtime/native/fastdoc-cli \
node apps/fastdoc-shell/webhost/cabin-manager.mjs --docs-dir /data/sumdoc --template /opt/sumdoc/blank.docx --port 8090 \
  --base-path /a4 --max-cabins "${MAX_CABINS:-8}" --idle-min 15 --wopi-hosts "$NEXTCLOUD_URL" --public-url "$PUBLIC_URL/a4" &

node /opt/sumoffice/front.mjs &
# If any part dies, the container dies — the orchestrator restarts it whole.
wait -n
echo "a SumOffice process exited — stopping the container" >&2
exit 1
