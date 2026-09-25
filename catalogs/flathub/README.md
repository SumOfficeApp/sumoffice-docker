# SumOffice — Flathub

Status: not applicable to this repository; nothing to submit from here.

Flathub distributes **desktop applications** for Linux as Flatpaks: a manifest (`<app-id>.yml` or `.json`)
that builds the application from sources or from a released binary, plus AppStream metadata
(`<app-id>.metainfo.xml`) and a `.desktop` file, submitted as a pull request to
https://github.com/flathub/flathub (the `new-pr` branch) and reviewed against the Flathub requirements
(https://docs.flathub.org/docs/for-app-authors/requirements).

This repository contains only **server** deliverables: Docker images of the web editors (SumSheet, SumDoc) and
the files to run them for Nextcloud or standalone. A web server that runs as Docker containers is not a Flatpak
application: Flathub's requirements exclude console software and host system utilities, and there is no desktop
user interface here to package.

The channel belongs to the SumOffice **desktop** builds (the desktop application mentioned in the top-level
README, e.g. for Power Query refresh). A Flathub package would be prepared from those builds, not from here.
What it would need, for the record:

- a reverse-DNS app ID on a domain the owner controls (e.g. `com.sumoffice.<App>`), verified with a token at
  `https://<domain>/.well-known/org.flathub.VerifiedApps.txt`;
- a Linux x86-64 (and preferably aarch64) release artefact with a stable download URL and checksum, or a
  source build;
- AppStream metainfo with screenshots, release notes and an OARS content rating; a `.desktop` file and icons;
- redistribution rights: when the upstream authors submit, Flathub treats redistribution as granted; otherwise a
  non-redistributable binary is fetched on the user's machine through an `extra-data` source.

## Checked

- Nothing to check: no manifest is provided on purpose.
