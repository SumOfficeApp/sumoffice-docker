# SumOffice for Egnyte

This is an Egnyte UI Integration Framework app. **Edit in SumOffice** in the context menu of a `.xlsx`, `.xlsm`, `.xlsb` or `.docx` file opens it in SumSheet (Excel-compatible) or SumDoc (Word-compatible). **Ctrl+S** adds a new version of the same Egnyte file, written with the person's own Egnyte rights.

The app is a small service (`bridge/`, Node 20+, no dependencies). It does two jobs:

- **Receives Egnyte's invocations.** Egnyte's back end POSTs the selected file, the user, the domain and a Public API token to `serviceUrl`. The service answers with a one-time link that Egnyte opens in a new tab.
- **Acts as the WOPI host SumOffice talks to.** It reads and writes the file through the Egnyte Public API with that token:
  - `GET /pubapi/v1/fs/ids/file/{group_id}` — metadata;
  - `GET /pubapi/v1/fs-content/ids/file/{group_id}` — contents;
  - `POST /pubapi/v1/fs-content/{path}` — a new version.

The Egnyte token never reaches the browser. It stays in the service's memory, bound to the editing session, as Egnyte requires. The link Egnyte opens works once, for five minutes. A restart of the service means the file has to be opened again from Egnyte.

## Install

1. **Run the bridge behind HTTPS.** Egnyte's cloud and the SumOffice servers must both reach it.

   ```bash
   docker build -t sumoffice-egnyte-bridge integrations/egnyte/bridge
   docker run -d -p 8790:8790 --env-file egnyte-bridge.env sumoffice-egnyte-bridge
   ```

   | Variable | Meaning |
   |---|---|
   | `PUBLIC_URL` | The bridge's HTTPS address |
   | `TOKEN_KEY` | 16+ characters, the key for WOPI access tokens |
   | `SUMOFFICE_DISCOVERY_URL` | `https://office.example.com/hosting/discovery` |
   | `EGNYTE_DOMAINS` | The Egnyte domains to serve, e.g. `acme.egnyte.com`; empty means any `*.egnyte.com` |
   | `VERIFY_PROOF` | `1` by default |
   | `PORT`, `HOST` | `8790`, `0.0.0.0` |

   On the SumOffice side, allow the bridge host:
   - SumSheet: `WOPI_ALLOW=sumoffice-egnyte.example.com`
   - SumDoc: `--wopi-hosts https://sumoffice-egnyte.example.com`

2. **Register the app with Egnyte.**
   1. Fill in `definition.json`: your Public API key, the bridge address in both `serviceUrl`s, and the logo and screenshots.
   2. Register it through the Egnyte developer programme (partners@egnyte.com; the app runs in an Egnyte sandbox domain first).
   3. Install it in the domain.

   There are two menu items:
   - **Edit** for owner, full and editor permission levels;
   - **View** for viewers, which opens read-only.

## Rights

- **Opening.** Egnyte shows the menu item only to people with the listed permission levels, and every invocation carries that person's own token.
- **Saving.** A save is an upload with the person's token. If Egnyte refuses it, the editor is told the file can't be saved.
- **Domains.** The bridge only talks to `*.egnyte.com` domains, or to the ones in `EGNYTE_DOMAINS`. A forged invocation can only reach files its own token can reach.
- **Signatures and tokens.**
  - SumOffice's calls are checked against the proof keys in discovery.
  - WOPI access tokens are HMAC-signed and expire after 10 hours.
  - Locks are kept in the bridge's memory for 30 minutes.

## Checked on

Tested on 25.09.2026 against a local mock of the Egnyte Public API (`bridge/test/mock-egnyte.mjs`): metadata, contents and versioned upload by path, with read-only and read-write tokens. **Not yet checked on a real Egnyte domain** — that needs an Egnyte developer sandbox.

- `node --test integrations/egnyte/bridge/test/bridge.test.mjs` covers the whole path with real RSA proof keys. It also checks the refusals:
  - a domain outside `*.egnyte.com` or the configured list, or a folder → `400`;
  - the one-time link used twice → `410`;
  - no proof or a forged one → `500`;
  - a broken token or another session's token → `401`;
  - PutFile without the lock → `409`;
  - a save with a read-only Egnyte token → `401`.

  The test also checks that the Egnyte token never appears on the page, and that a view invocation opens the editor's view action.
- Live round with the SumOffice stack, proof verification on:
  - **`approved_macro_demo.xlsm`.** A cell was edited and saved with **Ctrl+S**. It became version 2 of the same file, written by the editing user, and `vbaProject.bin` is byte-identical to the original.
  - **`images.docx`.** The text was edited and saved; all five images are byte-identical.
