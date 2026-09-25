#!/bin/bash
# SumOffice on Cloudron. Same process layout as aio/start.sh, with state in /app/data.
set -eu

DATA=/app/data

if [[ "$(id -u)" == "0" ]]; then
  mkdir -p "$DATA/sumsheet" "$DATA/wopi" "$DATA/sumdoc" "$DATA/proof" "$DATA/home"
  if [[ ! -f "$DATA/env.sh" ]]; then
    cat > "$DATA/env.sh" <<'EOF'
# SumOffice settings. Edit with the Cloudron File Manager or Web Terminal, then restart the app.
# Host name of the file storage (your Nextcloud) allowed to open files, without scheme:
export NEXTCLOUD_HOST=""
# Full origin of the same storage (default https://$NEXTCLOUD_HOST):
# export NEXTCLOUD_URL="https://cloud.example.com"
# Open documents per editor (about 250 MB RAM each):
export MAX_CABINS=8
EOF
  fi
  chown -R cloudron:cloudron "$DATA"
  exec /usr/local/bin/gosu cloudron:cloudron "$0" "$@"
fi

# shellcheck disable=SC1091
source "$DATA/env.sh"
export HOME="$DATA/home"
export PUBLIC_URL="${CLOUDRON_APP_ORIGIN:?}"
if [[ -z "${NEXTCLOUD_HOST:-}" ]]; then
  echo "NEXTCLOUD_HOST is not set in $DATA/env.sh: no WOPI host can open files until it is set." >&2
  NEXTCLOUD_HOST="localhost"
fi
NEXTCLOUD_URL="${NEXTCLOUD_URL:-https://$NEXTCLOUD_HOST}"
MAX_CABINS="${MAX_CABINS:-8}"

# One WOPI proof key for both editors (a host that verifies signatures knows only the key in discovery).
if [[ ! -f "$DATA/proof/proof-key.pem" ]]; then
  node -e 'const {generateKeyPairSync}=require("crypto");const fs=require("fs");const k=generateKeyPairSync("rsa",{modulusLength:2048}).privateKey.export({type:"pkcs8",format:"pem"});fs.writeFileSync(process.argv[1],k,{mode:0o600,flag:"wx"})' "$DATA/proof/proof-key.pem" || true
fi
# SumDoc builds older than the shared key read their own store file: give it the same key.
node -e 'const fs=require("fs");const p=fs.readFileSync(process.argv[1],"utf8");fs.writeFileSync(process.argv[2],JSON.stringify({current:{privatePem:p},old:{privatePem:p}}),{mode:0o600})' \
  "$DATA/proof/proof-key.pem" "$DATA/sumdoc/wopi-proof.json"
export SUMOFFICE_WOPI_PROOF_DIR="$DATA/proof"

cd /app/code/sumsheet
node apps/desktop-shell/webhost/cabin-manager.mjs --docs-dir "$DATA/sumsheet" --template /app/code/sumsheet/blank.xlsx --port 8095 \
  --base-path /f1 --max-cabins "$MAX_CABINS" --idle-min 15 \
  --auth-url http://127.0.0.1:8092/v1/me --attach-url 'http://127.0.0.1:8092/v1/attachments/{id}/content' &
sleep 3
node apps/desktop-shell/webhost/wopi-facade.mjs --port 8092 --manager http://127.0.0.1:8095 \
  --public-url "$PUBLIC_URL/f1" --state-dir "$DATA/wopi" --idle-min 30 --wopi-allow "$NEXTCLOUD_HOST" &

cd /app/code/sumdoc
FASTDOC_CLI_BIN=/app/code/sumdoc/release/runtime/native/fastdoc-cli \
node apps/fastdoc-shell/webhost/cabin-manager.mjs --docs-dir "$DATA/sumdoc" --template /app/code/sumdoc/blank.docx --port 8090 \
  --base-path /a4 --max-cabins "$MAX_CABINS" --idle-min 15 --wopi-hosts "$NEXTCLOUD_URL" --public-url "$PUBLIC_URL/a4" &

node /app/code/front.mjs &
# If any part dies, the app dies: Cloudron restarts it whole.
wait -n
echo "a SumOffice process exited, stopping the app" >&2
exit 1
