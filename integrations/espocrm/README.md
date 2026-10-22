# SumOffice for EspoCRM

EspoCRM extension for EspoCRM 9.0 and later (checked on 9.2.4 and 10.0.10). Adds **Open in SumOffice** next to the file of a Document when it is `.xlsx`, `.xlsm`, `.xlsb`, `.docx` or `.pptx`. The file opens in SumSheet, SumDoc or SumSlide; **Ctrl+S** saves it back into the same EspoCRM file.

EspoCRM is the WOPI host, SumOffice is the WOPI client. Every call runs with the rights of the person who opened the file: reads need access to the attachment, writes need edit access to the Document.

## Install

1. Download `sumoffice-espocrm-1.0.3.zip` from the release
   (or build it: `./build-package.sh`, then `shasum -a 256 -c dist/SHA256SUMS`).
2. Back up the EspoCRM database and `data/` according to your normal policy.
3. In EspoCRM open **Administration → Extensions**, upload the ZIP and press **Install**.
   To upgrade, install the new ZIP over the old one — no need to uninstall first.
   From a shell: `php command.php extension --file=/path/to/sumoffice-espocrm-1.0.3.zip`.
4. Open **Administration → SumOffice**, enter the **Discovery URL** of your SumOffice stack
   (for example `https://office.example.com/hosting/discovery`), press **Save**, then
   **Check connection**. The check says which file types the stack opens.

No `data/config.php` editing is needed any more; the page writes `sumofficeDiscoveryUrl`,
`sumofficeVerifyProof` (on by default) and `sumofficeCaBundle` (only for a certificate from a
private CA). Do not turn proof verification off in production.

On the SumOffice side allow your EspoCRM host: `WOPI_ALLOW=crm.example.com` (SumSheet),
`--wopi-hosts https://crm.example.com` (SumDoc). With the `sumoffice-docker/nextcloud` stack
that is `NEXTCLOUD_URL=https://crm.example.com` and `NEXTCLOUD_HOST=crm.example.com` in `.env`.
`siteUrl` in EspoCRM must be the address the SumOffice servers use to reach EspoCRM.

Put the editors on the same site as EspoCRM (`office.example.com` next to `crm.example.com`,
or both behind one address): the editor keeps its session in a cookie, and on a different site
that cookie is third-party and Safari or a private Chrome window blocks it.

## What it implements

| WOPI operation | Route |
|---|---|
| CheckFileInfo | `GET /api/v1/SumOffice/wopi/files/{attachmentId}` |
| GetFile | `GET /api/v1/SumOffice/wopi/files/{attachmentId}/contents` |
| PutFile | `POST /api/v1/SumOffice/wopi/files/{attachmentId}/contents` — only under the editor's lock |
| Lock / Unlock / RefreshLock / GetLock | `POST /api/v1/SumOffice/wopi/files/{attachmentId}` — 30-minute locks |
| Open | `?entryPoint=sumOfficeOpen&id={attachmentId}` — for the signed-in person, in their EspoCRM language |
| Check | `GET /api/v1/SumOffice/check` — administrators only, used by the settings page |

- Access token: HMAC-SHA256 over user, attachment, write right and expiry, keyed with the installation's `cryptKey`. A token opens only its own attachment.
- Proof keys: `X-WOPI-Proof` / `X-WOPI-ProofOld` are verified against the `proof-key` in discovery (current and old key, 20-minute timestamp window).
- The Document file field also accepts `.xlsm` and `.xlsb` (EspoCRM's default list does not).
- After a save the Document shows the new **Modified** time and the person who saved.
- The same person reopening a file (closed tab, reload) takes over their own earlier lock instead
  of getting an editor that cannot save; another person's lock is still refused (`409`).

## Acceptance after installation

Use copies of one XLSM, one DOCX, and one PPTX:

1. Create an EspoCRM Document for each file and record its SHA-256.
2. Use **Open in SumOffice**, make a visible edit, press **Ctrl+S**, and close
   the editor tab.
3. Download the same EspoCRM file again. Its SHA-256 must differ and the marker
   must be present inside `xl/`, `word/`, or `ppt/` XML respectively.
4. For XLSM, `xl/vbaProject.bin` must remain byte-identical.
5. Open the returned files in Excel, Word, and PowerPoint. A repair prompt is a
   failed round, not a warning.

The package build does not replace this live round.

## Checked on

EspoCRM 10.0.10 (Docker `espocrm/espocrm:10.0.10`, MariaDB 11.8) + the `sumoffice-docker/nextcloud`
stack of `main` (SumSheet 2026.10.19, SumDoc 2026.10.01, SumSlide 2026.10.07), 22.10.2026,
installed through Administration → Extensions as a customer would:

- `.docx`, `.xlsx`, `.pptx`, `.xlsm`: opened from the Document, edited, **Ctrl+S**; the file of the
  same Document is a new version with the edit inside, and the Document shows Modified / Modified by.
- `.xlsm`: `xl/vbaProject.bin` byte-identical after the save; the form button kept.
- 1.0.2 → 1.0.3 upgrade over the installed package; settings page, Check connection, proof on.
- PHP: `test/action-url.test.php` (language in the editor address).

EspoCRM 9.2.4 + SumOffice stack, 25.09.2026:

- `approved_macro_demo.xlsm`: the button appears on the Document, the file opens in SumSheet, a cell is edited, **Ctrl+S**. The EspoCRM file gets the new contents; `vbaProject.bin` is byte-identical to the original.
- `images.docx`: edited in SumDoc and saved; all five images are byte-identical.
- WOPI calls: CheckFileInfo, Lock, GetFile, PutFile — all `200` with proof verification on.
- Refusals: no proof → `500`, forged proof → `500`, a token for another attachment → `401`, a broken token → `401`.
