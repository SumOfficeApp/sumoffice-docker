# SumOffice — Proxmox VE LXC script (community-scripts style)

Status: draft, not yet submitted; needs republished multi-arch images (amd64+arm64) with the WOPI proof-key fix before submission.

| File | Purpose |
|---|---|
| `ct/sumoffice.sh` | runs on the Proxmox host: creates a Debian 13 LXC (2 vCPU, 4 GB RAM, 12 GB disk, unprivileged) and handles `update` |
| `install/sumoffice-install.sh` | runs inside the LXC: installs Docker (`setup_docker`), clones this repository to `/opt/sumoffice`, writes `.env`, starts `nextcloud/docker-compose.yml` |

The stack inside the LXC is exactly the four-service compose of `nextcloud/` (SumSheet `hissih/sumsheet-webhost`,
SumDoc `hissih/sumdoc-webhost`, discovery `python:3.12-alpine` + `discovery.py`, nginx front). The install script
adds a `docker-compose.override.yml` that

- publishes the front on `0.0.0.0:8093` of the LXC (upstream binds `127.0.0.1` only), and
- mounts one WOPI proof key (`/opt/sumoffice/data/proof/proof-key.pem`, generated with openssl) into both editors
  with `SUMOFFICE_WOPI_PROOF_DIR=/data/proof`, and writes the same key into SumDoc's legacy
  `/data/cabins/wopi-proof.json`.

Variables (answer up front for unattended installs, otherwise the install script asks):

| Variable | Meaning | Default |
|---|---|---|
| `var_sumoffice_wopi_url` | Nextcloud origin → `NEXTCLOUD_URL`, host part → `NEXTCLOUD_HOST` | `https://cloud.example.com` |
| `var_sumoffice_public_url` | address the browser uses → `PUBLIC_URL` | `http://<LXC IP>:8093` |

Settings can be changed later in `/opt/sumoffice/nextcloud/.env`, then `docker compose up -d`.
For https put a TLS reverse proxy with WebSocket support in front of `<LXC IP>:8093` and set `PUBLIC_URL` to its address.

Validated: `bash -n` on both scripts; the override merges with the upstream compose (`docker compose config`).
Not run on a Proxmox host.

## Assumptions and blockers

- `var_arm64=no`: the images are amd64 only today; switch to `yes` once multi-arch images are published.
- Docker inside an unprivileged LXC relies on the nesting/keyctl features that `build.func` enables by default
  (as for `ct/docker.sh`).
- community-scripts prefers native installs over Docker stacks; a Docker-based script may be declined in review.
  If so, keep the pair in this repository and document the one-liner
  `bash -c "$(curl -fsSL https://raw.githubusercontent.com/SumOfficeApp/sumoffice-docker/main/catalogs/proxmox/ct/sumoffice.sh)"`
  (that needs `COMMUNITY_SCRIPTS_CORE_URL`/install-script URL adjustments, since `build.func` fetches
  `install/<app>-install.sh` from the community-scripts repository).
- Website metadata (name, description, logo, `app_vars` for the two variables) is kept in the project's PocketBase,
  not in repository files; it is entered through their website/review process.

## Submission (owner)

1. Publish the republished images; set `var_arm64` accordingly.
2. Fork https://github.com/community-scripts/ProxmoxVED (new scripts go there first, not to ProxmoxVE), add
   `ct/sumoffice.sh` and `install/sumoffice-install.sh`, test on a real Proxmox VE host
   (`dev_mode="trace,keep"`), open a PR in ProxmoxVED.
3. After testing there, the maintainers move it to ProxmoxVE.

Licence: the images are free for evaluation; production use inside an organisation is licensed per application —
https://sumoffice.com/download#server
