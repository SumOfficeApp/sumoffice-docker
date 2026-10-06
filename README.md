# SumOffice in Docker — Nextcloud, standalone, preview

Excel and Word editors you run yourself. Files stay real `.xlsx`/`.xlsm`/`.docx`; macros and Power Query travel with the file; Excel and Word open the result without a repair dialog. Measured on a real corpus — https://sumoffice.com/nextcloud

Images (Docker Hub, `hissih/`): `sumsheet-webhost` (Excel-compatible), `sumdoc-webhost` (Word-compatible), `sumoffice-preview` (read-only previews), `sumoffice-docsapi` (self-hosted document server for compatible connectors), `sumoffice-mcp` (server for AI agents — https://github.com/SumOfficeApp/sumoffice-mcp).

Pinned images, per editor — they are released on their own dates and are not
pinned to one:

| image | pinned tag | built from |
|---|---|---|
| `sumsheet-webhost` | `2026.10.01-amd64` (`sha256:5874968f…`) | released 1 October |
| `sumdoc-webhost` | `2026.10.01-amd64` (`sha256:3f7667ee…`) | released 1 October |
| `sumslide-server` | `2026.10.07-amd64` | first public release; FastOffices/office-app#1826 |
| `sumoffice-docsapi` | `2026.09.27-amd64` | unchanged since 27 September |
| `sumoffice-preview` | `2026.09.28-amd64` | both editors of 28 September |

The catalog and compose files pin dated tags and immutable digests rather than relying on
`latest`. Docker Hub reported those two linux/amd64 digests on 4 October 2026.

The images were built on an Apple Silicon Mac under Docker's x86-64 emulation;
**an arm64 image is not part of this release**, and `latest` is a single
`linux/amd64` image rather than a multi-architecture list. Every image carries
the architecture it was built for: the build refuses to produce an image whose
architecture differs from the engine inside it.

## Nextcloud — three steps

Nextcloud Office allows one editor origin, so all three editors sit behind one nginx: SumSheet at `/f1`, SumDoc at `/a4`, SumSlide at `/slides`, WOPI discovery at `/hosting/*`.

```sh
git clone https://github.com/SumOfficeApp/sumoffice-docker && cd sumoffice-docker/nextcloud
cp env.example .env            # PUBLIC_URL = the address you give this stack; NEXTCLOUD_URL = your Nextcloud
                               # NEXTCLOUD_HOST is a bare hostname — no scheme, no port
sh sdelat-proof-klyuch.sh      # one signing key for all editors, once
docker compose up -d           # 1. start the editors (put your TLS proxy in front of :8093)
sh nextcloud-occ.sh https://office.example.com   # 2. on the Nextcloud host: three occ settings, one activation
```

`sdelat-proof-klyuch.sh` matters for any host that verifies WOPI signatures — Odoo does by default,
SharePoint always. The two editors each sign with their own key otherwise, while the shared
`/hosting/discovery` can carry only one: the host then rejects everything the other editor signed.
Nextcloud Office verifies them too (`Invalid WOPI proof` in its log), so run it once before the first start.

**Put this stack on the same site as Nextcloud** — `office.example.com` next to `cloud.example.com`.
The editor runs in a frame inside Nextcloud and keeps your sign-in in a cookie. When the two addresses
belong to different sites, that cookie is a third-party cookie: Safari and private windows in Chrome
block it, and the frame shows "Sign-in required". Measured 6 October 2026 on Nextcloud 32.0.15.

3. Open any `.xlsx`, `.xlsm`, `.docx` or `.pptx` in Nextcloud Files. It opens in the real engine; Save writes the same file back.

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
