# SumOffice — CapRover one-click app

Status: draft, not yet submitted; needs republished multi-arch images (amd64+arm64) with the WOPI proof-key fix before submission.

`sumoffice.yml` is a CapRover one-click app in the `captainVersion: 4` format. It runs the single image
`hissih/sumoffice-aio` (built from `aio/` on the `aio-single-image` branch: SumSheet + SumDoc + joint discovery +
front on port 8093, data and the one WOPI proof key in `/data`).

Why one image: a one-click app can only reference images, not the `nginx.conf` and `discovery.py` files that the
four-service compose in `nextcloud/` mounts. The single image carries them inside.

| Variable | Container env | Default |
|---|---|---|
| `$$cap_sumoffice_version` | image tag | `v1` |
| `$$cap_public_url` | `PUBLIC_URL` | `https://$$cap_appname.$$cap_root_domain` |
| `$$cap_wopi_host` | `NEXTCLOUD_HOST` (SumSheet `--wopi-allow`) | `cloud.example.com` |
| `$$cap_wopi_url` | `NEXTCLOUD_URL` (SumDoc `--wopi-hosts`) | `https://cloud.example.com` |
| `$$cap_max_cabins` | `MAX_CABINS` | `8` |

## Try it locally before a PR

CapRover dashboard → Apps → One-Click Apps/Databases → last entry "TEMPLATE" → paste `sumoffice.yml`.

## Submission (owner)

1. Publish `hissih/sumoffice-aio:v1` (amd64 + arm64) to Docker Hub.
2. Fork https://github.com/caprover/one-click-apps, add `public/v4/apps/sumoffice.yml` (this file) and
   `public/v4/logos/sumoffice.png` (logo, square PNG).
3. Run their checks (`npm ci && npm run validate_apps && npm run formatter`), open a PR.

Assumptions: `websocketSupport` in `caproverExtra` is honoured by the CapRover version in use (it is used by other
apps in the catalog); the editor needs WebSocket for every open document.

Maintainer: SumOffice — https://github.com/SumOfficeApp/sumoffice-docker
