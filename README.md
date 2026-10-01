# SumOffice in Docker — Nextcloud, standalone, preview

Excel and Word editors you run yourself. Files stay real `.xlsx`/`.xlsm`/`.docx`; macros and Power Query travel with the file; Excel and Word open the result without a repair dialog. Measured on a real corpus — https://sumoffice.com/nextcloud

Images (Docker Hub, `hissih/`): `sumsheet-webhost` (Excel-compatible), `sumdoc-webhost` (Word-compatible), `sumoffice-preview` (read-only previews), `sumoffice-docsapi` (self-hosted document server for compatible connectors), `sumoffice-mcp` (server for AI agents — https://github.com/SumOfficeApp/sumoffice-mcp).

Pinned images, per editor — they are released on their own dates and are not
pinned to one:

| image | pinned tag | built from |
|---|---|---|
| `sumsheet-webhost` | `2026.09.30-amd64` | SumSheet `cc429a4394` |
| `sumdoc-webhost` | `2026.09.28-amd64` | SumDoc `cb25e7b6e` |
| `sumoffice-docsapi` | `2026.09.27-amd64` | unchanged since 27 September |
| `sumoffice-preview` | `2026.09.28-amd64` | both editors of 28 September |

SumSheet moved from `2026.09.28-amd64` to `2026.09.30-amd64` because the
28 September image does not carry the SharePoint fix, while the 30 September
build does. `latest` for `sumsheet-webhost` points at the same 30 September
image (`sha256:72e45894c7aff14969eb55e2399437460b15c7c3775e04432486ca26565b47e0`);
for the other images `latest` still points at their 28 September build, so pin
the dated tag rather than relying on `latest`.

The images were built on an Apple Silicon Mac under Docker's x86-64 emulation;
**an arm64 image is not part of this release**, and `latest` is a single
`linux/amd64` image rather than a multi-architecture list. Every image carries
the architecture it was built for: the build refuses to produce an image whose
architecture differs from the engine inside it.

## Nextcloud — three steps

Nextcloud Office allows one editor origin, so both editors sit behind one nginx: SumSheet at `/f1`, SumDoc at `/a4`, WOPI discovery at `/hosting/*`.

```sh
git clone https://github.com/SumOfficeApp/sumoffice-docker && cd sumoffice-docker/nextcloud
cp env.example .env            # PUBLIC_URL = the address you give this stack; NEXTCLOUD_URL = your Nextcloud
                               # NEXTCLOUD_HOST is a bare hostname — no scheme, no port
sh sdelat-proof-klyuch.sh      # one signing key for both editors, once
docker compose up -d           # 1. start the editors (put your TLS proxy in front of :8093)
sh nextcloud-occ.sh https://office.example.com   # 2. on the Nextcloud host: three occ settings, one activation
```

`sdelat-proof-klyuch.sh` matters for any host that verifies WOPI signatures — Odoo does by default,
SharePoint always. The two editors each sign with their own key otherwise, while the shared
`/hosting/discovery` can carry only one: the host then rejects everything the other editor signed.
Nextcloud Office does not verify signatures, so this step is invisible there and bites elsewhere.

3. Open any `.xlsx`, `.xlsm` or `.docx` in Nextcloud Files. It opens in the real engine; Save writes the same file back.

**If the browser says "document failed to load", check `wopi_allowlist` first.**
That setting lists the addresses Nextcloud accepts WOPI calls from — the editors call
back from inside their container, so the container network has to be in the list. When
Docker recreates the stack it can hand out a different subnet (measured 29 September:
`192.168.48.0/20` became `192.168.0.0/20`), and from that moment Nextcloud answers the
editor with `403` on `CheckFileInfo`. The browser shows a generic loading error, so it
looks like a broken editor while nothing is broken:

```sh
docker network inspect <stack>_default --format '{{(index .IPAM.Config 0).Subnet}}'
php occ config:app:get richdocuments wopi_allowlist          # do they match?
php occ config:app:set richdocuments wopi_allowlist --value "<subnet>,<your host>"
```

Leaving `wopi_allowlist` unset accepts calls from anywhere, which is why a fresh install
usually works and a hardened one breaks after a network change.

Tested with Nextcloud 29–32 and Nextcloud Office (richdocuments) ≥ 8. The optional installer app that sets the three settings from the Nextcloud UI: https://github.com/SumOfficeApp/sumoffice-nextcloud

## Self-hosted document server

For systems that already use a compatible document-server connector, use
[`document-server/`](document-server/README.md). It includes DocsAPI, both editors,
preview generation, one discovery endpoint, and the reverse-proxy front.

## Standalone

One editor without Nextcloud, talking to your own system for users and files: `standalone/README.md`.

## What does not survive yet (honestly)

- Power Query is preserved, not refreshed, in the browser editor; refresh is in the desktop app.
- Concurrent editing is measured through WOPI on Nextcloud 31. Other host adapters
  need their own acceptance run before you rely on concurrent editing there.
- Macros routed "Excel bridge" (COM automation, some ActiveX) stay in Excel; the report names each one.

## Licence

This repository is MIT. The images are free for evaluation; production use inside an organisation is licensed per application — https://sumoffice.com/download#server. Questions and files that did not open right: hello@sumoffice.com
