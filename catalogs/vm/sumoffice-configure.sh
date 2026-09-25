#!/usr/bin/env bash
# SumOffice VM appliance — configure and (re)start the stack. Safe to run again at any time.
#
#   sumoffice-configure [--domain office.example.com | --public-url URL] [--nextcloud-url URL] [--interactive]
#
# --domain         DNS name that points at this machine; Caddy then gets a Let's Encrypt certificate and the
#                  editors are published at https://<domain> (ports 80 and 443 must be reachable).
# --public-url     address the browser uses, when TLS is terminated elsewhere; Caddy then serves plain :80.
#                  Without both, http://<first IP of this machine> is used (enough for a first look, not for
#                  a Nextcloud served over https: browsers block an http frame inside an https page).
# --nextcloud-url  the Nextcloud your users open (WOPI host allowed to open files); default keeps the last value.
# --interactive    ask for the values (used on first login).
#
# What it writes (per instance, never baked into an image):
#   /var/lib/sumoffice/proof/proof-key.pem   one WOPI proof key shared by both editors (created once)
#   /opt/sumoffice/nextcloud/.env            PUBLIC_URL, NEXTCLOUD_URL, NEXTCLOUD_HOST
#   /opt/sumoffice/nextcloud/docker-compose.override.yml   mounts the proof key into both editors
#   /etc/caddy/Caddyfile                     :80/:443 -> 127.0.0.1:8093 (the stack's front)
#   /etc/sumoffice/sumoffice.env             the chosen values, read by the next run and by the login banner
set -euo pipefail

STACK=/opt/sumoffice/nextcloud
STATE=/etc/sumoffice/sumoffice.env
PROOF_DIR=/var/lib/sumoffice/proof

if [[ "$(id -u)" -ne 0 ]]; then echo "run as root" >&2; exit 1; fi
[[ -f "$STACK/docker-compose.yml" ]] || { echo "$STACK/docker-compose.yml not found; run sumoffice-install first" >&2; exit 1; }

SUMOFFICE_DOMAIN="" SUMOFFICE_PUBLIC_URL="" SUMOFFICE_NEXTCLOUD_URL=""
# shellcheck disable=SC1090
[[ -f "$STATE" ]] && . "$STATE"

domain="${SUMOFFICE_DOMAIN:-}" public_url="" nextcloud_url="${SUMOFFICE_NEXTCLOUD_URL:-https://cloud.example.com}"
[[ -z "$domain" ]] && public_url="${SUMOFFICE_PUBLIC_URL:-}"
interactive=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) domain="${2:?}"; public_url=""; shift 2 ;;
    --public-url) public_url="${2:?}"; domain=""; shift 2 ;;
    --nextcloud-url) nextcloud_url="${2:?}"; shift 2 ;;
    --interactive) interactive=1; shift ;;
    -h|--help) sed -n '2,21p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

ip="$(hostname -I | awk '{print $1}')"

if [[ "$interactive" -eq 1 ]]; then
  echo
  echo "SumOffice setup. Press Enter to keep the value in brackets."
  read -r -p "DNS name for the editors, pointing at ${ip} (- = none, plain http://${ip}) [${domain}]: " ans
  domain="${ans:-$domain}"
  [[ "$domain" == "-" ]] && domain=""
  read -r -p "Nextcloud address your users open [${nextcloud_url}]: " ans
  nextcloud_url="${ans:-$nextcloud_url}"
fi

domain="${domain#http://}"; domain="${domain#https://}"; domain="${domain%%/*}"
if [[ -n "$domain" ]]; then
  public_url="https://${domain}"
elif [[ -z "$public_url" ]]; then
  public_url="http://${ip}"
fi
public_url="${public_url%/}"; nextcloud_url="${nextcloud_url%/}"
for u in "$public_url" "$nextcloud_url"; do
  [[ "$u" =~ ^https?://[^/[:space:]]+$ ]] || { echo "not an origin (scheme://host[:port]): $u" >&2; exit 2; }
done
nextcloud_host="${nextcloud_url#*://}"   # host[:port], as nextcloud/env.example and the Proxmox script use it

# 1. One WOPI proof key for both editors: a WOPI host that verifies signatures knows only the key in discovery.
install -d -m 0755 "$PROOF_DIR"
if [[ ! -s "$PROOF_DIR/proof-key.pem" ]]; then
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$PROOF_DIR/proof-key.pem" 2>/dev/null
fi
# Readable by the (non-root, image-defined) user inside the editor containers; the machine is single-purpose.
chmod 0644 "$PROOF_DIR/proof-key.pem"

# 2. Stack settings.
umask 077
cat >"$STACK/.env" <<EOF
PUBLIC_URL=${public_url}
NEXTCLOUD_URL=${nextcloud_url}
NEXTCLOUD_HOST=${nextcloud_host}
EOF
cat >"$STACK/docker-compose.override.yml" <<EOF
# Written by sumoffice-configure: share one WOPI proof key between both editors.
services:
  sumsheet:
    environment:
      SUMOFFICE_WOPI_PROOF_DIR: /data/proof
    volumes:
      - ${PROOF_DIR}:/data/proof:ro
  sumdoc:
    environment:
      SUMOFFICE_WOPI_PROOF_DIR: /data/proof
    volumes:
      - ${PROOF_DIR}:/data/proof:ro
EOF
umask 022

# 3. Caddy in front of the stack (the stack itself listens on 127.0.0.1:8093 only).
if [[ -n "$domain" ]]; then
  site="$domain"
else
  site=":80"
fi
cat >/etc/caddy/Caddyfile <<EOF
# Written by sumoffice-configure. WebSocket upgrades are proxied by default.
${site} {
	reverse_proxy 127.0.0.1:8093
}
EOF
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl enable caddy >/dev/null 2>&1
systemctl restart caddy

# 4. Start. SumDoc builds older than the shared key read <docs-dir>/wopi-proof.json: give them the same key.
cd "$STACK"
docker compose run --rm --no-deps --entrypoint node sumdoc -e \
  'const fs=require("fs");const p=fs.readFileSync("/data/proof/proof-key.pem","utf8");fs.writeFileSync("/data/cabins/wopi-proof.json",JSON.stringify({current:{privatePem:p},old:{privatePem:p}}),{mode:0o600})'
docker compose up -d --remove-orphans

cat >"$STATE" <<EOF
SUMOFFICE_DOMAIN=${domain}
SUMOFFICE_PUBLIC_URL=${public_url}
SUMOFFICE_NEXTCLOUD_URL=${nextcloud_url}
EOF
chmod 0644 "$STATE"

# 5. Report what answers (non-fatal: the editors may need a few seconds on a small machine).
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null "http://127.0.0.1:8093/hosting/discovery" && break
  sleep 2
done
for p in /hosting/discovery /f1/health /a4/health; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8093${p}" || true)"
  echo "  ${p} -> HTTP ${code}"
done
cat <<EOF

SumOffice is running at ${public_url}
Allowed Nextcloud: ${nextcloud_url}

On the Nextcloud host, point Nextcloud Office at this address:
  sh nextcloud-occ.sh ${public_url}
  (script: /opt/sumoffice/nextcloud/nextcloud-occ.sh, or https://github.com/SumOfficeApp/sumoffice-docker)
Change these values later: sumoffice-configure --interactive
EOF
