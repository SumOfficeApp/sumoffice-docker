# SumOffice — Univention App Center draft

Status: draft, not yet submitted; needs republished multi-arch images (amd64+arm64) with the WOPI proof-key fix before submission.

`sumoffice/` holds the files that are uploaded to the Univention App Provider Portal for a multi-container
(Docker Compose) app:

| File | Purpose |
|---|---|
| `sumoffice.ini` | app metadata (`DockerMainService`, conflicts with Collabora, web interface, RAM) |
| `compose` | the compose file: `hissih/sumoffice-aio:v1` on `127.0.0.1:8093`, data in `/var/lib/univention-appcenter/apps/sumoffice/data` |
| `settings` | install/settings form: public URL, WOPI host name, WOPI host URL, open documents per editor |
| `inst` / `uinst` | join/unjoin scripts: Apache reverse proxy (with WebSocket) for `/f1`, `/a4`, `/hosting` |
| `README_EN` | text shown in the App Center after install |

Why one image: the four-service compose in `nextcloud/` mounts `nginx.conf` and `discovery.py` from its folder;
App Center compose apps ship only the compose file, so the single image (`aio/` on the `aio-single-image` branch)
is used. The WOPI proof key is generated on first start in `/data/proof` and shared by both editors.

## Licence-key sale: blocked

Univention can list and sell the app, but a licence key bought through the App Center must be checked by the
software itself. That needs the "licence key in the image" work first (the image reading and validating a key,
for example from a setting `sumoffice/license_key`). Until then this draft ships the evaluation images and points
to https://sumoffice.com/download#server for production licences; `License = proprietary` is a placeholder.

## Assumptions to confirm in the App Provider Portal

- Setting values are substituted into `compose` as `@%@sumoffice/<name>@%@` (UCR-style templating); if the
  portal passes settings as container environment instead, drop the `environment` block.
- `SupportedUCSVersions`, the app `Code` (`XX`) and the conflicting app IDs (`collabora`, `collabora-online`) are
  placeholders to be set with Univention.
- The Apache proxy uses `upgrade=websocket` (Apache 2.4.47+), so only UCS 5.2 is listed.
- `InitialValue` in `settings` uses UCR placeholders for this host's FQDN; if not expanded there, leave it empty.
- The UCS Apache serves this host over https, so `PUBLIC_URL` defaults to `https://<fqdn>`.
- `/hosting` is not used by other UCS components except Collabora (hence the conflict).

## Submission (owner)

1. Request an App Provider account at Univention (https://www.univention.com/products/app-catalog/ →
   "Become an app provider"), get the app `Code`.
2. Publish the images; create the app in the App Provider Portal as a Docker Compose app, upload/paste these files,
   test on a UCS 5.x test system from the test App Center.
3. Ask Univention to publish; for paid listing, finish the licence-key work first.

Maintainer: SumOffice — https://github.com/SumOfficeApp/sumoffice-docker
