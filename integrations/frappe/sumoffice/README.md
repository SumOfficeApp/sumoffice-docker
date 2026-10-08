# SumOffice for Frappe / ERPNext

Frappe app `sumoffice` (Frappe 15, works with ERPNext). Adds a **SumOffice** link next to `.xlsx`, `.xlsm`, `.xlsb`, `.docx` and `.pptx` attachments in the form sidebar of any document. The file opens in SumSheet (Excel-compatible), SumDoc (Word-compatible) or SumSlide (PowerPoint-compatible); **Ctrl+S** saves it back into the same Frappe `File`.

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

## Store listing (Frappe Cloud marketplace)

Everything the marketplace form asks for. The wording is the one SumOffice uses in every catalogue
(`integrations/_store/LISTING.md`); the images live there too.

* **App name:** SumOffice · **Version:** 1.1.0 (`pyproject.toml`, `sumoffice/__init__.py`)
* **Publisher:** SumOffice — https://sumoffice.com — hello@sumoffice.com
* **Logo:** `sumoffice/public/images/sumoffice-icon.png` (512×512, served at
  `/assets/sumoffice/images/sumoffice-icon.png`, declared as `app_logo_url` in `hooks.py`)
* **Screenshots:** `integrations/_store/screenshot-workbook.png`, `integrations/_store/screenshot-document.png`
* **Category:** Integrations · **Price:** free listing; licensing answered by e-mail
* **Support e-mail:** hello@sumoffice.com

**Short description (≤ 120 characters)**

> Open and edit Excel, Word and PowerPoint files in place — macros and pictures come back intact.

**Summary**

> Excel, Word and PowerPoint files keep working — macros, Power Query, files back intact — with the
> SumOffice editors as your Office server.

**Full description**

> SumOffice opens the office files you already store in Frappe — `.xlsx`, `.xlsm`, `.xlsb`, `.docx`
> and `.pptx` — in the browser, and saves them back into the same `File`. The macro project travels
> with the workbook byte for byte, and the pictures of a document come back byte for byte.
>
> Nothing leaves your system: the editors run on a server you control, the file stays where it was,
> and every read and write happens with the rights of the person who opened it. Connection is over
> WOPI — the same protocol the big office suites use — with signed access tokens and verified proof
> keys.
>
> **What you need:** a SumOffice server reachable by the browser and by your Frappe site, and one
> setting: its address.
>
> Questions and licensing: hello@sumoffice.com

Publishing itself is the owner's step: this repository prepares the app, it does not submit it.

## Checked on

Frappe 15 (`frappe/erpnext:v15.95.0`) + SumOffice stack, 08.10.2026 — round on healthy files
(`integrations/PROTOCOL-2026-10-08-healthy-file.md`):

- `vba-web-blank.xlsm` (macro-enabled) attached to a Note: the file opens from
  `/sumoffice/open/<File>`, a cell is edited, **Ctrl+S**. The Frappe file gets the new contents
  (238 552 → 224 567 B) and `xl/vbaProject.bin` is byte-identical (`721985bb…`). Excel opens the
  returned file without repair.
- `word-open-control-sheet.docx`: edited in SumDoc and saved; Word opens it without repair.
- `document-identity.powerpoint-mac.pptx`: a text box added in SumSlide and saved; PowerPoint
  opens it without repair. `.pptx` is new in app version 1.1.0.
- WOPI calls: CheckFileInfo, Lock, GetFile, PutFile — all `200` with proof verification on.
- Refusals, measured 25.09 and not re-measured on 08.10: no proof → `500`, forged proof → `500`,
  a token for another file → `401`, a broken token → `401`.

**Fixed during that round:** the editor sends its access token both in the query string and as
`Authorization: Bearer`. Frappe read the header as an OAuth token of its own and answered 401 from
`validate_auth`, before this app's renderer ran — every file opened to "WOPI host did not confirm
access to the file (401)". The app now drops that header on its own two routes
(`before_request` → `sumoffice.wopi.ignore_bearer_on_wopi_routes`); the query token, checked
together with the proof keys, stays the authority.

The 25.09 round was driven with `approved_macro_demo.xlsm`, a package without a root `_rels/.rels`
and without `docProps`: Excel offers to repair it before showing anything, so that round could not
prove what it claimed. It is not used any more.
