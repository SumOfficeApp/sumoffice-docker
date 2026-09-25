# SumOffice — Umbrel app store package

Status: draft, not yet submitted; needs republished multi-arch images (amd64+arm64) with the WOPI proof-key fix before submission.

`sumoffice/` is an app folder for https://github.com/getumbrel/umbrel-apps: `umbrel-app.yml` (manifest) and
`docker-compose.yml` (the `app_proxy` service plus one `web` service). It runs the single image
`hissih/sumoffice-aio` (SumSheet + SumDoc + joint discovery + front on 8093, data and the WOPI proof key in
`${APP_DATA_DIR}/data`), declares a dependency on the Umbrel `nextcloud` app and serves on port 8093.

## Blockers before a PR

- **arm64 images are required.** umbrelOS runs on x86 (Umbrel Home, PCs) and on arm64 (Raspberry Pi 5), and one
  store serves both; umbrel-apps expects every image to be multi-arch and pinned by digest
  (`image: hissih/sumoffice-aio:v1@sha256:...`). Today the editor images are amd64 only.
- The images need the WOPI proof-key fix (one key for both editors) republished.
- Store assets: `icon` (256×256 SVG, no rounded corners) and three gallery images (1440×900 JPG) are provided in
  the PR description; Umbrel hosts them in its gallery repository.

## Open questions (assumptions to check on a real Umbrel)

1. **Server-side reach of Nextcloud.** The editors call back to the WOPI URL that Nextcloud gives them. If
   Nextcloud announces `http://umbrel.local:8081`, the SumOffice container must resolve `umbrel.local`, which
   mDNS names may not do inside Docker. Nextcloud's `richdocuments` has a `wopi_callback_url` setting; setting it
   to `http://nextcloud_web_1` (the container name already trusted by the Umbrel Nextcloud app) and adding that
   host to `NEXTCLOUD_HOST`/`NEXTCLOUD_URL` may be needed.
2. **Same scheme.** Both apps are served over http on the LAN; over Tor or an https proxy both must change together.
3. **Port 8093** must be free in the store (their CI checks port collisions).
4. `PROXY_AUTH_ADD: "false"` is required: Nextcloud fetches discovery server-side and embeds the editor in a frame.

## Submission (owner)

1. Publish multi-arch `hissih/sumoffice-aio:v1`, pin its digest in `docker-compose.yml`.
2. Test on a device or the Umbrel dev environment: copy `sumoffice/` into a community app store fork, install,
   open an `.xlsx` and a `.docx` from the Umbrel Nextcloud.
3. Fork https://github.com/getumbrel/umbrel-apps, add the `sumoffice/` folder, open a PR using their template
   (icon, gallery, tested architectures), then put the PR URL into `submission:`.

Maintainer: SumOffice — https://github.com/SumOfficeApp/sumoffice-docker
