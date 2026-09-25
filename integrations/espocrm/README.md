# SumOffice for EspoCRM

EspoCRM extension (EspoCRM 9). Adds **Open in SumOffice** next to the file of a Document when it is `.xlsx`, `.xlsm`, `.xlsb` or `.docx`. The file opens in SumSheet (Excel-compatible) or SumDoc (Word-compatible); **Ctrl+S** saves it back into the same EspoCRM file.

EspoCRM is the WOPI host, SumOffice is the WOPI client. Every call runs with the rights of the person who opened the file: reads need access to the attachment, writes need edit access to the Document.

## Build and install

```bash
cd integrations/espocrm
zip -r sumoffice-espocrm.zip manifest.json files
```

Administration → Extensions → upload `sumoffice-espocrm.zip`, or `php command.php extension --file=sumoffice-espocrm.zip`.

Then set in `data/config.php` (or through `ConfigWriter`):

```php
'sumofficeDiscoveryUrl' => 'https://office.example.com/hosting/discovery',
'sumofficeVerifyProof' => true,
// only for a private certificate on the SumOffice side:
// 'sumofficeCaBundle' => '/etc/ssl/certs/ca-certificates.crt',
```

On the SumOffice side allow your EspoCRM host: `WOPI_ALLOW=crm.example.com` (SumSheet) and `--wopi-hosts https://crm.example.com` (SumDoc). `siteUrl` must be the address the SumOffice servers use to reach EspoCRM.

## What it implements

| WOPI operation | Route |
|---|---|
| CheckFileInfo | `GET /api/v1/SumOffice/wopi/files/{attachmentId}` |
| GetFile | `GET /api/v1/SumOffice/wopi/files/{attachmentId}/contents` |
| PutFile | `POST /api/v1/SumOffice/wopi/files/{attachmentId}/contents` — only under the editor's lock |
| Lock / Unlock / RefreshLock / GetLock | `POST /api/v1/SumOffice/wopi/files/{attachmentId}` — 30-minute locks |
| Open | `?entryPoint=sumOfficeOpen&id={attachmentId}` — for the signed-in person |

- Access token: HMAC-SHA256 over user, attachment, write right and expiry, keyed with the installation's `cryptKey`. A token opens only its own attachment.
- Proof keys: `X-WOPI-Proof` / `X-WOPI-ProofOld` are verified against the `proof-key` in discovery (current and old key, 20-minute timestamp window).
- The Document file field also accepts `.xlsm` and `.xlsb` (EspoCRM's default list does not).

## Checked on

EspoCRM 9.2.4 + SumOffice stack, 25.09.2026:

- `approved_macro_demo.xlsm`: the button appears on the Document, the file opens in SumSheet, a cell is edited, **Ctrl+S**. The EspoCRM file gets the new contents; `vbaProject.bin` is byte-identical to the original.
- `images.docx`: edited in SumDoc and saved; all five images are byte-identical.
- WOPI calls: CheckFileInfo, Lock, GetFile, PutFile — all `200` with proof verification on.
- Refusals: no proof → `500`, forged proof → `500`, a token for another attachment → `401`, a broken token → `401`.
