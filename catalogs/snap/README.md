# SumOffice — Snap Store

Status: not applicable to this repository in its current form; no `snapcraft.yaml` is provided on purpose.

The Snap Store (https://snapcraft.io) takes a `snapcraft.yaml` that builds the software into a confined package.
Snaps can be desktop or server software, so the question here is whether the **server stack** in this repository
fits a snap. It does not, in a way worth submitting:

- The stack is four Docker containers (`nextcloud/docker-compose.yml`). A snap that drives Docker needs the
  `docker` interface to the separate `docker` snap; that interface is super-privileged, does not auto-connect,
  and needs an approved snap declaration for the store. The snap would still pull the images at run time: a
  wrapper around `docker compose`, not a package of the software.
- Packaging the editors natively (their Node.js programs and engines as snap parts, running as daemons with
  `network-bind`) needs a source or binary release of the editor servers outside Docker. This repository does
  not have one; it only references the published images.

What would make a snap reasonable:

- **Desktop:** the SumOffice desktop builds (see the top-level README) can go to the Snap Store as a
  strictly-confined desktop app, prepared from those builds, like the Flathub channel (`../flathub/`).
- **Server:** once the editor servers are released as standalone Linux binaries or tarballs, a strict snap with
  `daemon: simple` apps for SumSheet, SumDoc, discovery and the front, data under `$SNAP_DATA`/`$SNAP_COMMON`,
  and `snap set sumoffice public-url=... nextcloud-url=...` configure hooks.

Until then, the supported ways to run the server on a Linux machine are Docker (`../../nextcloud/`,
`../../standalone/`) and the VM packages (`../vm/`).

What is needed from the owner, if the desktop route is taken: a Snap Store publisher account, the registered
snap name, and Linux release artefacts of the desktop app.

## Checked

- Nothing to check: no `snapcraft.yaml` is provided.
