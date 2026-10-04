#!/bin/bash
# Build step: install the SumOffice VM appliance (Docker, Caddy, repository, images) on the build Droplet.
# The shared installer is uploaded by Packer from catalogs/vm/ to /tmp/sumoffice-vm/. Nothing per-instance
# is created here: the proof key, .env and containers are made on each new Droplet's first boot (001_onboot).
set -euo pipefail

bash /tmp/sumoffice-vm/sumoffice-install.sh

chmod +x /var/lib/cloud/scripts/per-instance/001_onboot
