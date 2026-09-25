# SumOffice with Group-Office

Group-Office 26 has a WOPI host in its free (community) edition: the module `community/wopi`, shown as "Office Online" in System Settings. It reads any WOPI discovery document, so SumOffice plugs in with configuration only.

## Configure

1. System Settings → Modules → install **Office Online** (`community/wopi`) if it isn't installed yet.
2. System Settings → Office Online → **+**, then enter the SumOffice base URL: `https://office.example.com`. Group-Office fetches `/hosting/discovery` itself. It lists the service as "Office Online" and maps `.xlsx`, `.xlsm`, `.xlsb` and `.docx` to SumSheet and SumDoc.
3. Group-Office's WOPI endpoints are `https://<group-office>/wopi/files/{id}`. If SumOffice reaches Group-Office by another address, set it in the service's WOPI client URL.

On the SumOffice side, allow the Group-Office host:
- SumSheet: `WOPI_ALLOW=groupware.example.com`
- SumDoc: `--wopi-hosts https://groupware.example.com`

If SumOffice uses a private certificate, add its CA to the Group-Office container (`/usr/local/share/ca-certificates/` + `update-ca-certificates`): Group-Office fetches discovery server-side.

## Needs SumOffice with the multipart form fix

Group-Office posts the access token to the editor as `multipart/form-data`, which Office Online also accepts. Older SumOffice builds read only `application/x-www-form-urlencoded`, so they answer "Incomplete WOPI request" / "нужны WOPISrc и access_token".
- Group-Office needs SumSheet and SumDoc images built after 25.09.2026, which include the multipart form fix.

## Checked on

Group-Office 26.0 (Docker `intermesh/groupoffice:26.0`, community modules, no licence) + SumOffice stack with the fix, 25.09.2026:

- **`approved_macro_demo.xlsm`.** The file was opened from Group-Office Files and a cell was edited, then saved with **Ctrl+S**. The file in Group-Office storage has the new value, and `vbaProject.bin` is byte-identical to the original.
- **`images.docx`.** The text was edited and saved; all five images are byte-identical.
- **Locks.** Group-Office implements LOCK/UNLOCK/REFRESH_LOCK/GET_LOCK, and the editor took and kept the lock.
