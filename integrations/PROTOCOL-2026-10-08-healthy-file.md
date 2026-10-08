# Protocol — the EspoCRM and Frappe rounds re-run on healthy files

Date: 2026-10-08. Nothing was published: no image was pushed, no release was cut, no marketplace
submission was made, and no external account was created. Every stand below ran on one Mac,
bound to loopback.

## Why the round was re-run

The 25.09 rounds for EspoCRM and Frappe were driven with `approved_macro_demo.xlsm`. That sample is
**not a healthy workbook**: its package has no root `_rels/.rels` and no `docProps` part. It is the
only such file among the twelve `.xlsm`/`.xlsb` samples in the SumSheet corpus.

Measured, not assumed: opened from Excel for Mac's own Documents folder, Excel answers with the
repair prompt — "Ошибка в части содержимого в книге … Выполнить попытку восстановления?" — before
showing anything. A round that starts from a file Excel has to repair cannot prove that a saved
file opens without repair, which is exactly what the round is for.

## The files this round used

Each was opened in the real desktop application first, to establish that the starting point is
clean. The verdict comes from the application's own windows: a repair prompt is a modal dialog
with "Да"/"Нет"; the macro-trust question ("Отключить макросы"/"Включить макросы") is not a repair.

| Kind | File | SHA-256 | Starting state |
|---|---|---|---|
| `.xlsm` with a VBA project | `vba-web-blank.xlsm` (SumSheet corpus, `tests/corpus_allowlisted/github/vba-web/`) | `4f0cd9c4338951708fb80018fbca63cf6c38f1ae202b9ebd595ce6f88e892891` | opens in Excel, no repair (macro question only) |
| `.docx` | `word-open-control-sheet.docx` (SumDoc corpus) | `f3d7eeaa0bfc6717d985791bbaa149c0d7757f6ea25ad2f065af69315a47537e` | opens in Word, no repair |
| `.pptx` | `document-identity.powerpoint-mac.pptx` (SumSlide corpus, saved by PowerPoint for Mac) | `1e2e7062f84ca22d5a3b9bd03ee8779bf39e4a797fcf746ccdb0982709957ade` | opens in PowerPoint, no repair |
| control (the old sample) | `approved_macro_demo.xlsm` | `eb8b2caef7b32a50f6312b3c3c052b0f45488711fe8874ad0d076ff180e114ce` | **Excel offers repair** |

The workbook used first, `protect_macro_scl.xlsm`, opens cleanly but its sheets are protected: the
editor refused the keystroke with "the cell or chart you're trying to change is on a protected
sheet". Correct behaviour, useless for a save round — hence the blank macro-enabled workbook.

## The stand

One Mac, Docker Desktop. Three editors behind one nginx, one WOPI discovery:

| Service | Image | Address |
|---|---|---|
| SumSheet | `hissih/sumsheet-webhost:latest` | `/sheets` |
| SumDoc | `hissih/sumdoc-webhost:2026.10.01-amd64` | `/docs` |
| SumSlide | `hissih/sumslide-server:2026.10.07-amd64` | `/slides` |
| discovery + front | `python:3.12-alpine`, `nginx:1.27-alpine` | `http://127.0.0.1:8203` |
| EspoCRM | `espocrm/espocrm:9.2.4` + `mysql:8.4` | `http://127.0.0.1:8211` |

**Addressing — the part that costs a day if you get it wrong.** Two addresses are in play and they
are not interchangeable:

* the **browser** must reach the host and the editor at the *same site*, otherwise the editor's
  session cookie is a third-party cookie in the host's iframe and the page answers "Sign-in
  required" while the WOPI calls themselves succeed (the facade log shows the lock taken and the
  entry accepted). Both are on `127.0.0.1`; different ports are the same site.
* the **containers** must reach each other through `host.docker.internal`, which on Docker Desktop
  reaches services bound to the host's loopback. So `siteUrl` (which is what goes into `WOPISrc`)
  and `sumofficeDiscoveryUrl` are `host.docker.internal`, while `PUBLIC_URL` — the address the
  browser loads the editor from — is `127.0.0.1`.

A LAN address for everything also works and was tried first; loopback is better, because then no
stand port is reachable from the network.

## EspoCRM 9.2.4 — round of 2026-10-08

Extension `sumoffice-espocrm-1.0.2.zip`, rebuilt from this branch with `./build-package.sh`: the
zip and `SHA256SUMS` come out byte-identical to the committed ones (`git status` clean after the
build), installed with `php command.php extension --file=…`, `sumofficeVerifyProof` on.

