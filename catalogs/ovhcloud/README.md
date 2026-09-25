# SumOffice — OVHcloud

Status: draft, not yet submitted; needs republished images with the WOPI proof-key fix before submission.

## What the OVHcloud Marketplace is

The OVHcloud Marketplace (https://marketplace.ovhcloud.com) lists SaaS and PaaS offers from selected vendors.
There is no public self-service format for vendor VM images: vendors are recruited and onboarded by the
marketplace team (contact from https://www.ovhcloud.com/en/discover-marketplace/: `vendeur-marketplace@ovhcloud.com`).
What exactly they accept for a self-hosted product (a managed offer, an image in the Public Cloud catalogue, or
instructions for customers) is decided in that conversation; nothing in this folder can be submitted on its own.

What this folder gives, and what works today without any listing: **`cloud-init.yaml`** for an OVHcloud Public
Cloud instance. It is the same stack as the other VM catalogs (`../vm/`): Docker, Caddy, the four-service compose of
`nextcloud/`, one WOPI proof key per instance.

## Use it (customer or owner)

1. Edit the three values in `write_files` (`SUMOFFICE_DOMAIN`, `SUMOFFICE_PUBLIC_URL`, `SUMOFFICE_NEXTCLOUD_URL`;
   see the comments at the top of the file).
2. Control Panel → Public Cloud → Instances → Create an instance: image **Ubuntu 24.04**, a model with at least
   2 vCPU / 4 GB (x86-64), then paste the file into the advanced setting "Post-installation script"
   (OVHcloud guide "Creating and connecting to a Public Cloud instance"). With the OpenStack CLI (guide "Launching
   a script when an instance is created"; look up the exact image and flavor names with `openstack image list`
   and `openstack flavor list`):
   ```sh
   openstack server create --image "Ubuntu 24.04" --flavor <flavor> --key-name <key> \
     --network Ext-Net --user-data catalogs/ovhcloud/cloud-init.yaml sumoffice
   ```
3. Point the DNS name at the instance's IP (before or after; Caddy retries the certificate), wait for
   `/var/log/cloud-init-output.log` to end with "SumOffice cloud-init finished", open `https://<name>/hosting/discovery`.
4. On the Nextcloud host: `sh nextcloud-occ.sh https://<name>`.

Settings can be changed later on the instance with `sudo sumoffice-configure --interactive`.

## If OVHcloud wants a pre-built image

Build a qcow2 from an Ubuntu 24.04 instance after `sumoffice-install.sh` (no `sumoffice-configure`, so no proof
key or `.env` is baked in), clean it like the other VM images (logs, SSH host keys, machine-id,
`cloud-init clean`), create a snapshot/image, and put `sumoffice-configure` into a cloud-init per-instance
script, as `../digitalocean/files/var/lib/cloud/scripts/per-instance/001_onboot` does. OVHcloud recommends
`qemu-guest-agent` and cloud-init in uploaded images ("Uploading your own image"). Not prepared here until the
marketplace team confirms that this is the format they want.

What is needed from the owner: the conversation with the OVHcloud Marketplace team (company details, offer
description, support terms); an OVHcloud Public Cloud project to test the cloud-init file; the images republished
with the proof-key fix; a tag of this repository with `catalogs/vm/` (the file clones `main`).

## Checked

- `cloud-init schema -c cloud-init.yaml` (cloud-init from its main branch, 2026-09-25): valid.
- The values file is read by `sumoffice-configure` as its saved state (`/etc/sumoffice/sumoffice.env`); an empty
  domain and public URL start the stack on `http://<first IP>` (exercised with stubs, see `../vm/README.md`).
- Not run on OVHcloud: no instance was created; the post-installation field was not exercised with this file.
