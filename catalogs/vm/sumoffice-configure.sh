#!/usr/bin/env bash
# SumOffice VM appliance — configure and (re)start the stack. Safe to run again at any time.
#
#   sumoffice-configure [--domain office.example.com | --public-url URL] [--jwt-secret SECRET] [--interactive]
#
# --domain         DNS name that points at this machine; Caddy then gets a Let's Encrypt certificate and the
#                  editors are published at https://<domain> (ports 80 and 443 must be reachable).
# --public-url     address the browser uses, when TLS is terminated elsewhere; Caddy then serves plain :80.
#                  Without both, http://<first IP of this machine> is used (enough for a first look, not for
#                  a Nextcloud served over https: browsers block an http frame inside an https page).
# --jwt-secret     shared secret entered in the connector; empty is allowed only on a closed test network.
# --interactive    ask for the values (used on first login).
#
# What it writes (per instance, never baked into an image):
#   /opt/sumoffice/nextcloud/.env            PUBLIC_URL and JWT_SECRET
#   /etc/caddy/Caddyfile                     :80/:443 -> 127.0.0.1:8093 (the stack's front)
#   /etc/sumoffice/sumoffice.env             the chosen values, read by the next run and by the login banner
set -euo pipefail

STACK=/opt/sumoffice/nextcloud
STATE=/etc/sumoffice/sumoffice.env

if [[ "$(id -u)" -ne 0 ]]; then echo "run as root" >&2; exit 1; fi
[[ -f "$STACK/docker-compose.yml" ]] || { echo "$STACK/docker-compose.yml not found; run sumoffice-install first" >&2; exit 1; }

SUMOFFICE_DOMAIN="" SUMOFFICE_PUBLIC_URL="" SUMOFFICE_JWT_SECRET=""
# shellcheck disable=SC1090
[[ -f "$STATE" ]] && . "$STATE"

domain="${SUMOFFICE_DOMAIN:-}" public_url="" jwt_secret="${SUMOFFICE_JWT_SECRET:-}"
[[ -z "$domain" ]] && public_url="${SUMOFFICE_PUBLIC_URL:-}"
interactive=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) domain="${2:?}"; public_url=""; shift 2 ;;
    --public-url) public_url="${2:?}"; domain=""; shift 2 ;;
    --jwt-secret) jwt_secret="${2-}"; shift 2 ;;
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
  read -r -s -p "Shared connector secret (empty only for a closed test network): " ans
  echo
  jwt_secret="${ans:-$jwt_secret}"
fi

domain="${domain#http://}"; domain="${domain#https://}"; domain="${domain%%/*}"
if [[ -n "$domain" ]]; then
  public_url="https://${domain}"
elif [[ -z "$public_url" ]]; then
  public_url="http://${ip}"
fi
public_url="${public_url%/}"
[[ "$public_url" =~ ^https?://[^/[:space:]]+$ ]] || { echo "not an origin (scheme://host[:port]): $public_url" >&2; exit 2; }

# 1. Stack settings.
umask 077
cat >"$STACK/.env" <<EOF
PUBLIC_URL=${public_url}
JWT_SECRET=${jwt_secret}
EOF
umask 022

# 2. Caddy in front of the stack (the stack itself listens on 127.0.0.1:8093 only).
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

# 3. Start.
cd "$STACK"
docker compose up -d --remove-orphans

cat >"$STATE" <<EOF
SUMOFFICE_DOMAIN=${domain}
SUMOFFICE_PUBLIC_URL=${public_url}
SUMOFFICE_JWT_SECRET=${jwt_secret}
EOF
chmod 0600 "$STATE"

# 4. Report what answers (non-fatal: the editors may need a few seconds on a small machine).
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null "http://127.0.0.1:8093/healthcheck" && break
  sleep 2
done
for p in /healthcheck /health /word/health /cell/health; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8093${p}" || true)"
  echo "  ${p} -> HTTP ${code}"
done
cat <<EOF

SumOffice is running at ${public_url}
In the connector, enter this server address and the same shared secret:
  ${public_url}
Change these values later: sumoffice-configure --interactive
EOF
