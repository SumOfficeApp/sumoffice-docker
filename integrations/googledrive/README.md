# SumOffice for Google Drive

This is a Google Drive "Open with" app. **Open with → SumOffice** on a `.xlsx`, `.xlsm`, `.xlsb` or `.docx` file in Google Drive opens it in SumSheet (Excel-compatible) or SumDoc (Word-compatible). **Ctrl+S** saves a new revision of the same Drive file, written with the person's own Drive rights. The file keeps its id, its sharing and its revision history.

**Why use it:** Google Sheets cannot run VBA. When it converts a workbook, the macros are gone. SumSheet runs the macros in an `.xlsm` workbook and saves the file back to Drive with `vbaProject.bin` intact.

The app is a small service (`bridge/`, Node 20+, no dependencies). It does two jobs:

- **Receives Drive's "Open with".** Drive sends the browser to the app's Open URL. The URL carries `state={"ids":["…"],"action":"open","userId":"…"}`. The service then runs the OAuth 2.0 authorization-code flow with Google and opens the editor.
  - It asks for one scope only: `https://www.googleapis.com/auth/drive.file`. That scope covers files the person opens with the app, which is all "Open with" needs. It is not a restricted scope, so no third-party security assessment is required.
- **Acts as the WOPI host SumOffice talks to.** It reads and writes the file through the Drive API v3 with the person's token:
  - `GET /drive/v3/files/{id}?fields=name,size,version,mimeType,capabilities(canEdit),headRevisionId,owners` — metadata. `UserCanWrite` is `capabilities.canEdit`.
  - `GET /drive/v3/files/{id}?alt=media` — contents;
  - `PATCH /upload/drive/v3/files/{id}?uploadType=media` — a new revision of the same file;
  - `GET /drive/v3/about?fields=user(…)` — who the person is, for the editor's user name.

The Google access and refresh tokens never reach the browser. They stay in the service's memory, bound to the Google user and the editing session. When Drive answers `401`, the service refreshes the access token with the refresh token and retries once. A restart of the service means the file has to be opened again from Drive.

## Routes

| Route | Purpose |
|---|---|
| `GET /google/open?state=…` | The Open URL registered with Drive |
| `GET /google/callback` | The OAuth redirect URI |
| `/wopi/files/{id}[/contents]` | WOPI: CheckFileInfo, locks, GetFile, PutFile |
| `GET /healthz` | Liveness |

## Install

1. **Run the bridge behind HTTPS.** Browsers, Google and the SumOffice servers must all reach it.

   ```bash
   docker build -t sumoffice-googledrive-bridge integrations/googledrive/bridge
   docker run -d -p 8792:8792 --env-file googledrive-bridge.env sumoffice-googledrive-bridge
   ```

   | Variable | Meaning |
   |---|---|
   | `PUBLIC_URL` | The bridge's HTTPS address, e.g. `https://sumoffice-drive.example.com` |
   | `GOOGLE_CLIENT_ID` | The OAuth client ID (step 2.4) |
   | `GOOGLE_CLIENT_SECRET` | The OAuth client secret (step 2.4) |
   | `TOKEN_KEY` | 16+ characters, the key for signed OAuth states and WOPI access tokens |
   | `SUMOFFICE_DISCOVERY_URL` | `https://office.example.com/hosting/discovery` |
   | `VERIFY_PROOF` | `1` by default |
   | `PORT`, `HOST` | `8792`, `0.0.0.0` |
   | `GOOGLE_API_BASE`, `GOOGLE_OAUTH_BASE` | Tests only: point the Drive API and the OAuth endpoints at a mock |

   On the SumOffice side, allow the bridge host:
   - SumSheet: `WOPI_ALLOW=sumoffice-drive.example.com`
   - SumDoc: `--wopi-hosts https://sumoffice-drive.example.com`

