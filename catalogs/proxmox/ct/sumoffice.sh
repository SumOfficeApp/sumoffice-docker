#!/usr/bin/env bash
_CS_DEFAULT_URL="https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main"
_cs_boot="${COMMUNITY_SCRIPTS_CORE_DIR:-$(dirname "${BASH_SOURCE[0]}")/../../core}/core/build.func"
source "$_cs_boot" 2>/dev/null || source <(curl -fsSL "${COMMUNITY_SCRIPTS_CORE_URL:-https://raw.githubusercontent.com/community-scripts/core/main}/core/build.func")
# Copyright (c) 2021-2026 community-scripts ORG
# Author: SumOffice
# License: MIT | https://github.com/community-scripts/ProxmoxVE/raw/main/LICENSE
# Source: https://github.com/SumOfficeApp/sumoffice-docker

APP="SumOffice"
var_tags="${var_tags:-office;nextcloud;wopi}"
var_cpu="${var_cpu:-2}"
var_ram="${var_ram:-4096}"
var_disk="${var_disk:-12}"
var_os="${var_os:-debian}"
var_version="${var_version:-13}"
var_arm64="${var_arm64:-no}"
var_unprivileged="${var_unprivileged:-1}"

# Answered up front for unattended installs; the install script prompts only when they are unset.
export var_sumoffice_wopi_url="${var_sumoffice_wopi_url:-}"
export var_sumoffice_public_url="${var_sumoffice_public_url:-}"

header_info "$APP"
variables
color
catch_errors

function update_script() {
  header_info
  check_container_storage
  check_container_resources

  if [[ ! -f /opt/sumoffice/nextcloud/docker-compose.yml ]]; then
    msg_error "No ${APP} Installation Found!"
    exit
  fi

  msg_info "Updating ${APP}"
  cd /opt/sumoffice || exit
  $STD git pull --ff-only
  cd /opt/sumoffice/nextcloud || exit
  $STD docker compose pull
  $STD docker compose up -d --remove-orphans
  $STD docker image prune -f
  msg_ok "Updated ${APP}"
  msg_ok "Updated successfully!"
  exit
}

start
build_container
description

msg_ok "Completed successfully!\n"
echo -e "${CREATING}${GN}${APP} setup has been successfully initialized!${CL}"
echo -e "${INFO}${YW}WOPI discovery (put your TLS proxy in front of port 8093):${CL}"
echo -e "${GATEWAY}${BGN}http://${IP}:8093/hosting/discovery${CL}"
echo -e "${INFO}${YW}Settings: /opt/sumoffice/nextcloud/.env (then: cd /opt/sumoffice/nextcloud && docker compose up -d)${CL}"
