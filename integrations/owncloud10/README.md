# SumOffice with ownCloud Server 10 (Classic)

ownCloud 10's **Collabora Online** app (`richdocuments`, from the ownCloud Marketplace) is a WOPI host. Point it at SumOffice's discovery and it opens `.xlsx`, `.xlsm`, `.xlsb` and `.docx` in SumSheet and SumDoc. No separate SumOffice app is needed.

## Configure

```bash
occ market:install richdocuments
occ app:enable richdocuments
occ config:app:set richdocuments wopi_url --value https://office.example.com
```

(or Settings → Admin → Collabora Online → server URL).

On the SumOffice side, allow the ownCloud host:
- SumSheet: `WOPI_ALLOW=cloud.example.com`
- SumDoc: `--wopi-hosts https://cloud.example.com`

If SumOffice uses a private certificate, add its CA to the ownCloud container (`update-ca-certificates`): ownCloud fetches discovery server-side.

## Needs SumOffice with the numeric-permissions fix

ownCloud 10 reports `UserCanWrite` as a number (`1`/`0`) rather than `true`/`false`. Older SumDoc builds took anything but `true` as read-only, so documents opened as "editing a copy". SumSheet was not affected. Use SumDoc images built after 25.09.2026, which include the fix.

## Checked on

ownCloud Server 10.15.3 Community (Docker `owncloud/server:10.15`) + richdocuments 4.2.3 + SumOffice stack with the fix, 25.09.2026:

- **`approved_macro_demo.xlsm`.** Opened from ownCloud in SumSheet and a cell was edited, then saved with **Ctrl+S**. The file in ownCloud has the new value, and `vbaProject.bin` is byte-identical to the original.
- **`images.docx`.** Opened in SumDoc with the editor's lock taken. The text was edited and saved; all five images are byte-identical.
