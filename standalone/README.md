# One editor on your server, without Nextcloud

Each image is a complete web editor: the engine, the page, everything it needs. One process ("cabin") per user and document; the browser talks to it over WebSocket. Files and accounts stay in your system — the server asks it for them.

Requirements: Linux x86-64 or arm64, Docker; 2 GB RAM for the server plus ~250 MB per open document; a reverse proxy with WebSocket support if the server faces the internet.

```sh
# SumSheet (Excel-compatible; keeps VBA and Power Query)
docker run -d --name sumsheet --restart unless-stopped \
  -p 127.0.0.1:8092:8092 -v /srv/sumsheet-cabins:/data/cabins \
  hissih/sumsheet-webhost:latest \
  --base-path /f1 --max-cabins 12 --idle-min 20 \
  --auth-url   'https://your-system/v1/me' \
  --attach-url 'https://your-system/v1/attachments/{id}/content'

# SumDoc (Word-compatible; DOCX round-trip)
docker run -d --name sumdoc --restart unless-stopped \
  -p 127.0.0.1:8090:8090 -v /srv/sumdoc-cabins:/data/cabins \
  hissih/sumdoc-webhost:latest \
  --base-path /a4 --max-cabins 12 --idle-min 20 \
  --auth-url   'https://your-system/v1/me' \
  --attach-url 'https://your-system/v1/attachments/{id}/content'
```

Check: `curl http://127.0.0.1:8092/f1/health` (and `/a4/health`) — the answer contains `"status": "ok"` and `"skewMin": 0`; the second means the editor and the engine are from the same release.

`--auth-url` is asked with the user's cookie and must answer 200 for a signed-in user; `--attach-url` returns the file bytes by id. That is the whole contract — the editors have no user database of their own. Integration details: https://docs.sumoffice.com
