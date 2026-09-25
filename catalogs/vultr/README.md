# SumOffice — Vultr Marketplace

Status: draft, not yet submitted; needs republished images with the WOPI proof-key fix before submission.

A Vultr Marketplace app is built in the vendor portal (Marketplace → the app → **Builds**) in one of two ways.
Both are prepared here; Vultr recommends the first when the app allows it.

| Way | File | How it works |
|---|---|---|
| **Vendor Data** (imageless) | `vendor-data.sh` | pasted into "Build App Image From Vendor Data" with Ubuntu 24.04 LTS x64; runs once on the customer's fresh server: installs Docker, Caddy and the stack from this repository, starts it on `http://<server IP>` |
| **Snapshot** | `sumoffice.pkr.hcl`, `scripts/sumoffice-build.sh`, `files/sumoffice-per-instance.sh` | Packer (plugin `github.com/vultr/vultr`, layout of [vultr/vultr-marketplace](https://github.com/vultr/vultr-marketplace) `sample-app`) builds a server, installs everything with the images pulled, runs Vultr's `clean_system`, and snapshots it; the per-instance script starts the stack on first boot |

Both use the shared scripts in `../vm/`. The per-instance work is the same: a new WOPI proof key, `.env`,
compose override and Caddyfile (`sumoffice-configure --public-url http://<server IP>`), SSH closed while it runs
(as Vultr's provisioning guide asks), then `sumoffice-first-login` on the first root login asks for the DNS name
(Let's Encrypt via Caddy) and the Nextcloud address. Ports 80 and 443 are opened in `ufw` when it is present.

No application variables are needed: the editors have no user database or password of their own (users and files
come from Nextcloud).

## Build the snapshot (owner)

```sh
export VULTR_API_KEY=...          # this workstation's IP must be in the API access control list
packer init  catalogs/vultr/sumoffice.pkr.hcl
packer build catalogs/vultr/sumoffice.pkr.hcl
# defaults: plan marketplace-2c-2gb (2 vCPU, 2 GB, 8 GB disk), region ewr, os_id 2284 (Ubuntu 24.04 LTS x64)
```

`scripts/sumoffice-build.sh` downloads `vultr-helper.sh` from vultr/vultr-marketplace at a pinned commit and checks
its SHA-256 before sourcing it; `clean_system` then updates packages, adds the `vultr` kernel option, removes SSH
keys, logs, history and machine-id, and zeroes free space.

## Submission (owner)

1. Apply as a vendor: https://www.vultr.com/marketplace/become-a-verified-vendor/
2. In the vendor account: application profile, general and support information, Readme and App Instructions
   (Markdown; `{{ip}}` is available, e.g. `http://{{ip}}/hosting/discovery`), gallery images.
3. Builds tab: either paste `vendor-data.sh` (set `SUMOFFICE_REF` to a tag that contains `catalogs/vm/`) or pick
   the snapshot from the Packer build → **Build App Image**; test-deploy it, then publish.

Suggested App Instructions:

```markdown
## SumOffice is starting

* Editors (plain http until you set a DNS name): http://{{ip}}/hosting/discovery
* SSH in as root: the first login asks for a DNS name pointing at {{ip}} (a Let's Encrypt certificate is issued
  automatically) and for your Nextcloud address.
* On the Nextcloud host: `sh nextcloud-occ.sh https://<your DNS name>`
  (https://github.com/SumOfficeApp/sumoffice-docker/blob/main/nextcloud/nextcloud-occ.sh)
```

What is needed from the owner: a Vultr vendor account; the images republished with the proof-key fix and a tag of
this repository with `catalogs/vm/`; logo, screenshots and listing texts.

## Checked

- `packer fmt -check` and `packer validate -syntax-only` (Packer 1.16.1): pass. Full `packer validate` was not
  possible (plugin binary not downloadable in the sandbox); the builder fields used (`api_key`, `os_id`,
  `plan_id`, `region_id`, `snapshot_description`, `ssh_username`, `state_timeout`) were checked against the
  plugin's builder documentation. `os_id` 2284 and the plan list were read from the public API
  (`https://api.vultr.com/v2/os`, `/v2/plans`); `marketplace-2c-2gb` is the plan named in Vultr's vendor docs and
  examples and does not appear in the public plan list.
- `bash -n` and ShellCheck 0.11.0 on all three scripts: clean.
- Pinned `vultr-helper.sh` hash computed from the file at commit `95768fc9438a`.
- Not built or deployed: no Vultr server was created.

## Open points

- 8 GB disk of `marketplace-2c-2gb`: Ubuntu plus the four images fits by estimate (images about 400 MB compressed)
  but was not measured; if the snapshot is too big, use the Vendor Data way.
- Vendor Data runs on the customer's server, so the first boot takes longer (package install and image pull).