| Check | `.xlsm` | `.docx` | `.pptx` |
|---|---|---|---|
| the file changed after saving | yes, `4f0cd9c4…` → `f3f542df…` (238 552 → 224 565 B) | yes, `f3d7eeaa…` → `6320f7a6…` (14 790 → 12 352 B) | yes, `1e2e7062…` → `cff5063e…` (31 649 → 30 698 B) |
| the edit is in the file | `SOESPO20261008` in the sheet | `SOESPODOC` in `word/document.xml` | `SOESPOPPT` on slide 1 |
| `xl/vbaProject.bin` byte-identical | **yes** — `721985bb…` before and after | — | — |
| parts in the package | 10 → 10 | — | 1 slide → 1 slide |
| the returned file opens in the desktop app | Excel: no repair (macro question only) | Word: no repair | PowerPoint: no repair |

Pictures: `word-open-control-sheet.docx` carries none, so this round does not re-prove the
`images.docx` result of 25.09; it proves the macro project and the three formats.

The round itself: open the Document in EspoCRM → **Open in SumOffice** → the editor opens in the
EspoCRM page → edit a cell / a line / a text box → **⌘S** → download the same EspoCRM file through
the API and compare.

## Frappe / ERPNext 15 — round of 2026-10-08

Stand: the official `pwd.yml` of `frappe/frappe_docker`, pinned to `frappe/erpnext:v15.95.0`
(arm64, native on this Mac) with `mariadb:11.8` and `redis:6.2`, site `frontend` at
`http://127.0.0.1:8212`. App `sumoffice` copied into the bench, `pip install -e`, listed in
`sites/apps.txt`, `bench --site frontend install-app sumoffice`, `sumoffice_verify_proof` on.
`bench build` needs node, which the backend image does not carry, so the app's `public/` was
copied into `sites/assets/sumoffice` — note that `sites/assets` is an **anonymous volume per
container**, so it must be placed in the frontend container as well, or the asset answers 404.

### The defect this round found: `Authorization: Bearer` is not ours to read

Opening any file answered "WOPI host did not confirm access to the file (401)" while the editor's
own log said `CheckFileInfo host.docker.internal → 401`. Measured side by side with the same,
freshly minted token:

| request | answer |
|---|---|
| `GET /wopi/files/<name>?access_token=…` | `500 proof` — the token is accepted, the call then fails the proof check (no proof headers in curl) |
| the same, plus `Authorization: Bearer <same token>` | `401`, 331 718 bytes — **Frappe's own error page** |

The editor sends the access token twice: in the query string and as `Authorization: Bearer`,
because SharePoint Server SE answers 401 without the header. Frappe reads any `Bearer` as an OAuth
token of its own in `frappe.auth.validate_auth`, finds no such token and refuses the request
*before* the app's `page_renderer` is ever reached. Nothing in the app could answer, because the
app never ran.

Fixed in the app (`sumoffice.wopi.ignore_bearer_on_wopi_routes`, registered as a `before_request`
hook, which Frappe runs just before `validate_auth`): on the two WOPI routes the header is dropped
from the request environment. The query token stays the authority — it is checked in `read_token`
together with the proof keys. After the fix the same request with the header answers `500 proof`,
exactly like the one without it, and the live round goes through.

### Results

App version 1.1.0 — `.pptx` added to the app in this change (`EXTENSIONS`, the sidebar script and
the description); the discovery already offered SumSlide, the app simply refused the extension.

| Check | `.xlsm` | `.docx` | `.pptx` |
|---|---|---|---|
| the file changed after saving | yes, `4f0cd9c4…` → `d4350f49…` (238 552 → 224 567 B) | yes, `f3d7eeaa…` → `3f2b5af0…` (14 790 → 12 353 B) | yes, `1e2e7062…` → `8363315a…` (31 649 → 30 700 B) |
| the edit is in the file | `SOFRAPPE20261008` | `SOFRAPPEDOC` | `SOFRAPPEPPT` |
| `xl/vbaProject.bin` byte-identical | **yes** — `721985bb…` before and after | — | — |
| the returned file opens in the desktop app | Excel: no repair (macro question only) | Word: no repair | PowerPoint: no repair |

## What is not claimed here

* Nothing was published anywhere; the Frappe app is *prepared* for the marketplace, not submitted.
* These are one-Mac stands on loopback, not a deployment.
* `.pptx` support in the Frappe app is new in version 1.1.0 of the app and is proven only by the
  round recorded below it.
