# SumOffice with EGroupware

EGroupware's **Collabora** app (`collabora`, shipped in the EGroupware Docker image) is a WOPI host. It reads a WOPI discovery document and opens Office files from the Filemanager in the editor it lists, so SumOffice plugs in with configuration only.

## Configure

1. Admin → Applications → Collabora → Site configuration, set **Collabora server** to `https://office.example.com`. EGroupware fetches `/hosting/discovery` itself.
2. EGroupware's WOPI endpoints are `https://<egroupware>/egroupware/collabora/index.php/wopi/files/{id}`.

On the SumOffice side, allow the EGroupware host:
- SumSheet: `WOPI_ALLOW=groupware.example.com`
- SumDoc: `--wopi-hosts https://groupware.example.com`

Two notes from the stand:

- **Private CA.** If SumOffice uses a private certificate, add its CA to the `egroupware` (php-fpm) container: EGroupware fetches discovery server-side. If the first fetch fails, EGroupware caches the failure for an hour, so restart php-fpm after fixing it.
- **Only the first zone.** EGroupware reads only the first `<net-zone>` of discovery. SumOffice lists every file type there already, so no action is needed.

## Checked on

EGroupware (Docker `egroupware/egroupware:latest`, 25.09.2026, minimal stack: php-fpm, nginx, MariaDB) + SumOffice stack:

- **`approved_macro_demo.xlsm`.** The file was opened through the Collabora app's editor (`Ui.editor`, from Filemanager) and a cell was edited, then saved with **Ctrl+S**. The file in EGroupware's VFS has the new value, and `vbaProject.bin` is byte-identical to the original.
- **`images.docx`.** The text was edited and saved; all five images are byte-identical.
