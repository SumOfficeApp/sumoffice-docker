# SumOffice for Odoo 19

Odoo module `sumoffice_wopi` **19.0.1.0.0** for Odoo 19. Same module as `../odoo` (18.0), ported to the
19 series. Adds **Open in SumOffice** to `.xlsx`, `.xlsm`, `.xlsb`, `.docx` and `.pptx` attachments in
the chatter; the file opens in SumSheet, SumDoc or SumSlide and **Ctrl+S** saves it back into the same
attachment. Install, settings and the WOPI routes are exactly as in [`../odoo/README.md`](../odoo/README.md).

Layout: one folder per Odoo series on this branch (`integrations/odoo` = 18.0, `integrations/odoo19` =
19.0). The Odoo Apps store reads a branch per series with the module at the branch root: branch
`18.0` and branch `19.0` of this repository carry the same module folder at their root.

## What changed for Odoo 19

| Odoo 19 change | In the module |
|---|---|
| Chatter attachment card lost its side column (`o-mail-AttachmentCard-aside`); actions are hover buttons (`o-mail-AttachmentButtons`) on desktop and a `getActions()` menu on mobile | template extends `o-mail-AttachmentButtons`; `attachment_list.js` patches `AttachmentList` for the mobile menu and the shared extension check |
| `_sql_constraints` is ignored (only a warning) | `models.Constraint("unique(attachment_id)")` on `sumoffice.lock` |
| `ir.attachment.check()` deprecated | `check_access(mode)` behind the same internal-user rule |
| Settings views use `<app>/<block>/<setting>` | already so since 18; inherits `base_setup.res_config_settings_view_form` unchanged |

Not affected: no `name_get`, `fields_view_get`, `_rec_name` or `type="json"` routes in the module.

## Checked on

Odoo 19.0 (`odoo:19`, `postgres:16`) + `hissih/sumsheet-webhost:latest`, 22.10.2026, proof keys **on**:

- `-i sumoffice_wopi --stop-after-init`: installs with no warning from the module; the constraint
  `sumoffice_lock_attachment_unique` exists in PostgreSQL.
- The button appears on hover on both the `.xlsx` and the `.docx` card in the chatter.
- `.xlsx` opened from the button in SumSheet, a cell edited, **Ctrl+S**: the attachment got the new
  contents (checksum changed, ZIP intact, the typed text is in the workbook). Editor calls
  CheckFileInfo, Lock, GetFile, PutFile, Unlock — all `200` with proof verification on.
- WOPI by hand for `.xlsx` and `.docx`: CheckFileInfo `200`, GetFile returns the exact bytes,
  PutFile without a lock `409`, with a wrong lock `409`, under the lock `200` and the attachment
  holds the new bytes. No proof `500`, broken token `401`, another attachment's token `401`.
- Not checked live on 19: `.docx` in SumDoc and `.pptx` in SumSlide (the stand ran SumSheet only).
