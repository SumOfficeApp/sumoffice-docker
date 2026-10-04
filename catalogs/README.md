# SumOffice catalog packages

Status: submission kits prepared, not submitted. The seven owner-requested targets use the released
`hissih/sumoffice-compat:2026.4.0.2`, `hissih/sumdoc-webhost:latest` and
`hissih/sumsheet-webhost:latest` images, pinned by digest; see `RELEASED-IMAGES.md`.

Self-hosting catalog packages for SumOffice: **SumSheet** (Excel-compatible, `/cell`) and **SumDoc**
(Word-compatible, `/word`) behind the compatibility API on one public origin and port 8093.
Nothing here has been submitted to any catalog.

Two shapes are used for the seven requested targets:

- **Three containers**: compatibility server, SumDoc and SumSheet. Used by Helm and by the YAML imports for
  TrueNAS Custom Apps and Unraid Docker Compose Manager.
- **A virtual machine** (`vm/`, shared by DigitalOcean, Vultr, Azure and OVHcloud): Ubuntu 24.04 with Docker and
  the same three-container compose, Caddy on 80/443 in front of it (Let's Encrypt for a DNS name).
  Images are pulled into the snapshot (DigitalOcean, Vultr) or on first boot (cloud-init); the proof key, `.env`
  and containers are always created per instance on first boot
  (`sumoffice-configure`).

All connectors use one JWT secret shared with the compatibility server. Store it outside screenshots and source.
No public SumSlide server image exists yet, so these exact kits do not claim PPTX.

| Catalog | Folder | Submission path | What the owner must do | Blockers |
|---|---|---|---|---|
| Artifact Hub (Helm) | `helm/sumoffice`, `helm/artifacthub-repo.yml` | Publish the chart to a Helm repo, then Artifact Hub → Control Panel → Add repository | Follow `helm/OWNER-SUBMISSION.md` | live amd64 cluster round and approved icon |
| CapRover | `caprover/` | PR to github.com/caprover/one-click-apps: `public/v4/apps/sumoffice.yml` + `public/v4/logos/sumoffice.png` | test via the "TEMPLATE" entry in a CapRover dashboard; run `npm run validate_apps` and `npm run formatter`; open the PR | `hissih/sumoffice-aio` not yet published on Docker Hub; logo |
| TrueNAS SCALE | `truenas/docker-compose.yaml` | Apps → Custom App → Install via YAML; community-catalog PR after live proof | Follow `truenas/OWNER-SUBMISSION.md` | live amd64 SCALE round, approved icon/screenshots |
| Unraid Community Applications | `unraid/docker-compose.yaml` | Docker Compose Manager stack + CA template repository/support thread | Follow `unraid/OWNER-SUBMISSION.md` | live amd64 Unraid round, approved icon/support URL |
| Cloudron App Store | `cloudron/` | Cloudron forum ("App Packaging & Development"); the Cloudron team publishes store apps | `cloudron build` / `cloudron install` on an own Cloudron, publish the package repo, post in the forum | republished editor images; confirm the editors run from `/app/code/*` on `cloudron/base` Node; logo; amd64 only on Cloudron |
| Proxmox VE (community-scripts) | `proxmox/ct`, `proxmox/install` | PR to github.com/community-scripts/ProxmoxVED (new scripts go there first, then ProxmoxVE) | fork ProxmoxVED, test on a real PVE host (`dev_mode="trace,keep"`), open the PR; website metadata via their site | Docker-based script may be declined (they prefer native installs); arm64 off until multi-arch images |
| Umbrel App Store | `umbrel/sumoffice` | PR to github.com/getumbrel/umbrel-apps adding the `sumoffice/` folder | test on umbrelOS, pin the image digest, provide icon (SVG) + 3 gallery images, set `submission:` to the PR URL | **arm64 images required**; aio image; server-side reach of Nextcloud (`wopi_callback_url`) to verify |
| Univention App Center | `univention/sumoffice` | Univention App Provider Portal (account from Univention) | get an app `Code`, create a Docker Compose app, paste `ini`/`compose`/`settings`/`inst`/`uinst`, test on UCS 5.2 | aio image; **licence-key sale needs the "key in image" work first**; confirm settings templating in compose |
| DigitalOcean Marketplace | `digitalocean/`, `vm/` | Vendor Portal, Packer-built Droplet 1-Click snapshot | Follow `digitalocean/OWNER-SUBMISSION.md` | real snapshot round and approved icon |
| Vultr Marketplace | `vultr/`, `vm/` | Vendor dashboard, Vendor Data or Packer snapshot | Follow `vultr/OWNER-SUBMISSION.md` | real instance round and approved icon/screenshots |
| Azure Marketplace | `azure/`, `vm/` | Partner Center Azure Application | Follow `azure/OWNER-SUBMISSION.md` | preview subscription round and approved assets |
| OVHcloud Marketplace | `ovhcloud/`, `vm/` | vendor onboarding by email | Follow `ovhcloud/OWNER-SUBMISSION.md` | OVH-assigned package format and staging round |
| Flathub | `flathub/` (README only) | PR to github.com/flathub/flathub (`new-pr` branch) | — | not applicable: desktop channel, this repository ships server images only |
| Snap Store | `snap/` (README only) | snapcraft.io | — | not applicable as is: a Docker-driving snap needs a super-privileged interface; no native server release to package |

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
- VM packages: `bash -n` + ShellCheck 0.11.0 on every script; `packer fmt -check` and `packer validate
  -syntax-only` (Packer 1.16.1) on both templates (builder plugins not installable here, fields checked against
  the plugin docs); `bicep build` + `bicep lint` (0.47.16); `createUiDefinition.json` against its published JSON
  schema; `cloud-init schema -c` on both cloud-config files; `sumoffice-configure` exercised with stubbed
  docker/caddy/systemctl, and its compose override merged with `nextcloud/docker-compose.yml`
  (`docker compose config`). Details in each folder's README.
- Nothing was run end-to-end: no images were pulled and no catalog CI was run; no VM, Droplet or Azure deployment
  was created.

Maintainer: SumOffice — https://github.com/SumOfficeApp/sumoffice-docker
