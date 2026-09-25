#!/usr/bin/env bash

# Copyright (c) 2021-2026 community-scripts ORG
# Author: SumOffice
# License: MIT | https://github.com/community-scripts/ProxmoxVE/raw/main/LICENSE
# Source: https://github.com/SumOfficeApp/sumoffice-docker

source /dev/stdin <<<"$FUNCTIONS_FILE_PATH"
color
verb_ip6
catch_errors
setting_up_container
network_check
update_os

msg_info "Installing Dependencies"
$STD apt install -y git openssl ca-certificates
msg_ok "Installed Dependencies"

setup_docker

if [[ -z "${var_sumoffice_wopi_url:-}" ]]; then
  read -r -p "${TAB3}Nextcloud address (e.g. https://cloud.example.com): " var_sumoffice_wopi_url
fi
var_sumoffice_wopi_url="${var_sumoffice_wopi_url:-https://cloud.example.com}"
var_sumoffice_wopi_url="${var_sumoffice_wopi_url%/}"
local_ip="$(hostname -I | awk '{print $1}')"
if [[ -z "${var_sumoffice_public_url:-}" ]]; then
  read -r -p "${TAB3}Public address of the editors [http://${local_ip}:8093]: " var_sumoffice_public_url
fi
var_sumoffice_public_url="${var_sumoffice_public_url:-http://${local_ip}:8093}"
var_sumoffice_public_url="${var_sumoffice_public_url%/}"
wopi_host="${var_sumoffice_wopi_url#*://}"
wopi_host="${wopi_host%%/*}"

msg_info "Setting up SumOffice"
$STD git clone --depth 1 https://github.com/SumOfficeApp/sumoffice-docker /opt/sumoffice
cat <<EOF >/opt/sumoffice/nextcloud/.env
PUBLIC_URL=${var_sumoffice_public_url}
NEXTCLOUD_URL=${var_sumoffice_wopi_url}
NEXTCLOUD_HOST=${wopi_host}
EOF

# One WOPI proof key for both editors: a WOPI host that verifies signatures knows only the key in discovery.
mkdir -p /opt/sumoffice/data/proof
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out /opt/sumoffice/data/proof/proof-key.pem 2>/dev/null
# Readable by the (unknown) user inside the editor containers; the LXC itself is single-purpose.
chmod 0644 /opt/sumoffice/data/proof/proof-key.pem

# Local additions to the upstream compose file: listen on the LXC address, share the proof key.
cat <<'EOF' >/opt/sumoffice/nextcloud/docker-compose.override.yml
services:
  sumsheet:
    environment:
      SUMOFFICE_WOPI_PROOF_DIR: /data/proof
    volumes:
      - /opt/sumoffice/data/proof:/data/proof:ro
  sumdoc:
    environment:
      SUMOFFICE_WOPI_PROOF_DIR: /data/proof
    volumes:
      - /opt/sumoffice/data/proof:/data/proof:ro
  front:
    ports: !override
      - "8093:8093"
EOF
cd /opt/sumoffice/nextcloud || exit
$STD docker compose pull
# SumDoc builds older than the shared key read <docs-dir>/wopi-proof.json: give them the same key.
$STD docker compose run --rm --no-deps --entrypoint node sumdoc -e \
  'const fs=require("fs");const p=fs.readFileSync("/data/proof/proof-key.pem","utf8");fs.writeFileSync("/data/cabins/wopi-proof.json",JSON.stringify({current:{privatePem:p},old:{privatePem:p}}),{mode:0o600})'
$STD docker compose up -d
msg_ok "Set up SumOffice"

motd_ssh
customize
cleanup_lxc
