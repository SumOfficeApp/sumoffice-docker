# SumOffice — Cloudron package

Status: draft, not yet submitted; needs republished multi-arch images (amd64+arm64) with the WOPI proof-key fix before submission.

Files: `CloudronManifest.json`, `Dockerfile`, `start.sh`, `front.mjs` (copy of `aio/front.mjs` from the
`aio-single-image` branch), `DESCRIPTION.md`, `POSTINSTALL.md`, `CHANGELOG`.

The package wraps the whole stack in one container, as Cloudron requires: SumSheet (cabin manager `:8095` + WOPI
facade `:8092`), SumDoc (`:8090`) and the Node front on `:8093` that serves `/f1`, `/a4` and the joint discovery
`/hosting/*`. It is built `FROM cloudron/base` with the editor code copied out of `hissih/sumsheet-webhost` and
`hissih/sumdoc-webhost`.

| Cloudron | SumOffice |
|---|---|
| `CLOUDRON_APP_ORIGIN` | `PUBLIC_URL` |
| `/app/data/env.sh` (edited by the admin) | `NEXTCLOUD_HOST`, `NEXTCLOUD_URL`, `MAX_CABINS` |
| `/app/data/proof/proof-key.pem` | the one WOPI proof key for both editors (backed up with the app) |
| `healthCheckPath: /health` | answered by the front |

## Limits

- **One container, all processes.** If any editor process exits, the app exits and Cloudron restarts it whole;
  open documents in the other editor are interrupted too.
- **No settings form.** Cloudron has no install-time fields for arbitrary values, so the WOPI host is set in
  `/app/data/env.sh` after install; until then the editors accept no host (`localhost` only).
- **No Cloudron SSO.** Users and files come from the WOPI host (Nextcloud); `optionalSso` is off.
- **Memory.** 4 GB limit by default; each open document is a process of about 250 MB. Raise the limit for more users.
- **amd64 only on Cloudron.** `cloudron/base` is published for amd64.
- **Read-only code.** `/app/code` is read-only at runtime. Assumption: the editors write only to the
  `--docs-dir`/`--state-dir` paths and `HOME` (all under `/app/data`), and they run from `/app/code/<editor>`
  instead of `/app` and `/opt/sumdoc` of the source images. If the images hard-code `/app/...` paths, build
  `FROM hissih/sumoffice-aio` instead and link `/data` to `/app/data`.
- **Node runtime.** Assumption: the editor code runs on the Node.js shipped with `cloudron/base:6.0.0`; see the
  note in the `Dockerfile` if the images need their own Node binary.
- **Icon.** `logo.png` (256×256) is not yet in the folder; add it and `"icon": "file://logo.png"` to the manifest.

## Build and try (owner)

```sh
npm install -g cloudron      # Cloudron CLI
cloudron login my.example.com
cloudron build               # builds with the Dockerfile here and pushes to your registry
cloudron install --location office
```

## Submission (owner)

1. Publish the republished editor images (with the WOPI proof-key fix).
2. Keep this package in a public repository (for example `SumOfficeApp/sumoffice-cloudron`) with a logo.
3. Post it in the Cloudron forum, category "App Wishlist" / "App Packaging & Development", and ask the Cloudron team
   to take it into the App Store (they review and publish store apps themselves).

Maintainer: SumOffice — https://github.com/SumOfficeApp/sumoffice-docker
