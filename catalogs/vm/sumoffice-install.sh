#!/usr/bin/env bash
# SumOffice VM appliance — install step (image build time or cloud-init).
#
# Installs Docker Engine + the Compose plugin + Caddy from the distribution's own repositories, clones this
# repository to /opt/sumoffice, pulls the four images of nextcloud/docker-compose.yml and installs the helper
# commands. It creates NO per-instance state (no proof key, no .env, no containers): that is the job of
# `sumoffice-configure`, run on first boot, so a snapshot made after this step is safe to share.
#
# Usage: sumoffice-install.sh [--no-pull]
# Environment: SUMOFFICE_REPO (default https://github.com/SumOfficeApp/sumoffice-docker), SUMOFFICE_REF (default main)
# Target: Ubuntu 24.04 LTS (x86-64). Other distributions lack `docker-compose-v2` or `caddy` under these names.
set -euo pipefail

SUMOFFICE_REPO="${SUMOFFICE_REPO:-https://github.com/SumOfficeApp/sumoffice-docker}"
SUMOFFICE_REF="${SUMOFFICE_REF:-main}"
PULL=1
[[ "${1:-}" == "--no-pull" ]] && PULL=0

if [[ "$(id -u)" -ne 0 ]]; then echo "run as root" >&2; exit 1; fi
case "$(uname -m)" in
  x86_64) ;;
  *) echo "SumOffice images are published for amd64 only today; this machine is $(uname -m)." >&2; exit 1 ;;
esac

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DEBIAN_FRONTEND=noninteractive

wait_apt() {
  while fuser /var/lib/dpkg/lock-frontend /var/lib/apt/lists/lock >/dev/null 2>&1; do sleep 3; done
}

wait_apt
apt-get -qy update
wait_apt
# docker.io + docker-compose-v2 + caddy are in Ubuntu's own archive (universe); no third-party repository needed.
apt-get -qy -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold install \
  ca-certificates curl git openssl psmisc docker.io docker-compose-v2 caddy
systemctl enable --now docker
# Caddy is configured by sumoffice-configure on first boot; keep it off until then.
systemctl disable --now caddy >/dev/null 2>&1 || true

if [[ ! -d /opt/sumoffice/.git ]]; then
  git clone --depth 1 --branch "$SUMOFFICE_REF" "$SUMOFFICE_REPO" /opt/sumoffice
fi

install -m 0755 "$here/sumoffice-configure.sh" /usr/local/sbin/sumoffice-configure
install -m 0755 "$here/sumoffice-first-login.sh" /usr/local/sbin/sumoffice-first-login
install -d -m 0755 /etc/sumoffice /var/lib/sumoffice
if [[ -d /etc/update-motd.d ]]; then
  install -m 0755 "$here/99-sumoffice" /etc/update-motd.d/99-sumoffice
fi

if [[ "$PULL" -eq 1 ]]; then
  # Pull only; no container and no volume is created here.
  (cd /opt/sumoffice/nextcloud && PUBLIC_URL=http://localhost NEXTCLOUD_URL=http://localhost NEXTCLOUD_HOST=localhost \
    docker compose pull --quiet)
fi

echo "SumOffice installed in /opt/sumoffice; run sumoffice-configure to start it."
