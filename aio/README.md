# SumOffice in one container

One image with both editors and the joint WOPI discovery, for platforms that run a single container per app
(Nextcloud AIO community containers, CasaOS and similar app stores).

| Path | What |
|---|---|
| `/f1` | SumSheet — Excel workbooks (`.xlsx`, `.xlsm`, `.xlsb`) |
| `/a4` | SumDoc — Word documents (`.docx`) |
| `/hosting/discovery`, `/hosting/capabilities` | WOPI discovery for both editors (also the SharePoint `internal-https` zone over https) |

## Build

```sh
docker build -t sumoffice-aio aio/ \
  --build-arg SUMSHEET_IMAGE=hissih/sumsheet-webhost:<tag> \
  --build-arg SUMDOC_IMAGE=hissih/sumdoc-webhost:<tag>
```

## Run

```sh
docker run -d --name sumoffice -p 8093:8093 -v sumoffice:/data \
  -e PUBLIC_URL=https://office.example.com \
  -e NEXTCLOUD_HOST=cloud.example.com \
  sumoffice-aio
```

Put your TLS reverse proxy in front of `:8093` (`https://office.example.com` → `127.0.0.1:8093`, WebSocket upgrades on).
In Nextcloud: Administration settings → Office → Use your own server → `https://office.example.com`.

| Variable | Meaning |
|---|---|
| `PUBLIC_URL` | address the browser uses to reach the editors (required) |
| `NEXTCLOUD_HOST` | host name of the file storage allowed to open files (required) |
| `NEXTCLOUD_URL` | full origin of the storage, default `https://$NEXTCLOUD_HOST` |
| `MAX_CABINS` | open documents per editor, default 8 |

`/data` keeps the editors' workspace and the WOPI proof key. Both editors sign with this one key: a storage that
verifies signatures (ownCloud Infinite Scale, OpenCloud, SharePoint) knows only the key published in discovery.
If any process in the container exits, the container exits, so `--restart unless-stopped` brings it back whole.
