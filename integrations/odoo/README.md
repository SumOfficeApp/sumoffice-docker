# SumOffice for Odoo

Odoo module `sumoffice_wopi` (Odoo 18). Adds an **Open in SumOffice** button to `.xlsx`, `.xlsm`, `.xlsb` and `.docx` attachments in the chatter. The file opens in SumSheet (Excel-compatible) or SumDoc (Word-compatible); **Ctrl+S** saves it back into the same attachment.

Odoo is the WOPI host, SumOffice is the WOPI client. The file never leaves Odoo storage except to be edited, and every call runs as the person who opened it — Odoo access rules apply as usual.

## Install

1. Run a SumOffice stack (see `../../nextcloud` or `../../standalone`). Note its discovery URL, e.g. `https://office.example.com/hosting/discovery`.
2. Put `sumoffice_wopi` into your addons path and install **SumOffice for Odoo**.
3. Settings → SumOffice → **Discovery URL**. Keep **Verify proof keys** on.
4. On the SumOffice side, allow your Odoo host: `WOPI_ALLOW=odoo.example.com` (SumSheet) and `--wopi-hosts https://odoo.example.com` (SumDoc).

`web.base.url` must be the address the SumOffice servers use to reach Odoo (it goes into `WOPISrc`), and Odoo must run with `proxy_mode` behind a TLS proxy.

## What it implements

| WOPI operation | Route | Notes |
|---|---|---|
| CheckFileInfo | `GET /wopi/files/<id>` | name, size, version (checksum), user, write right |
| GetFile | `GET /wopi/files/<id>/contents` | |
| PutFile | `POST /wopi/files/<id>/contents` | only under the editor's lock; a mismatched lock is `409` |
| Lock / Unlock / RefreshLock / GetLock | `POST /wopi/files/<id>` | 30-minute locks in `sumoffice.lock` |

- Access token: HMAC-SHA256 over user, attachment, write right and expiry, keyed with `database.secret`. A token opens only its own attachment.
- Proof keys: `X-WOPI-Proof` / `X-WOPI-ProofOld` are verified against the `proof-key` in discovery (current and old key, 20-minute timestamp window). A call SumOffice did not sign is refused.
- Write right is Odoo's own: the token carries the right the person had when opening, and every write re-checks `ir.attachment` write access.

## Checked on

Odoo 18.0 Community + SumOffice stack, 25.09.2026:

- `approved_macro_demo.xlsm`: the button appears in the chatter, the file opens in SumSheet, a cell is edited, **Ctrl+S**. The attachment gets the new contents; `vbaProject.bin` is byte-identical to the original.
- `images.docx`: edited in SumDoc and saved; all five images (wmf, png, 2×emf, jpeg) are byte-identical.
- WOPI calls: CheckFileInfo, Lock, GetFile, PutFile, Unlock — all `200` with proof verification on.
- Refusals: no proof → `500`, forged proof → `500`, a token for another attachment → `401`, a broken token → `401`.
