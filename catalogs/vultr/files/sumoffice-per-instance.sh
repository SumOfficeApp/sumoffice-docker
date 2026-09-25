#!/bin/bash
# Runs once-and-only-once at the first boot of every server deployed from the SumOffice snapshot
# (/var/lib/cloud/scripts/per-instance/). Starts the stack on plain http://<server IP> with a placeholder
# Nextcloud; the DNS name and the Nextcloud address are asked on the first root login.
set -uo pipefail

echo "$(date -u) : SumOffice provisioning started." >>/var/log/per-instance.log

# Vultr asks to keep SSH closed while provisioning runs. Remember what was active (socket or service).
ssh_units=()
for u in ssh.socket ssh.service; do systemctl is-active --quiet "$u" && ssh_units+=("$u"); done
[[ ${#ssh_units[@]} -gt 0 ]] || ssh_units=(ssh.service)
systemctl stop ssh.socket ssh.service 2>/dev/null || true

ip="$(curl -fsS --retry 10 --retry-connrefused --max-time 2 -H 'METADATA-TOKEN: vultr' \
  http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)"
[[ -n "$ip" ]] || ip="$(hostname -I | awk '{print $1}')"

if ! /usr/local/sbin/sumoffice-configure --public-url "http://${ip}" >/var/log/sumoffice-firstboot.log 2>&1; then
  echo "$(date -u) : sumoffice-configure failed, see /var/log/sumoffice-firstboot.log" >>/var/log/per-instance.log
fi

if ! grep -q 'sumoffice-first-login' /root/.bashrc 2>/dev/null; then
  echo '/usr/local/sbin/sumoffice-first-login' >>/root/.bashrc
fi

systemctl start "${ssh_units[@]}"
echo "$(date -u) : SumOffice provisioning complete." >>/var/log/per-instance.log