2. **Set up Google Cloud.** Do this in the [Google Cloud console](https://console.cloud.google.com/) with the account that will own the app.
   1. **Create a project**, e.g. `SumOffice for Drive`.
   2. **Enable the Google Drive API.** Go to *APIs & Services → Library → Google Drive API → Enable*.
   3. **Set up the OAuth consent screen** (*Google Auth Platform → Branding / Audience / Data access*):
      - user type: **External** for everyone, or **Internal** for your own Workspace only;
      - app name **SumOffice**, a logo, and a support e-mail;
      - the app home page, privacy policy and terms of service links;
      - under authorized domains, the bridge's domain;
      - one scope: `https://www.googleapis.com/auth/drive.file`.

      While the app is in *Testing*, only the listed test users can sign in. Google also expires their refresh tokens after 7 days. *Publish* the app and pass brand verification before real use. `drive.file` is not a restricted scope, so no security assessment is needed.
   4. **Create an OAuth client** (*Clients → Create client → Web application*):
      - authorized redirect URI: `https://sumoffice-drive.example.com/google/callback`;
      - put its client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
   5. **Configure the Drive UI integration** (*APIs & Services → Google Drive API → Drive UI integration*):
      - application name **SumOffice**, short and long descriptions, and the icons Drive asks for;
      - **Open URL:** `https://sumoffice-drive.example.com/google/open`;
      - **Default MIME types:**
        - `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (`.xlsx`)
        - `application/vnd.ms-excel.sheet.macroEnabled.12` (`.xlsm`)
        - `application/vnd.ms-excel.sheet.binary.macroEnabled.12` (`.xlsb`)
        - `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (`.docx`)
      - **Default file extensions:** `xlsx`, `xlsm`, `xlsb`, `docx`. These also catch files that Drive stored as `application/octet-stream`.
      - leave *Creating files* (New URL) and *Importing* off. SumOffice opens and saves existing files only.
      - the OAuth client ID from step 4.
   6. **List the app in the Google Workspace Marketplace.** "Open with" appears in Drive only once the app is installed from the Marketplace.
      1. Enable the *Google Workspace Marketplace SDK*.
      2. In *App Configuration*, choose the visibility: *Public*, or *Private* to your own domain.
      3. Allow individual and admin install.
      4. Tick **Drive integration**, and list the same `drive.file` scope.
      5. In *Store Listing*, add the name, descriptions, icons, screenshots and the support, privacy and terms links, then submit for review. A *Private* listing needs no Google review and can be installed by your own domain at once.

## Rights

- **Opening.** Drive offers "Open with → SumOffice" to people who can see the file. The bridge reads the file with that person's own token, so it sees exactly what they may see.
- **Saving.**
  - `UserCanWrite` is Drive's `capabilities.canEdit`, read again on every CheckFileInfo.
  - A reader gets the editor's view action; their LOCK and PutFile are answered `401`.
  - If Drive refuses a save (`403`, e.g. the owner took the edit right away while the tab was open), the editor is told the file can't be saved.
- **Sign-in and CSRF.**
  - The OAuth `state` is HMAC-signed and lives 10 minutes.
  - It works once, and is bound to the browser by an `HttpOnly`, `SameSite=Lax` cookie named after its nonce.
  - If the person unticks the Drive permission on Google's screen, nothing is opened.
- **Tokens.**
  - Google tokens stay server-side.
  - If Google sends no refresh token (the person consented before a restart of the bridge), the bridge asks once more with `prompt=consent`.
  - WOPI access tokens are HMAC-signed and expire after 10 hours.
  - SumOffice's calls are checked against the proof keys in discovery.
  - Locks are kept in the bridge's memory for 30 minutes.

## Checked on

Tested on 25.09.2026 against a local mock of the Google APIs (`bridge/test/mock-google.mjs`). The mock covers the OAuth authorization and token endpoints, including a refresh token on first consent only, plus Drive metadata, media download, media upload with counted revisions, and `about`. It has a writer and a read-only user. **Not yet checked on real Google Drive**: that needs a Google Cloud project with the Drive UI integration and a Marketplace install.

`node --test integrations/googledrive/bridge/test/bridge.test.mjs` covers the whole path with real RSA proof keys:
- Open URL with Drive's `state`;
- Google sign-in, then the callback, then the editor page, which contains no Google token;
- CheckFileInfo, LOCK and GetFile;
- PutFile adds revision 2 of the same file, and GetFile reads it back;
- an expired access token is refreshed;
- a second open reuses the kept refresh token;
- a person who had consented earlier is sent back once with `prompt=consent`.

It also checks the refusals:
- a Drive state that is not one file with `action: "open"` → `400`;
- a callback without the browser's cookie, a forged state, an expired state, or a state used twice → `400`;
- consent refused → `403`; a non-Office file → `415`;
- no proof or a forged one → `500`;
- a broken token or another session's token → `401`;
- PutFile without the lock → `409`;
- a reader: `UserCanWrite: false` and the view action, LOCK and save → `401`;
- a save that Drive refuses with `403` → `401`.
