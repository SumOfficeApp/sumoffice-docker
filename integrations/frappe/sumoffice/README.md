# SumOffice for Frappe / ERPNext

Frappe app `sumoffice` (Frappe 15, works with ERPNext). Adds a **SumOffice** link next to `.xlsx`, `.xlsm`, `.xlsb` and `.docx` attachments in the form sidebar of any document. The file opens in SumSheet (Excel-compatible) or SumDoc (Word-compatible); **Ctrl+S** saves it back into the same Frappe `File`.

Frappe is the WOPI host, SumOffice is the WOPI client. Every call runs as the person who opened the file: reading needs read access to the `File`, writing needs write access to the document it is attached to.

## Install

```bash
cd frappe-bench
bench get-app https://github.com/SumOfficeApp/sumoffice-docker --branch integrations  # or copy integrations/frappe/sumoffice into apps/
bench --site your.site install-app sumoffice
bench --site your.site set-config sumoffice_discovery_url https://office.example.com/hosting/discovery
bench --site your.site set-config -p sumoffice_verify_proof 1
bench build --app sumoffice
```

`host_name` of the site must be the address the SumOffice servers use to reach Frappe (it goes into `WOPISrc`). On the SumOffice side allow the host: `WOPI_ALLOW=erp.example.com` (SumSheet) and `--wopi-hosts https://erp.example.com` (SumDoc). For a private certificate on the SumOffice side: `bench --site your.site set-config sumoffice_ca_bundle /path/to/ca.pem`.

## What it implements

| WOPI operation | Route |
|---|---|
| CheckFileInfo | `GET /wopi/files/<File name>` |
| GetFile | `GET /wopi/files/<File name>/contents` |
| PutFile | `POST /wopi/files/<File name>/contents` — only under the editor's lock |
| Lock / Unlock / RefreshLock / GetLock | `POST /wopi/files/<File name>` — 30-minute locks in the Frappe cache |
| Open | `GET /sumoffice/open/<File name>` — for the signed-in person |

Routes are served by a `page_renderer` (see `hooks.py`). Access tokens are HMAC-SHA256 over user, file, write right and expiry, keyed with the site's encryption key; a token opens only its own file. `X-WOPI-Proof` / `X-WOPI-ProofOld` are verified against the `proof-key` in discovery.

## Checked on

Frappe 15.97 (ERPNext v15.95 image) + SumOffice stack, 25.09.2026:

- `approved_macro_demo.xlsm` attached to a Note: the link appears in the sidebar, the file opens in SumSheet, a cell is edited, **Ctrl+S**. The Frappe file gets the new contents; `vbaProject.bin` is byte-identical to the original.
- `images.docx`: edited in SumDoc and saved; all five images are byte-identical.
- WOPI calls: CheckFileInfo, Lock, GetFile, PutFile, Unlock — all `200` with proof verification on.
- Refusals: no proof → `500`, forged proof → `500`, a token for another file → `401`, a broken token → `401`.
