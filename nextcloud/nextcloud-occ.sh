#!/bin/sh
# Run on the Nextcloud host (adjust the occ path). Three settings, one activation.
# Usage: nextcloud-occ.sh https://office.example.com
OCC="${OCC:-php /var/www/html/occ}"; U="${1:?public address of the SumOffice stack}"
$OCC app:install richdocuments 2>/dev/null || $OCC app:enable richdocuments
$OCC config:app:set richdocuments wopi_url --value "$U"
$OCC config:app:set richdocuments public_wopi_url --value "$U"
$OCC richdocuments:activate-config
