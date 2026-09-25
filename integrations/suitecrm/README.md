# SumOffice for SuiteCRM

A SuiteCRM Module Loader package, tested on SuiteCRM 8. Everything it adds is in the legacy layer that SuiteCRM 7.x shares; 7.x itself has not been tested. It adds an **Open in SumOffice** field to a Document whose file is `.xlsx`, `.xlsm`, `.xlsb` or `.docx`. The file opens in SumSheet (Excel-compatible) or SumDoc (Word-compatible), and **Ctrl+S** saves it back into the same document revision.

SuiteCRM is the WOPI host and SumOffice is the WOPI client. Every call runs with the rights of the person who opened the file: reading needs view access to the Document, and saving needs edit access.

## Build and install

```bash
cd integrations/suitecrm/package
zip -r ../sumoffice-suitecrm.zip manifest.php files
```

To install, go to Admin → Module Loader and upload `sumoffice-suitecrm.zip`, then run Admin → Repair → Quick Repair and Rebuild.

Next, add these lines to `config_override.php` (in SuiteCRM 8 it lives in `public/legacy/`):

```php
$sugar_config['sumoffice_discovery_url'] = 'https://office.example.com/hosting/discovery';
// $sugar_config['sumoffice_verify_proof'] = true;   // default
// only if the SumOffice server uses a private certificate:
// $sugar_config['sumoffice_ca_bundle'] = '/etc/ssl/certs/ca-certificates.crt';
```

On the SumOffice side, allow your SuiteCRM host:
- SumSheet: `WOPI_ALLOW=crm.example.com`
- SumDoc: `--wopi-hosts https://crm.example.com`

`site_url` must be the address the SumOffice servers use to reach SuiteCRM.

The package ships `custom/modules/Documents/metadata/detailviewdefs.php`, the stock Document detail layout with the new field in the empty row. If your Document layout was already customised in Studio, add the `sumoffice_link` field there instead.

## What it implements

| WOPI operation | Route (under `public/legacy/`) |
|---|---|
| CheckFileInfo | `GET sumoffice_wopi.php/{revisionId}` |
| GetFile | `GET sumoffice_wopi.php/{revisionId}/contents` |
| PutFile | `POST sumoffice_wopi.php/{revisionId}/contents`, accepted only under the editor's lock |
| Lock / Unlock / RefreshLock / GetLock | `POST sumoffice_wopi.php/{revisionId}`, 30-minute locks |
| Open | `index.php?entryPoint=sumofficeOpen&record={revisionId}` for the signed-in person |

- **Access token.** An HMAC-SHA256 over the user, the revision, the write right and the expiry, keyed with the installation's `unique_key`. A token opens only its own revision.
- **Proof keys.** `X-WOPI-Proof` and `X-WOPI-ProofOld` are checked against the `proof-key` in discovery: current and old key, with a 20-minute timestamp window.
- **Where the file lives.** It is `upload/{revisionId}`, the same file SuiteCRM's own download serves.

## Checked on

Tested on SuiteCRM 8.9.1 (PHP 8.3) with the SumOffice stack, 25.09.2026:

- **`approved_macro_demo.xlsm`.** The field shows on the Document card and the file opens in SumSheet. A cell was edited and saved with **Ctrl+S**. The revision file got the new contents, and `vbaProject.bin` is byte-identical to the original.
- **`images.docx`.** Edited in SumDoc and saved; all five images are byte-identical.
- **Proof checks on.** Both files were edited and saved with proof verification turned on.
- **Refusals.**
  - no proof → `500`
  - forged proof → `500`
  - a token for another revision → `401`
  - a broken token or no token → `401`
  - a path outside `{revisionId}[/contents]` → `404`
