# SumOffice for kintone

kintone keeps files in attachment fields and has no WOPI host of its own, so the integration has two parts:

- **`plugin/`** — a kintone plugin. It adds **Open in SumOffice** next to `.xlsx`, `.xlsm`, `.xlsb` and `.docx` files on the record page.
- **`bridge/`** — a small WOPI host (Node 20+, no dependencies) that serves those files to SumOffice. It reads and writes them through the kintone REST API with an app API token. **Ctrl+S** uploads the new file and puts it into the same slot of the same field; the field's other files stay as they were.

```
kintone record page ──(plugin proxy + secret)──▶ bridge /kintone/ticket ──▶ SumOffice editor
SumOffice editor ──WOPI──▶ bridge /wopi/files/… ──REST + API token──▶ kintone
```

## Bridge

Environment variables:

| Variable | Meaning |
|---|---|
| `KINTONE_BASE_URL` | `https://<subdomain>.cybozu.com` |
| `KINTONE_API_TOKENS` | `appId:token` pairs separated by commas. The token needs **View records** and **Edit records** |
| `BRIDGE_SECRET` | 16+ characters. The same value goes into the plugin settings |
| `PUBLIC_URL` | The bridge's HTTPS address, as SumOffice and kintone reach it |
| `SUMOFFICE_DISCOVERY_URL` | `https://office.example.com/hosting/discovery` |
| `VERIFY_PROOF` | `1` by default. `0` turns off the check of SumOffice's proof signatures |
| `TOKEN_KEY` | Optional. The key for access tokens; `BRIDGE_SECRET` by default |
| `PORT`, `HOST` | `8787`, `0.0.0.0` |

```bash
docker build -t sumoffice-kintone-bridge integrations/kintone/bridge
docker run -d -p 8787:8787 --env-file kintone-bridge.env sumoffice-kintone-bridge
```

Put the bridge behind HTTPS at `PUBLIC_URL`. kintone (cybozu.com) and the SumOffice servers must both be able to reach it. On the SumOffice side, allow the bridge host:
- SumSheet: `WOPI_ALLOW=sumoffice-kintone.example.com`
- SumDoc: `--wopi-hosts https://sumoffice-kintone.example.com`

## Plugin

Package it with kintone's packer (it creates the signing key on the first run):

```bash
npx @kintone/plugin-packer integrations/kintone/plugin
```

Next, open kintone Administration → Plugins and upload `plugin.zip`. Then add the plugin to an app and, in its settings, enter the bridge URL and `BRIDGE_SECRET`. kintone keeps the secret on its side (`setProxyConfig`). It adds the secret only to the plugin's calls to `…/kintone/ticket`, and people in kintone never see it.

## Rights

- **Reading and writing kintone.** The bridge uses the app's API token, so it can read and write whatever that token allows.
- **Opening a file.** It needs a ticket, and only the plugin can get one: the call has to come through kintone's proxy carrying the secret. The ticket is bound to one slot of one field in one record, and to the file's name.
- **Write right.** The plugin asks kintone for the user's rights on the record and field (`records/acl/evaluate`) and passes them in the ticket. A person who can only view the record gets a read-only editor.
  - This check happens in the browser.
  - A person who can open the record could forge the answer from the browser console and get a writable editor.
  - If that matters, give the bridge a token without **Edit records** for apps where some users may only read.
- **Signatures and tokens.**
  - SumOffice's calls are checked against the proof keys in discovery: current and old key, with a 20-minute window.
  - Access tokens are HMAC-signed and expire after 10 hours.
  - Locks are kept in the bridge's memory for 30 minutes.

## Checked on

Tested on 25.09.2026 against a local kintone mock (`bridge/test/mock-kintone.mjs`). The mock implements the `record.json` and `file.json` calls the bridge uses, including `$revision` and the 409 on a stale revision. **Not yet checked on a real kintone** — that needs a kintone developer account.

- `node --test integrations/kintone/bridge/test/bridge.test.mjs` covers the whole path with real RSA proof keys: ticket → CheckFileInfo → LOCK → GetFile → PutFile → UNLOCK. It also checks the refusals:
  - no secret or a wrong one → `401`;
  - name mismatch → `404`;
  - a file type SumOffice doesn't open → `415`;
  - no proof or a forged one → `500`;
  - a broken token or a token for another slot → `401`;
  - PutFile without the lock → `409`.
- Live round with the SumOffice stack, proof verification on:
  - **`approved_macro_demo.xlsm`.** A cell was edited and saved with **Ctrl+S**. The new file is in the same slot, and `vbaProject.bin` is byte-identical to the original.
  - **`images.docx`.** The text was edited and saved; all five images are byte-identical.
  - The record revision went 1 → 2 → 3, and the other file in the field was kept.
