# SumOffice — Unraid Community Applications templates

Status: draft, not yet submitted; needs republished multi-arch images (amd64+arm64) with the WOPI proof-key fix before submission.

| Template | Image | Use |
|---|---|---|
| `sumoffice.xml` | `hissih/sumoffice-aio:v1` | both editors + joint WOPI discovery on port 8093, for Nextcloud Office |
| `sumsheet.xml` | `hissih/sumsheet-webhost:latest` | SumSheet standalone (your own system: `--auth-url`, `--attach-url`) |
| `sumdoc.xml` | `hissih/sumdoc-webhost:latest` | SumDoc standalone (same contract) |
| `ca_profile.xml` | — | maintainer profile shown in Community Applications |

Why the Nextcloud template is one container: an Unraid template describes one container and cannot ship the
`nginx.conf` and `discovery.py` files that the four-service compose in `nextcloud/` mounts. The single image
(`aio/` on the `aio-single-image` branch) carries them, and keeps the one WOPI proof key for both editors in
`/data/proof`. Users who prefer the four-service stack can run `nextcloud/docker-compose.yml` with the
Docker Compose Manager plugin instead; that is not a CA template.

Unraid is amd64 only, so arm64 does not matter here, but the templates point at the same tags as the other catalogs.

Assumptions: the standalone editors take their options as command arguments (Post Arguments), exactly as in
`standalone/README.md`; icons `sumoffice.png`, `sumsheet.png`, `sumdoc.png` still have to be added to this folder.

## Submission (owner)

1. Publish `hissih/sumoffice-aio:v1`; add the three PNG icons; keep these files on the `main` branch so the
   `TemplateURL` links resolve (or move them to a dedicated templates repository and update `TemplateURL`/`Icon`).
2. Create a support thread in the Unraid forum ("Docker Containers" section) and put its URL into `<Support>`
   (CA expects a forum support thread per template).
3. Submit the repository through the Community Applications submission form linked from
   https://forums.unraid.net/topic/38582-plug-in-community-applications/ (template repository URL + support thread).

Maintainer: SumOffice — https://github.com/SumOfficeApp/sumoffice-docker
