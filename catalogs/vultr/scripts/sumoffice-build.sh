#!/bin/bash
# Build step on the Vultr build server: install the SumOffice VM appliance, install the per-instance
# provisioning script, then prepare the disk for a Marketplace snapshot with Vultr's own helper
# (clean_system: package updates, the "vultr" kernel option, keys, logs, history, machine-id, zeroed free space).
set -euo pipefail

# Vultr's helper functions, pinned to a reviewed commit of github.com/vultr/vultr-marketplace.
HELPER_URL="https://raw.githubusercontent.com/vultr/vultr-marketplace/95768fc9438ac0024be291d328beca5844181c88/helper-scripts/vultr-helper.sh"
HELPER_SHA256="1f0f4b53e64ef4e8af5fa7b3e7af98af56232475e8255d1d0439968a7e252ab3"
curl -fsSL -o /root/vultr-helper.sh "$HELPER_URL"
echo "${HELPER_SHA256}  /root/vultr-helper.sh" | sha256sum -c -
chmod +x /root/vultr-helper.sh
# shellcheck disable=SC1091
. /root/vultr-helper.sh
error_detect_on
install_cloud_init latest

bash /tmp/sumoffice-vm/sumoffice-install.sh

# Caddy serves 80/443; the stack itself listens on 127.0.0.1:8093 only.
if command -v ufw >/dev/null 2>&1; then
  ufw allow http
  ufw allow https
fi

mkdir -p /var/lib/cloud/scripts/per-instance
mv /root/sumoffice-per-instance.sh /var/lib/cloud/scripts/per-instance/sumoffice-per-instance.sh
chmod +x /var/lib/cloud/scripts/per-instance/sumoffice-per-instance.sh

rm -rf /tmp/sumoffice-vm
clean_system
