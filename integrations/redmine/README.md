# SumOffice for Redmine

A Redmine plugin (Redmine 5/6). It adds **Open in SumOffice** next to `.xlsx`, `.xlsm`, `.xlsb`, `.docx` and `.pptx` attachments and makes Redmine a WOPI host for them. **Ctrl+S** saves the file back into the same attachment.

## Install

```bash
unzip sumoffice-redmine-1.0.2.zip -d /path/to/redmine/plugins/
# restart Redmine
```

Then go to Administration → Plugins → SumOffice → Configure and set:
- **discovery URL:** `https://office.example.com/hosting/discovery`;
- **proof verification:** on.

On the SumOffice side, allow the Redmine host:
- SumSheet: `WOPI_ALLOW=redmine.example.com`
- SumDoc: `--wopi-hosts https://redmine.example.com`

## What it implements

| WOPI operation | Route |
|---|---|
| Open | `GET /sumoffice/open/{attachmentId}` for the signed-in person |
| CheckFileInfo | `GET /sumoffice/wopi/files/{attachmentId}` |
| GetFile / PutFile | `GET` / `POST /sumoffice/wopi/files/{attachmentId}/contents` |
| Lock / Unlock / RefreshLock / GetLock | `POST /sumoffice/wopi/files/{attachmentId}`, 30-minute locks in `Rails.cache` |

- **Rights.** Reading needs `Attachment#visible?` and writing needs `Attachment#editable?`, both for the person in the token.
- **Access token.** HMAC-SHA256 keyed with `secret_key_base`; it opens one attachment only.
- **Proof keys.** Checked against discovery: current and old key, with a 20-minute window.

## Checked on

Redmine 6.0.7 (Docker `redmine:6.0.7`, SQLite) + SumOffice stack, 03.10.2026:

- **Where the link shows.** **Open in SumOffice** appears next to the attachment on the issue page.
- **`approved_macro_demo.xlsm`.** A cell was edited and saved with **Ctrl+S**. The attachment file has the new value, and `vbaProject.bin` is byte-identical to the original.
- **`images.docx`.** The text was edited and saved; all five images are byte-identical.
- **Proof verification on.** Both rounds ran with it.
- Healthy `.docx`, `.xlsx` and `.pptx` attachments were opened from one issue in SumDoc, SumSheet and SumSlide, edited and saved back into the same attachments. All three SHA-256 values changed, all ZIP packages remained valid, and the three edit markers were found in returned OOXML. The evidence and exact hashes are recorded in [sumoffice-channels#128](https://github.com/SumOfficeApp/sumoffice-channels/pull/128).
- **Refusals.**
  - no proof or a forged one → `500`;
  - a token for another attachment, a broken token or no token → `401`;
  - the open link without a Redmine session → `403`.
