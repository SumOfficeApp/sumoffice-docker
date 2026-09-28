# SumOffice in Docker — Nextcloud, standalone, preview

Excel and Word editors you run yourself. Files stay real `.xlsx`/`.xlsm`/`.docx`; macros and Power Query travel with the file; Excel and Word open the result without a repair dialog. Measured on a real corpus — https://sumoffice.com/nextcloud

Images (Docker Hub, `hissih/`): `sumsheet-webhost` (Excel-compatible), `sumdoc-webhost` (Word-compatible), `sumoffice-preview` (read-only previews), `sumoffice-docsapi` (self-hosted document server for compatible connectors), `sumoffice-mcp` (server for AI agents — https://github.com/SumOfficeApp/sumoffice-mcp).

The measured 28 September release is pinned as `2026.09.28-amd64`, and `latest`
points at the same images. It is a complete `linux/amd64` build from SumSheet
`193fdf2105` and SumDoc `cb25e7b6e`. DocsAPI is unchanged in this release and
stays pinned at `2026.09.27-amd64` — it was not rebuilt on 28 September.

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
