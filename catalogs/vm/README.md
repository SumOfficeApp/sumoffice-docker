# SumOffice — shared VM appliance scripts

Status: submission-package implementation on released images; not submitted.

Used by the virtual-machine catalogs: `digitalocean/` and `vultr/` (Packer uploads this folder into the image) and
`azure/`, `ovhcloud/`, `vultr/vendor-data.sh` (cloud-init clones the repository and runs it from
`/opt/sumoffice/catalogs/vm/`). The stack is the three-service compose of `nextcloud/`
(compatibility server, SumSheet and SumDoc on `127.0.0.1:8093`), with Caddy on the host in front of it.

| File | Installed as | Purpose |
|---|---|---|
| `sumoffice-install.sh` | — | build/install step: `docker.io`, `docker-compose-v2`, `caddy`, `git`, `openssl` from Ubuntu's archive; clones this repository to `/opt/sumoffice`; pulls the images; installs the files below. Creates no per-instance state, so a snapshot taken after it is safe to share |
| `sumoffice-configure.sh` | `/usr/local/sbin/sumoffice-configure` | per instance: `.env`, connector JWT secret and Caddyfile; starts the stack; re-runnable (`--interactive`, `--domain`, `--public-url`, `--jwt-secret`) |
| `sumoffice-first-login.sh` | `/usr/local/sbin/sumoffice-first-login` | asks for the DNS name and the Nextcloud address on the first root login, then restores `/root/.bashrc` |
| `99-sumoffice` | `/etc/update-motd.d/99-sumoffice` | login banner with the current address and the next steps |

On the machine:

| Path | What |
|---|---|
| `/opt/sumoffice/nextcloud/` | the stack (`docker-compose.yml` plus `.env` written by `sumoffice-configure`) |
| `/etc/sumoffice/sumoffice.env` | chosen values (`SUMOFFICE_DOMAIN`, `SUMOFFICE_PUBLIC_URL`, `SUMOFFICE_JWT_SECRET`), mode 0600 |
| `/etc/caddy/Caddyfile` | `<domain>` (automatic Let's Encrypt certificate) or `:80`, both `reverse_proxy 127.0.0.1:8093` |

Only Caddy listens on the public interface (80/443). Docker publishes nothing outside `127.0.0.1`, so Docker's
iptables rules do not bypass the host firewall.

## Assumptions

- Ubuntu 24.04 LTS on x86-64 (the images are amd64 only today; `sumoffice-install.sh` refuses other architectures).
- An HTTPS connector needs the editor endpoint over HTTPS too: give a DNS name (`--domain`), or put TLS in front
  and pass `--public-url`.
- cloud-init based packages clone the branch or tag named in them (default `main`), which must contain
  `catalogs/vm/`.

## Checked

- `bash -n` and ShellCheck 0.11.0: clean on all scripts.
- `sumoffice-configure.sh` run against a scratch directory with `docker`/`caddy`/`systemctl` stubbed: IP-only,
  `--domain`, `--interactive` (new values, `-` to drop the domain), trailing-slash stripping, rejection of a URL
  with a path and secret persistence across runs.
- The written `.env` merges with `nextcloud/docker-compose.yml` (`docker compose config`).
- Not run on a real VM: no packages were installed, no images pulled, Caddy's certificate issuance not exercised.
