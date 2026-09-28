# Self-hosted SumOffice document server

This stack is for organisations whose existing connector speaks the compatible
document-server API. It keeps the connector and replaces the document-server address.
The stack contains DocsAPI, SumSheet, SumDoc, read-only previews, and a single public
front. Files and JWT secrets stay on your server.

## Install

Requirements: Linux x86-64 with Docker Compose, at least 4 GB RAM plus about 250 MB
per open document, a DNS name, and TLS on your reverse proxy. This release is
`linux/amd64`; arm64 is not included, and `latest` is a single `linux/amd64`
image rather than a multi-architecture list.

```sh
git clone https://github.com/SumOfficeApp/sumoffice-docker
cd sumoffice-docker/document-server
cp env.example .env
# Set PUBLIC_URL and a long random DOCSAPI_JWT_SECRET in .env.
mkdir -p proof
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out proof/proof-key.pem
python3 -c "import json;p=open('proof/proof-key.pem').read();json.dump({'current':{'privatePem':p},'old':{'privatePem':p}},open('proof/wopi-proof.json','w'))"
chmod 600 proof/*
docker compose up -d
```

Route `PUBLIC_URL` to `127.0.0.1:8130` with WebSocket upgrade enabled and a request
body limit of at least 200 MB. In the connector, set the document-server address to
`PUBLIC_URL` and the secret key to `DOCSAPI_JWT_SECRET`.

Check the public endpoint:

```sh
curl -fsS "$PUBLIC_URL/healthcheck"
```

It must answer `true`. The exact image tags are deliberately pinned in the compose
file so an installation does not change on the next `docker pull`.

## Measured scope

The 28 September editor images were built from the revisions listed in the repository
root README and run as `linux/amd64`. What was actually measured on Nextcloud 31.0.14
with its own Office connector, and what was not, stated separately:

- **XLSM, two different people in one workbook:** both edits arrived in the file on
  the server, and the VBA project came back byte-for-byte identical. The same round
  on the previous images did not get that far — the editor did not accept input,
  and the file on the server was rewritten without either edit.
- **DOCX, one person:** the edit arrived in the file, all five embedded images
  survived, the package stayed valid. **Two people in one DOCX was not measured**, so
  this release makes no claim about simultaneous Word editing.
- Package integrity of both returned files was checked directly: parts count
  unchanged, embedded media intact, ZIP structure valid, VBA project identical.
  **Opening the returned files in desktop Excel and Word was not repeated for this
  release** — the desktop probe could not be run on the build machine, so no claim
  about the repair dialog is made here.
- DocsAPI answered on its API entry point locally. Connector-specific flows outside
  Nextcloud still require their own acceptance run.

Power Query is preserved but not refreshed in the browser editor. Excel-bridge macros
(COM automation and some ActiveX) still run only in desktop Excel.

## Running DocsAPI without Docker

DocsAPI is a plain Node service: no dependencies to install, Node 20 or newer, one
entry point. Use this when the document server must run outside Docker — a package
built for your own distribution, or a host where Docker is not allowed.

```sh
tar xzf sumoffice-docsapi-<version>.tar.gz -C /opt/sumoffice-docsapi
cd /opt/sumoffice-docsapi
export DOCSAPI_PUBLIC_URL="https://docs.example.org"
export DOCSAPI_JWT_SECRET="<the same secret your connector uses>"
export DOCSAPI_DISCOVERY_URLS="http://127.0.0.1:8093/hosting/discovery"
export DOCSAPI_WOPI_BASE="http://127.0.0.1:8797"
export DOCSAPI_DATA_DIR=/var/lib/sumoffice-docsapi
node index.mjs
```

It listens on `PORT` (8797 by default). The editors it drives — SumSheet and SumDoc —
still have to be reachable at the discovery address above; DocsAPI itself renders
nothing.

As a systemd unit:

```ini
[Unit]
Description=SumOffice DocsAPI
After=network-online.target

[Service]
WorkingDirectory=/opt/sumoffice-docsapi
EnvironmentFile=/etc/sumoffice-docsapi.env
ExecStart=/usr/bin/node index.mjs
Restart=on-failure
User=sumoffice
StateDirectory=sumoffice-docsapi

[Install]
WantedBy=multi-user.target
```

Check it the same way as the Docker stack — `curl -fsS "$PUBLIC_URL/healthcheck"`
must answer `true`. Note that health is computed from a fresh WOPI discovery: with no
editors wired yet the endpoint answers `503`, which means "no editors", not "broken".
