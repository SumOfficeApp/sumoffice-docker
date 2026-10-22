# SumOffice next to Collabora in Nextcloud Office

Macro workbooks (`.xlsm`) open in **SumSheet**; every other format (`.docx`, `.xlsx`,
`.pptx`, `.odt`, `.ods`, `.xlsb` …) keeps opening in the **Collabora** you already run.
`.xlsb` can be routed too (`ROUTE_EXTS`), see Limits. Nextcloud,
Nextcloud Office (richdocuments) and Collabora are not modified — Nextcloud Office is pointed
at one new address, nothing else.

```
browser ── Nextcloud Files ── Nextcloud Office (richdocuments)
                                   │ wopi_url / public_wopi_url
                                   ▼
                        front (nginx, this stack, ONE origin)
             /hosting/discovery ─▶ route: Collabora's discovery,
                                   .xlsm urlsrc → /sheets/
             /sheets/…          ─▶ SumSheet
             everything else    ─▶ your Collabora (/browser, /cool WebSocket,
                                   /hosting/capabilities …), proxied unchanged
```

Why one front: Nextcloud Office reads **one** discovery from **one** `wopi_url`, and Nextcloud's
Content-Security-Policy lets the editor frame load from exactly **one** origin
(`public_wopi_url`). So both editors have to live under one address.

Why the proof key: whenever discovery carries a `<proof-key>`, Nextcloud Office verifies the
`X-WOPI-Proof` signature of every WOPI call and rejects calls that do not verify (richdocuments
9.2.3, `lib/Middleware/WOPIMiddleware.php`; on the stand a SumSheet with another key gets
"Invalid WOPI proof" and "Document loading failed"). The routed discovery carries Collabora's key
unchanged, so SumSheet signs with **Collabora's own private key**. The `collabora/code` image
ships without a key (its discovery then has none and nothing is verified); package installs
of Collabora generate one (`coolwsd-generate-proof-key`).

## Enable it at a customer with a working Collabora (about 10 minutes)

On a Docker host that can reach Collabora and that Nextcloud can reach:

```sh
git clone https://github.com/SumOfficeApp/sumoffice-docker && cd sumoffice-docker/nextcloud-side-by-side
cp .env.example .env              # PUBLIC_URL, COLLABORA_URL, COLLABORA_HOST_HEADER, NEXTCLOUD_HOST
# 1. SumSheet signs with Collabora's key:
./take-collabora-proof-key.sh <collabora-container>      # Collabora in Docker on this host
#   or copy /etc/coolwsd/proof_key from the Collabora host and run
./take-collabora-proof-key.sh --file ./proof_key
docker compose up -d
curl -s http://127.0.0.1:8093/hosting/discovery | grep -c sheets/wopi   # ≥ 2
```

2. Put your TLS reverse proxy in front of `127.0.0.1:8093` (e.g. `https://office.example.com`).
3. In Nextcloud (or with the SumOffice app: *Administration → SumOffice → address* = `PUBLIC_URL`):

```sh
occ config:app:set richdocuments wopi_url        --value https://office.example.com
occ config:app:set richdocuments public_wopi_url --value https://office.example.com
occ richdocuments:activate-config            # add --callback-url=… if you use wopi_callback_url:
                                             # activate-config resets it to "autodetect" otherwise
```

   Without a distributed memcache (Redis) Nextcloud Office keeps discovery in APCu, which `occ`
   does not share with the web server: restart PHP (Apache / php-fpm) or wait up to an hour.

4. Collabora: its WOPI host allow list (`aliasgroup1` / `storage.wopi.host`) and `frame_ancestors`
   stay as they are — Collabora still talks to the same Nextcloud and is still framed by it.

To go back: set `wopi_url` / `public_wopi_url` to Collabora's address again and run
`occ richdocuments:activate-config`.

## Settings

| Variable | Meaning |
|---|---|
| `PUBLIC_URL` | Address of this front; Nextcloud Office's `wopi_url` and `public_wopi_url`. |
| `COLLABORA_URL` | Where the front reaches Collabora: `http://collabora:9980`, a LAN address or `https://collabora.example.com`. |
| `COLLABORA_HOST_HEADER` | Host header for Collabora. Default `$http_host` (the front's name). Set Collabora's public hostname when `COLLABORA_URL` goes through Collabora's own reverse proxy. |
| `NEXTCLOUD_HOST` | Nextcloud's hostname as Collabora/SumSheet call it back (WOPISrc); no scheme, no port. |
| `ROUTE_EXTS`, `ROUTE_MIMES` | What goes to SumSheet. Default `xlsm` / `application/vnd.ms-excel.sheet.macroEnabled.12`. Add `xlsb` / `application/vnd.ms-excel.sheet.binary.macroEnabled.12` once SumSheet saves `.xlsb`. |

## Verified on the stand (22.10.2026)

Nextcloud 32 + Nextcloud Office 9.2.3 + Collabora CODE 26.04.5.1 + SumSheet 2026.10.19, through
Files in a browser (headless Chromium), Collabora with a proof key:

| File | Opens in | Ready | Save → new version |
|---|---|---|---|
| `.xlsm` | SumSheet | 4–9 s | yes, 2.8–4.2 s after Ctrl+S; `vbaProject.bin` kept |
| `.xlsm` via public link (guest) | SumSheet | 11 s incl. guest name | yes, 1.6 s |
| `.xlsx`, `.docx`, `.odt` | Collabora (through the front, Host = front) | 2.3–3.6 s | yes, 1.5–1.7 s |
| `.xlsb` (default) | Collabora, read-only ("Viewing") | 2.5 s | — |
| `.xlsb` routed to SumSheet | SumSheet | 4–14 s | **no**: "xlsb-save-current-source-only" (SumSheet 2026.10.19 and 2026.10.20b) |

## Limits (honest)

- **`.xlsb`**: SumSheet opens and edits it but cannot save it yet, and on the test file showed
  only the first column; Collabora only views it. Hence not routed by default.
- **Proof key is shared with Collabora.** If Collabora regenerates `/etc/coolwsd/proof_key`
  (new container without a persisted key), run `take-collabora-proof-key.sh` again and restart
  `sumsheet`; until then `.xlsm` calls fail with "Invalid WOPI proof". Persist the key file.
- **One file, one editor.** A given `.xlsm` always opens in SumSheet, for everybody; there is no
  per-user or "open with Collabora instead" choice inside Nextcloud Office.
- **Collabora updates** are transparent (we proxy whatever Collabora serves and re-read its
  discovery on every fetch). Nextcloud Office caches discovery; after changing anything run
  `occ richdocuments:activate-config` (and restart PHP without Redis, see above).
- **nginx**: keep every `proxy_set_header` at server level. One inside a location drops the
  inherited `Upgrade`/`Connection` and Collabora fails with "websocketproxyfailure".
- **Admin page** of Nextcloud Office shows Collabora (capabilities come from Collabora).
- **Mobile apps** (not tested on the stand) open Nextcloud Office files in a web view of the same
  editor URL; for `.xlsm` that is SumSheet's web UI, not tuned for phones, and Collabora-specific
  messages of the apps (close, share) are not all implemented.
- `.xlsm` new-file templates, "Save as" to other formats and Collabora-only features
  (e.g. Zotero, signing) do not apply to SumSheet files.

## Tests

```sh
python3 -m unittest nextcloud-side-by-side/test_route_discovery.py
```

## Demo stand

`stand/` holds a full local stand (Nextcloud 32 + Nextcloud Office + Collabora CODE + this stack,
127.0.0.1 only): see `stand/up.sh`.
