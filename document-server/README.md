# Self-hosted SumOffice document server

This stack is for organisations whose existing connector speaks the compatible
document-server API. It keeps the connector and replaces the document-server address.
The stack contains DocsAPI, SumSheet, SumDoc, read-only previews, and a single public
front. Files and JWT secrets stay on your server.

## Install

Requirements: Linux x86-64 with Docker Compose, at least 4 GB RAM plus about 250 MB
per open document, a DNS name, and TLS on your reverse proxy. This release is
`linux/amd64`; arm64 is not included.

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

The 27 September images were built from the exact revisions listed in the repository
root README. The editor images were run as `linux/amd64`; XLSM and DOCX completed a
two-person Nextcloud 31 round trip, the XLSM kept its VBA project byte-for-byte, and
the returned files opened in Microsoft Excel and Word without repair dialogs. The
DocsAPI root and `api.js` endpoints were also run locally. Connector-specific flows
outside Nextcloud still require their own acceptance run.

Power Query is preserved but not refreshed in the browser editor. Excel-bridge macros
(COM automation and some ActiveX) still run only in desktop Excel.
