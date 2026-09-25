# SumOffice Helm chart

Status: draft, not yet submitted; needs republished multi-arch images (amd64+arm64) with the WOPI proof-key fix before submission.

SumOffice web editors for Kubernetes: **SumSheet** (Excel workbooks: `.xlsx`, `.xlsm`, `.xlsb`) and **SumDoc**
(Word documents: `.docx`) behind one origin, with a joint WOPI discovery for Nextcloud Office and other WOPI hosts.
The layout is the same as `nextcloud/docker-compose.yml` in this repository:

| Path | Component | Image |
|---|---|---|
| `/f1` | SumSheet (cabin manager + WOPI facade, port 8092) | `hissih/sumsheet-webhost` |
| `/a4` | SumDoc (port 8090) | `hissih/sumdoc-webhost` |
| `/hosting/discovery`, `/hosting/capabilities` | joint discovery (`files/discovery.py`) | `python:3.12-alpine` |
| everything, port 8093 | front (one origin) | `nginx:1.27-alpine` |

## Install

```sh
helm install sumoffice ./sumoffice \
  --set publicUrl=https://office.example.com \
  --set wopiHost.url=https://cloud.example.com \
  --set ingress.enabled=true --set ingress.className=nginx \
  --set 'ingress.hosts[0].host=office.example.com' \
  --set 'ingress.tls[0].secretName=office-tls' --set 'ingress.tls[0].hosts[0]=office.example.com'
```

Then on the Nextcloud host:

```sh
php occ config:app:set richdocuments wopi_url --value https://office.example.com
php occ config:app:set richdocuments public_wopi_url --value https://office.example.com
php occ richdocuments:activate-config
```

## Values

| Key | Default | Meaning |
|---|---|---|
| `publicUrl` | `https://office.example.com` | address the browser uses (`PUBLIC_URL`) |
| `wopiHost.url` | `https://cloud.example.com` | storage origin, SumDoc `--wopi-hosts` |
| `wopiHost.host` | host of `wopiHost.url` | SumSheet `--wopi-allow` (`WOPI_ALLOW`) |
| `maxCabins` / `idleMin` | `8` / `15` | open documents per editor / idle minutes |
| `proofKey.existingSecret` | `""` | Secret with key `proof-key.pem`; empty = chart creates one |
| `proofKey.pem` | `""` | PEM for the created Secret; empty = generated once, kept on upgrade |
| `sumsheet.*`, `sumdoc.*` | see `values.yaml` | image, resources, persistence (RWO PVC, 5Gi) |
| `ingress.*` | disabled | routes `/f1`, `/a4`, `/hosting` to the front service |

## WOPI proof key

Both editors must sign WOPI requests with the one key published in discovery. The chart keeps an RSA key in a
Secret (`<release>-sumoffice-proof-key`, annotated `helm.sh/resource-policy: keep`), mounts it read-only at
`/data/proof` in both editors and sets `SUMOFFICE_WOPI_PROOF_DIR=/data/proof`. SumDoc builds older than the shared
key read `<docs-dir>/wopi-proof.json`; an init container writes that file from the same key (the same step as
`aio/start.sh`). `genPrivateKey` produces a 4096-bit PKCS#1 PEM (`BEGIN RSA PRIVATE KEY`), while `aio/start.sh` makes a 2048-bit PKCS#8 one; if the editors require PKCS#8, pass your own with
`proofKey.pem` or `proofKey.existingSecret`. Assumption: the republished images read `SUMOFFICE_WOPI_PROOF_DIR`.

## Limits

- One replica per editor (`Recreate`): each open document is a local process with local state.
- `ReadWriteOnce` volumes; the pods of one editor do not scale horizontally.
- Liveness/readiness use TCP checks on the editor ports; the front answers `/health`.
- `icon.png` referenced in `Chart.yaml` is not yet in the repository.
- Licence: images are free for evaluation; production use inside an organisation is licensed per application
  (https://sumoffice.com/download#server).

## Publishing to Artifact Hub (owner)

1. Package and publish: `helm package catalogs/helm/sumoffice` and push to a Helm repository
   (GitHub Pages with `helm repo index`, or OCI: `helm push sumoffice-0.1.0.tgz oci://ghcr.io/sumofficeapp/charts`).
2. Publish `catalogs/helm/artifacthub-repo.yml` next to `index.yaml` (or as the `artifacthub.io` OCI tag).
3. Sign in at https://artifacthub.io → Control Panel → Add repository (kind: Helm charts), then put the issued
   `repositoryID` into `artifacthub-repo.yml` and republish it.

Maintainer: SumOffice — https://github.com/SumOfficeApp/sumoffice-docker
