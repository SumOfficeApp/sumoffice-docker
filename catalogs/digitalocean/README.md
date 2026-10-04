# SumOffice — DigitalOcean Marketplace (Droplet 1-Click App)

Status: submission package on released images, not submitted; real snapshot round remains an owner gate.

A Droplet 1-Click App is a snapshot in the vendor's DigitalOcean team, submitted through the Vendor Portal. This
folder builds that snapshot with Packer, following the layout of
[digitalocean/marketplace-partners](https://github.com/digitalocean/marketplace-partners): install, firewall,
force-ssh-logout, `90-cleanup.sh`, `99-img-check.sh`, snapshot.

| File | Purpose |
|---|---|
| `sumoffice.pkr.hcl` | Packer template (HCL2, plugin `github.com/digitalocean/digitalocean`): Ubuntu 24.04 build Droplet `s-1vcpu-1gb` in `nyc3`, droplet agent and monitoring off |
| `scripts/01-sumoffice.sh` | runs `../vm/sumoffice-install.sh` (Docker, Caddy, repository in `/opt/sumoffice`, images pulled) |
| `scripts/02-ufw.sh` | `ufw limit ssh`, allow 80 and 443, enable |
| `scripts/03-force-ssh-logout.sh` | DigitalOcean's script: root SSH shows "Please wait..." until first boot is done |
| `scripts/90-cleanup.sh`, `scripts/99-img-check.sh` | DigitalOcean's cleanup and image check, copied unchanged from marketplace-partners (Apache-2.0, headers kept; licence text in `scripts/LICENSE-digitalocean.md`) |
| `files/var/lib/cloud/scripts/per-instance/001_onboot` | first boot: starts the stack at the Droplet IP, hooks `sumoffice-first-login`, removes the SSH force-logout |

Shared scripts: `../vm/` (see its README). The customer experience:

1. Create the Droplet from the Marketplace. After first boot the editors answer on `http://<Droplet IP>`
   (`/healthcheck`, `/cell/health`, `/word/health`).
2. SSH in as root: setup asks for a DNS name and connector JWT secret; Caddy obtains a Let's Encrypt certificate.
3. Enter the same address and secret in the office connector.

## Build (owner)

```sh
# Packer >= 1.10; token of the team that owns the Vendor Portal listing
export DIGITALOCEAN_TOKEN=...
packer init  catalogs/digitalocean/sumoffice.pkr.hcl
packer build catalogs/digitalocean/sumoffice.pkr.hcl
# optional: -var sumoffice_ref=<tag> -var application_version=<version> -var region=fra1
```

The build fails if `99-img-check.sh` reports a failed test; warnings are printed and must be reviewed.
`manifest.json` (written next to the template) holds the snapshot ID, as used by the Vendor API example in
marketplace-partners.

## Submission (owner)

1. Apply as a vendor at https://marketplace.digitalocean.com/vendors; the Vendor Portal is
   https://cloud.digitalocean.com/vendorportal (contact: one-clicks-team@digitalocean.com).
2. Build the snapshot in the team that owns the Vendor Portal (the snapshot must belong to that team).
3. In the Vendor Portal create a Droplet 1-Click App: pick the snapshot, OS "Ubuntu 24.04", software included
   (Docker, Caddy, SumSheet, SumDoc with their versions), description, getting-started text (the three steps
   above), support contact, logo.
4. Later updates: new snapshot, then the Vendor API
   (`PATCH https://api.digitalocean.com/api/v1/vendor-portal/apps/<app_id>` with `imageId`), see marketplace-partners.

What is needed from the owner: a DigitalOcean account with Vendor Portal access, a real snapshot test, logo and
listing assets.

## Checked

- `packer fmt -check` and `packer validate -syntax-only` (Packer 1.16.1): pass.
- Full `packer validate` was not possible: the plugin binary could not be downloaded in the sandbox. The builder
  fields used (`api_token`, `image`, `region`, `size`, `ssh_username`, `snapshot_name`, `droplet_agent`,
  `monitoring`, `private_networking`) were checked against the plugin's builder documentation.
- `bash -n` and ShellCheck on `01-sumoffice.sh`, `02-ufw.sh`, `001_onboot`; `90-cleanup.sh`, `99-img-check.sh`
  and `03-force-ssh-logout.sh` are byte-identical to marketplace-partners (commit `b70878804ca2`).
- Not built: no Droplet was created, `99-img-check.sh` was not run against a real build.

## Open points

- `99-img-check.sh` expects no `/opt/digitalocean`, hence `droplet_agent = false`; confirm the Droplets created
  from the image still get the web console (DigitalOcean installs the agent on customer Droplets separately).
- Snapshot size grows with the pulled images (about 400 MB compressed today); the smallest plan's 25 GB disk is
  ample.
- Image tags: the stack uses the released linux/amd64 tags and digests pinned in `nextcloud/docker-compose.yml`.
