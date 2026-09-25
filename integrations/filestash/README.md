# SumOffice with Filestash

Filestash has a built-in WOPI host (`plg_editor_wopi`). It reads a WOPI discovery document and hands Office files to the editor it lists, so SumOffice plugs in with configuration only: no plugin to install.

## Configure

Point Filestash's office feature at SumOffice's discovery. It uses the base URL; Filestash appends `/hosting/discovery` itself:

```yaml
services:
  filestash:
    image: machines/filestash:latest
    environment:
      APPLICATION_URL: files.example.com
      OFFICE_URL: https://office.example.com            # SumOffice; Filestash reads /hosting/discovery
      OFFICE_FILESTASH_URL: https://files.example.com   # how SumOffice reaches Filestash
      # OFFICE_REWRITE_URL: https://office.example.com  # only if OFFICE_URL is an internal address
```

The same settings are in Admin → Settings → Features → Office (`office_server`, `filestash_server`, `rewrite_discovery_url`).

On the SumOffice side, allow the Filestash host:
- SumSheet: `WOPI_ALLOW=files.example.com`
- SumDoc: `--wopi-hosts https://files.example.com`

## What works, what doesn't

- **`.xlsx` and `.docx`:** a click on the file in Filestash opens it in SumSheet or SumDoc for editing, and **Ctrl+S** writes it back to the storage.
- **`.xlsm` and `.xlsb` are not in Filestash's list of Office types**, so its file view does not offer them to the editor. The WOPI path itself works for them: opened through `/api/wopi/iframe?path=/book.xlsm`, the round succeeds and the macros are kept. This is a one-line change on Filestash's side (its Office mime list), not on ours.
- **No locks.** Filestash's WOPI host has no LOCK/UNLOCK and answers them with `404`. SumOffice still saves, but two people editing the same file at the same time are not protected by a lock.
- **Proof keys.** Filestash does not verify them, and its CheckFileInfo reports every user as `Unknown`.

## Checked on

Filestash (Docker `machines/filestash:latest`, 25.09.2026), local storage backend, SumOffice stack:

- **`approved_macro_demo.xlsm`**, through the WOPI iframe. A cell was edited and saved with **Ctrl+S**. The file on disk has the new value, and `vbaProject.bin` is byte-identical to the original.
- **`images.docx`**, from Filestash's file view. The text was edited and saved; all five images are byte-identical.
- **`kniga.xlsx`** opens from the file view in SumSheet's edit mode.
