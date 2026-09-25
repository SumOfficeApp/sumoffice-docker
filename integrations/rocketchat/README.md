# SumOffice for Rocket.Chat

**Open in SumOffice** in the message menu opens a `.xlsx`, `.xlsm`, `.xlsb` or `.docx` file from a Rocket.Chat message in SumSheet (Excel-compatible) or SumDoc (Word-compatible). **Ctrl+S** posts the edited file into the same room, as the person who edited it. The original message keeps its file, and the next open from it reads the newest version.

There are two parts:

- **`app/`** — a Rocket.Chat app (Apps-Engine, plain JavaScript, no build step). It adds the menu item and the dialog with the link. It is the only part that reads uploads and posts new versions in Rocket.Chat.
- **`bridge/`** — a small WOPI host (Node 20+, no dependencies) that SumOffice talks to. It never touches Rocket.Chat's database or REST API.

Why two parts: Rocket.Chat app endpoints accept only small JSON bodies (`body-parser` json/urlencoded, 100 KB). A file saved by the editor cannot reach the app directly, so the bridge keeps it and the app collects it.

```
message menu → app dialog → link → bridge /rocketchat/open → SumOffice editor
editor ─WOPI─▶ bridge ─signed JSON─▶ app /file   (the app reads the upload)
editor ─PutFile─▶ bridge ─▶ app /save ─▶ bridge /rocketchat/pending ─▶ app posts the new version
```

All calls between the app and the bridge are signed with a shared secret (HMAC-SHA256) and expire after two minutes.

## Install

1. **Run the bridge** behind HTTPS:

   ```bash
   docker build -t sumoffice-rocketchat-bridge integrations/rocketchat/bridge
   docker run -d -p 8789:8789 -v sumoffice-rc:/data -e STATE_FILE=/data/state.json --env-file rc-bridge.env sumoffice-rocketchat-bridge
   ```

   | Variable | Meaning |
   |---|---|
   | `ROCKETCHAT_URL` | Rocket.Chat's address as the bridge reaches it |
   | `BRIDGE_SECRET` | 16+ characters. The same value goes into the app settings |
   | `PUBLIC_URL` | The bridge's HTTPS address |
   | `SUMOFFICE_DISCOVERY_URL` | `https://office.example.com/hosting/discovery` |
   | `STATE_FILE` | Where the bridge remembers the newest version of each opened file |
   | `VERIFY_PROOF` | `1` by default |
   | `APP_ID`, `TOKEN_KEY`, `PORT` | Optional |

   On the SumOffice side, allow the bridge host:
   - SumSheet: `WOPI_ALLOW=sumoffice-rc.example.com`
   - SumDoc: `--wopi-hosts https://sumoffice-rc.example.com`

2. **Install the app.**

   ```bash
   cd integrations/rocketchat/app && zip -r ../sumoffice-rocketchat.zip app.json SumOfficeApp.js icon.png i18n
   ```

   Upload the zip in Administration → Apps → Private apps, and grant the permissions it asks for. In the app settings, fill in the bridge URL and the secret.

   A **private** app needs a registered workspace: Rocket.Chat Community without registration allows no private apps (`privateApps` limit 0). The free Starter registration lifts that. Once the app is published on the Marketplace, it installs from there.

## Rights

- **Opening.** Only people who can see the message can open the file: the menu item is on the message, and the dialog link carries a ticket that the app signs.
  - The ticket is valid for five minutes.
  - It is bound to one upload in one room and to the person.
- **Saving.**
  - A read-only room opens the file read-only.
  - The app posts the new version only if the person is a member of the room.
- **Signatures and tokens.**
  - SumOffice's calls are checked against the proof keys in discovery.
  - Access tokens expire after 10 hours.
  - Locks are kept in the bridge's memory for 30 minutes.

## Checked on

Tested on Rocket.Chat 7.10.0 Community with the SumOffice stack, 25.09.2026:

- **The real Rocket.Chat UI, proof verification on.**
  - The menu item appears on the message and the dialog opens with the link.
  - `approved_macro_demo.xlsm`: the value typed in E3 is in the new version, and `vbaProject.bin` is byte-identical to the original.
  - `images.docx`: the text was edited and saved; all five images are byte-identical.
  - The new version was posted in #general as the user who edited it.
- **Refusals.**
  - Bridge:
    - forged or expired ticket → `401`;
    - no proof or a forged one → `500`;
    - a broken token, a token for another file or signed with another key → `401`;
    - `pending` without a signature → `401`.
  - App:
    - another key or the wrong operation → `401`;
    - an upload from another room → `404`;
    - a user who is not in the room → `403`.
- `node --test integrations/rocketchat/bridge/test/bridge.test.mjs` covers the whole path against a mock of the app, with real RSA proof keys.
- **Stand-only workarounds.**
  - The stand workspace is not registered. To enable the private app anyway, the app record was marked `migrated` and re-signed with the server's own key. A registered workspace needs neither step.
  - Rocket.Chat 7 locks message sending until it can reach its Cloud, so the stand also needed the network proxy's CA.
