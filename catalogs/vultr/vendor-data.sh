#!/bin/bash
# SumOffice — Vultr Marketplace "Build App Image From Vendor Data" (imageless app).
# Paste this script into Marketplace -> the app -> Builds -> Vendor Data, with "Ubuntu 24.04 LTS x64" as the
# operating system. It runs once on the customer's fresh server: installs Docker, Caddy and the stack, starts
# it on http://<server IP>, and asks for the DNS name and the Nextcloud address on the first root login.
#
# SUMOFFICE_REF must name a branch or tag of github.com/SumOfficeApp/sumoffice-docker that contains catalogs/vm/.
set -euo pipefail

SUMOFFICE_REPO="https://github.com/SumOfficeApp/sumoffice-docker"
SUMOFFICE_REF="main"

exec >>/var/log/sumoffice-vendor-data.log 2>&1
echo "$(date -u) : SumOffice provisioning started."

# Vultr asks to keep SSH closed while provisioning runs. Remember what was active (socket or service).
ssh_units=()
for u in ssh.socket ssh.service; do systemctl is-active --quiet "$u" && ssh_units+=("$u"); done
[[ ${#ssh_units[@]} -gt 0 ]] || ssh_units=(ssh.service)
reopen_ssh() { systemctl start "${ssh_units[@]}" || true; }
trap reopen_ssh EXIT
systemctl stop ssh.socket ssh.service 2>/dev/null || true

export DEBIAN_FRONTEND=noninteractive
while fuser /var/lib/dpkg/lock-frontend /var/lib/apt/lists/lock >/dev/null 2>&1; do sleep 3; done
apt-get -qy update
apt-get -qy install git ca-certificates curl

git clone --depth 1 --branch "$SUMOFFICE_REF" "$SUMOFFICE_REPO" /opt/sumoffice
SUMOFFICE_REPO="$SUMOFFICE_REPO" SUMOFFICE_REF="$SUMOFFICE_REF" bash /opt/sumoffice/catalogs/vm/sumoffice-install.sh

if command -v ufw >/dev/null 2>&1; then
  ufw allow http
  ufw allow https
fi

ip="$(curl -fsS --retry 10 --retry-connrefused --max-time 2 -H 'METADATA-TOKEN: vultr' \
  http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)"
[[ -n "$ip" ]] || ip="$(hostname -I | awk '{print $1}')"
/usr/local/sbin/sumoffice-configure --public-url "http://${ip}"

if ! grep -q 'sumoffice-first-login' /root/.bashrc 2>/dev/null; then
  echo '/usr/local/sbin/sumoffice-first-login' >>/root/.bashrc
fi

echo "$(date -u) : SumOffice provisioning complete."
