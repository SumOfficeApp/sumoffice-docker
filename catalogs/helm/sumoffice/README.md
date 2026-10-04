# SumOffice Helm chart

Status: submission package prepared, not submitted. A live amd64 cluster round and approved icon remain owner gates.

SumOffice web editors for Kubernetes: **SumSheet** (Excel workbooks: `.xlsx`, `.xlsm`, `.xlsb`) and **SumDoc**
(Word documents: `.docx`) behind the released compatibility server on one origin.
The layout is the same as `nextcloud/docker-compose.yml` in this repository:

| Path | Component | Image |
|---|---|---|
| `/cell` | SumSheet (port 8092) | `hissih/sumsheet-webhost:latest` |
| `/word` | SumDoc (port 8090) | `hissih/sumdoc-webhost:latest` |
| everything, port 8080 | connector-compatible front | `hissih/sumoffice-compat:2026.4.0.2` |

## Install

```sh
helm install sumoffice ./sumoffice \
  --set publicUrl=https://office.example.com \
  --set-string jwtSecret='<long-random-secret>' \
  --set ingress.enabled=true --set ingress.className=nginx \
  --set 'ingress.hosts[0].host=office.example.com' \
  --set 'ingress.tls[0].secretName=office-tls' --set 'ingress.tls[0].hosts[0]=office.example.com'
```

Enter the same public URL and JWT secret in the connector's Document Server settings.

## Values

| Key | Default | Meaning |
|---|---|---|
| `publicUrl` | `https://office.example.com` | address the browser uses (`PUBLIC_URL`) |
| `jwtSecret` | `change-me` | shared secret; override on every installation |
| `maxCabins` / `idleMin` | `8` / `15` | open documents per editor / idle minutes |
| `sumsheet.*`, `sumdoc.*` | see `values.yaml` | image, resources, persistence (RWO PVC, 5Gi) |
| `ingress.*` | disabled | routes `/` to the compatibility server |

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
