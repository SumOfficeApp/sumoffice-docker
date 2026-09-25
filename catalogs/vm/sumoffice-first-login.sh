#!/usr/bin/env bash
# SumOffice VM appliance — runs once, on the first interactive root login (hooked into /root/.bashrc by the
# first-boot script). Asks for the DNS name and the Nextcloud address, then restores the default .bashrc
# so it does not run again. Re-run any time with: sumoffice-configure --interactive
set -uo pipefail

# Only for an interactive terminal (scp/sftp sessions must not block on a prompt).
[[ -t 0 && -t 1 ]] || exit 0

echo
echo "Welcome to SumOffice (SumSheet + SumDoc for Nextcloud)."
if ! sumoffice-configure --interactive; then
  echo "Setup did not finish; run 'sumoffice-configure --interactive' again." >&2
fi

cp -f /etc/skel/.bashrc /root/.bashrc
