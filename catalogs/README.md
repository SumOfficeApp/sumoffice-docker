# SumOffice catalog packages

Status: draft, not yet submitted; needs republished multi-arch images (amd64+arm64) with the WOPI proof-key fix before submission.

Self-hosting catalog packages for SumOffice: **SumSheet** (Excel-compatible, `/f1`), **SumDoc** (Word-compatible,
`/a4`) and the joint WOPI discovery (`/hosting/discovery`, `/hosting/capabilities`) behind one origin on port 8093.
Nothing here has been submitted to any catalog.

Two shapes are used:

- **Four services** (same as `nextcloud/docker-compose.yml`): `hissih/sumsheet-webhost`, `hissih/sumdoc-webhost`,
  discovery (`python:3.12-alpine` + `nextcloud/discovery.py`), nginx front. Used where side files can ship:
  Helm (ConfigMap) and Proxmox (the repository is cloned).
- **One image** `hissih/sumoffice-aio` (`aio/` on the `aio-single-image` branch; same processes, Node front instead
  of nginx/python). Used where a catalog ships only a compose file or one container: CapRover, TrueNAS, Unraid,
  Umbrel, Univention; Cloudron builds an equivalent image of its own from the two editor images.

In both shapes both editors sign WOPI requests with **one proof key** (generated once, kept in the data volume or a
Secret, exposed via `SUMOFFICE_WOPI_PROOF_DIR` and SumDoc's legacy `wopi-proof.json`).

| Catalog | Folder | Submission path | What the owner must do | Blockers |
|---|---|---|---|---|
| Artifact Hub (Helm) | `helm/sumoffice`, `helm/artifacthub-repo.yml` | Publish the chart to a Helm repo (GitHub Pages or OCI `ghcr.io`), then add the repo at artifacthub.io → Control Panel → Add repository | GitHub/ghcr publishing; Artifact Hub account; put the issued `repositoryID` into `artifacthub-repo.yml`; add `icon.png` | republished images with the proof-key fix (`SUMOFFICE_WOPI_PROOF_DIR`); multi-arch for arm64 clusters |
| CapRover | `caprover/` | PR to github.com/caprover/one-click-apps: `public/v4/apps/sumoffice.yml` + `public/v4/logos/sumoffice.png` | test via the "TEMPLATE" entry in a CapRover dashboard; run `npm run validate_apps` and `npm run formatter`; open the PR | `hissih/sumoffice-aio` not yet published on Docker Hub; logo |
| TrueNAS (community train) | `truenas/sumoffice` | PR to github.com/truenas/apps adding `ix-dev/community/sumoffice` (PR template `app_addition`) | copy the folder, run `devbox run copy-lib` (fills `templates/library` and `lib_version_hash`), run `.github/scripts/ci.py --app sumoffice --train community --test-file basic-values.yaml --wait=true`; give icon/screenshots in the PR for their CDN | aio image (amd64+arm64); confirm non-root (568) run and `FRONT_PORT`; port 30093 collision check |
| Unraid Community Applications | `unraid/` | template repository + Unraid forum support thread + CA submission form | host the XMLs on `main` (or a templates repo), add PNG icons, create the forum support thread, submit via the CA form | aio image; icons; support thread URL in `<Support>` |
| Cloudron App Store | `cloudron/` | Cloudron forum ("App Packaging & Development"); the Cloudron team publishes store apps | `cloudron build` / `cloudron install` on an own Cloudron, publish the package repo, post in the forum | republished editor images; confirm the editors run from `/app/code/*` on `cloudron/base` Node; logo; amd64 only on Cloudron |
| Proxmox VE (community-scripts) | `proxmox/ct`, `proxmox/install` | PR to github.com/community-scripts/ProxmoxVED (new scripts go there first, then ProxmoxVE) | fork ProxmoxVED, test on a real PVE host (`dev_mode="trace,keep"`), open the PR; website metadata via their site | Docker-based script may be declined (they prefer native installs); arm64 off until multi-arch images |
| Umbrel App Store | `umbrel/sumoffice` | PR to github.com/getumbrel/umbrel-apps adding the `sumoffice/` folder | test on umbrelOS, pin the image digest, provide icon (SVG) + 3 gallery images, set `submission:` to the PR URL | **arm64 images required**; aio image; server-side reach of Nextcloud (`wopi_callback_url`) to verify |
| Univention App Center | `univention/sumoffice` | Univention App Provider Portal (account from Univention) | get an app `Code`, create a Docker Compose app, paste `ini`/`compose`/`settings`/`inst`/`uinst`, test on UCS 5.2 | aio image; **licence-key sale needs the "key in image" work first**; confirm settings templating in compose |

Related drafts outside this folder: Nextcloud AIO community container and CasaOS (both use the same one image).

## Validation done

- YAML (all `*.yml`/`*.yaml` except Jinja templates), JSON and XML files parse with Python (`yaml`, `json`,
  `xml.etree`); `bash -n` on every shell script.
- Helm: `helm lint --strict` and `helm template` (Helm v3.16.2) pass; rendered manifests parse; missing
  `publicUrl` fails with a clear message.
- TrueNAS: `templates/docker-compose.yaml` rendered with the real rendering library 2.3.14 against
  `basic-values.yaml` (outside the official CI container).
- Proxmox: the compose override written by the install script merges with `nextcloud/docker-compose.yml`
  (`docker compose config`).
- Nothing was run end-to-end: no images were pulled and no catalog CI was run.

Maintainer: SumOffice — https://github.com/SumOfficeApp/sumoffice-docker
