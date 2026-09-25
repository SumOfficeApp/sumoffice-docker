#!/bin/sh
# Build step: firewall required by the Marketplace image check. SSH is rate-limited; HTTP and HTTPS are open
# for Caddy (the stack itself listens on 127.0.0.1:8093 only, so Docker publishes nothing to the outside).
set -e

ufw limit ssh
ufw allow http
ufw allow https

ufw --force enable
