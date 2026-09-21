# SumOffice in Docker — Nextcloud, standalone, preview

Excel and Word editors you run yourself. Files stay real `.xlsx`/`.xlsm`/`.docx`; macros and Power Query travel with the file; Excel and Word open the result without a repair dialog. Measured on a real corpus — https://sumoffice.com/nextcloud

Images (Docker Hub, `hissih/`): `sumsheet-webhost` (Excel-compatible), `sumdoc-webhost` (Word-compatible), `sumoffice-preview` (read-only previews), `sumoffice-mcp` (server for AI agents — https://github.com/SumOfficeApp/sumoffice-mcp).

## Nextcloud — three steps

Nextcloud Office allows one editor origin, so both editors sit behind one nginx: SumSheet at `/f1`, SumDoc at `/a4`, WOPI discovery at `/hosting/*`.

```sh
git clone https://github.com/SumOfficeApp/sumoffice-docker && cd sumoffice-docker/nextcloud
cp env.example .env            # PUBLIC_URL = the address you give this stack; NEXTCLOUD_URL = your Nextcloud
docker compose up -d           # 1. start the editors (put your TLS proxy in front of :8093)
sh nextcloud-occ.sh https://office.example.com   # 2. on the Nextcloud host: three occ settings, one activation
```

3. Open any `.xlsx`, `.xlsm` or `.docx` in Nextcloud Files. It opens in the real engine; Save writes the same file back.

Tested with Nextcloud 29–32 and Nextcloud Office (richdocuments) ≥ 8. The optional installer app that sets the three settings from the Nextcloud UI: https://github.com/SumOfficeApp/sumoffice-nextcloud

## Standalone

One editor without Nextcloud, talking to your own system for users and files: `standalone/README.md`.

## What does not survive yet (honestly)

- Power Query is preserved, not refreshed, in the browser editor; refresh is in the desktop app.
- One editor per document at a time in the browser; a second person gets read-only.
- Macros routed "Excel bridge" (COM automation, some ActiveX) stay in Excel; the report names each one.

## Licence

This repository is MIT. The images are free for evaluation; production use inside an organisation is licensed per application — https://sumoffice.com/download#server. Questions and files that did not open right: hello@sumoffice.com
