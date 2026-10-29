# SumOffice for Google Drive

This is a Google Drive "Open with" app with a second, install-independent entry at `/google/pick` and an install entry at `/google/install`. **Open with → SumOffice**, or choosing a file in Google Picker, opens an `.xlsx`, `.xlsm`, `.xlsb`, `.docx` or `.pptx` file in the matching editor. A Google Docs, Sheets or Slides file opens as a `.docx`, `.xlsx` or `.pptx` copy saved next to the original (Drive's *Importing*). **Ctrl+S** saves a new revision of the same Drive file, written with the person's own Drive rights. The file keeps its id, its sharing and its revision history.

**Why use it:** Google Sheets cannot run VBA. When it converts a workbook, the macros are gone. SumSheet runs the macros in an `.xlsm` workbook and saves the file back to Drive with `vbaProject.bin` intact.

The app is a small service (`bridge/`, Node 20+, no dependencies). It does two jobs:

- **Receives Drive's "Open with".** Drive sends the browser to the app's Open URL. The URL carries `state={"ids":["…"],"action":"open","userId":"…"}`. The service then runs the OAuth 2.0 authorization-code flow with Google and opens the editor.
  - It asks for one scope only: `https://www.googleapis.com/auth/drive.file`. That scope covers files the person opens with the app, which is all "Open with" needs. It is not a restricted scope, so no third-party security assessment is required.
- **Lets a person choose a file before Marketplace installation.** `/google/pick` runs the same OAuth code flow, then displays Google Picker with DOCX, XLSX, XLSM, XLSB and PPTX. The selected file enters the same WOPI path as "Open with" and saves back to the same Drive file id. The Picker entry requests `drive.file` for the chosen file and `drive.install` so a Marketplace review can show both declared permissions.
- **Puts SumOffice into "Open with".** Drive lists an app under "Open with" only for a person who granted it `drive.install`. A Marketplace installation grants it; so does `/google/install`, a page with one button, **Connect SumOffice to Google Drive™**. It runs the OAuth code flow with `drive.install` and `drive.file`, keeps no token, and answers "Done: in Drive, right-click a .docx/.xlsx/.pptx → Open with → SumOffice". The page speaks Russian to browsers that ask for `ru`, English otherwise. Register it as the app's Install URL.
- **Imports Google Docs, Sheets and Slides.** With *Importing* on, Drive sends `state={"exportIds":["…"],"action":"open",…}`. The bridge exports the file with `files.export` (Docs → `.docx`, Sheets → `.xlsx`, Slides → `.pptx`) and creates a new file next to the original under `drive.file`, with `appProperties.sumofficeSource` set to the original id. If the person may not add files to that folder, the copy goes to the root of My Drive. The editor opens the copy, and Ctrl+S saves the copy; the Google file is never changed. Google exports up to 10 MB; a larger file is answered `413` with a hint to download it in the Office format first. Each "Open with" makes a fresh copy.
- **Acts as the WOPI host SumOffice talks to.** It reads and writes the file through the Drive API v3 with the person's token:
  - `GET /drive/v3/files/{id}?fields=name,size,version,mimeType,capabilities(canEdit),headRevisionId,owners` — metadata. `UserCanWrite` is `capabilities.canEdit`.
  - `GET /drive/v3/files/{id}?alt=media` — contents;
  - `PATCH /upload/drive/v3/files/{id}?uploadType=media` — a new revision of the same file;
  - `GET /drive/v3/about?fields=user(…)` — who the person is, for the editor's user name;
  - `GET /drive/v3/files/{id}/export?mimeType=…` and `POST /upload/drive/v3/files?uploadType=multipart` — Importing only.

Google refresh tokens never reach the browser. They stay in the service's memory, bound to the Google user and editing session. Google Picker itself requires a short-lived access token, so that token is embedded only in the no-store Picker page and is never put in a URL; the editor page receives only a signed WOPI token. When Drive answers `401`, the service refreshes the access token with the refresh token and retries once. A restart of the service means the file has to be opened again from Drive.

## Routes

| Route | Purpose |
|---|---|
| `GET /google/` | Small entry page with “Open a file from Google Drive” |
| `GET /google/install` | “Connect SumOffice to Google Drive™”: the Install URL |
| `GET /google/install/start` | Google sign-in with `drive.install` + `drive.file`, then “Done” |
| `GET /google/pick` | Google sign-in followed by Google Picker |
| `POST /google/picked` | One-time handoff of the selected file id to the editor |
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
   | `SUMOFFICE_GDRIVE_PICKER_KEY` | Browser API key restricted to the Google Picker API and the production referrers |
   | `SUMOFFICE_GDRIVE_APP_ID` | Optional Cloud project number; defaults to `975087005549` |
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
      Enable **Google Picker API** in the same project as well.
   3. **Set up the OAuth consent screen** (*Google Auth Platform → Branding / Audience / Data access*):
      - user type: **External** for everyone, or **Internal** for your own Workspace only;
      - app name **SumOffice**, a logo, and a support e-mail;
      - the app home page, privacy policy and terms of service links;
      - under authorized domains, the bridge's domain;
      - scopes: `https://www.googleapis.com/auth/drive.file` and `https://www.googleapis.com/auth/drive.install`.

      While the app is in *Testing*, only the listed test users can sign in. Google also expires their refresh tokens after 7 days. *Publish* the app and pass brand verification before real use. `drive.file` is not a restricted scope, so no security assessment is needed.
   4. **Create an OAuth client** (*Clients → Create client → Web application*):
      - authorized redirect URI: `https://sumoffice-drive.example.com/google/callback`;
      - put its client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
   5. **Create the Picker browser API key** (*APIs & Services → Credentials → Create credentials → API key*):
      - application restriction: **Websites**;
      - allowed referrers: `https://gdrive.sumoffice.com/*` and `https://docs.google.com/*` (Picker renders from the latter);
      - API restriction: **Restrict key → Google Picker API** only;
      - put the value into `SUMOFFICE_GDRIVE_PICKER_KEY`; never commit it or place it in a command argument.
   6. **Configure the Drive UI integration** (*APIs & Services → Google Drive API → Drive UI integration*):
      - application name **SumOffice**, short and long descriptions, and the icons Drive asks for;
      - **Open URL:** `https://sumoffice-drive.example.com/google/open`;
      - **Default MIME types:**
        - `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (`.xlsx`)
        - `application/vnd.ms-excel.sheet.macroEnabled.12` (`.xlsm`)
        - `application/vnd.ms-excel.sheet.binary.macroEnabled.12` (`.xlsb`)
        - `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (`.docx`)
        - `application/vnd.openxmlformats-officedocument.presentationml.presentation` (`.pptx`)
      - **Default file extensions:** `xlsx`, `xlsm`, `xlsb`, `docx`, `pptx` (no dots). These also catch files that Drive stored as `application/octet-stream`. MIME types go in the MIME field and extensions in the extension field; Drive ignores an extension typed into the MIME field.
      - **Importing:** on. Then **Secondary MIME types:**
        - `application/vnd.google-apps.document` (Google Docs → `.docx`)
        - `application/vnd.google-apps.spreadsheet` (Google Sheets → `.xlsx`)
        - `application/vnd.google-apps.presentation` (Google Slides → `.pptx`)
      - **Install URL** (where the console offers one): `https://sumoffice-drive.example.com/google/install`.
      - leave *Creating files* (New URL) off. SumOffice opens existing files only.
      - **Automatically show OAuth 2.0 consent screen:** off. Google marks it deprecated ("The application must start all authorization requests"); the bridge always starts the sign-in itself.
      - **Shared drives support:** on. The bridge calls the Drive API with `supportsAllDrives=true`.
      - the OAuth client ID from step 4.
   7. **List the app in the Google Workspace Marketplace.** "Open with" appears in Drive only for a person who granted `drive.install`: after installing from the Marketplace, or after `/google/install`.
      1. Enable the *Google Workspace Marketplace SDK*.
      2. In *App Configuration*, choose the visibility: *Public*, or *Private* to your own domain.
      3. Allow individual and admin install.
      4. Tick **Drive integration**, and list `drive.file` and `drive.install`.
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
  - Picker uses `p: "pick"` inside that signed state. Its selected file id is accepted only with a separate signed, one-time 10-minute handoff token.
  - If the person unticks the Drive permission on Google's screen, nothing is opened.
- **Tokens.**
  - Google refresh tokens stay server-side. A short-lived access token exists only in the no-store Picker page because the Google Picker JavaScript API requires it.
  - The Picker page sends neither the access token nor the API key in a URL, and uses a restrictive Content Security Policy plus `Referrer-Policy: strict-origin`: Google receives the allowed origin for browser-key checks, but not the callback path, code or state.
  - If Google sends no refresh token (the person consented before a restart of the bridge), the bridge asks once more with `prompt=consent`.
  - WOPI access tokens are HMAC-signed and expire after 10 hours.
  - SumOffice's calls are checked against the proof keys in discovery.
  - Locks are kept in the bridge's memory for 30 minutes.

## Checked on

29.10.2026: the install entry and Importing were added and tested against the same mock, now with `files.export`, multipart file creation, writable and read-only parent folders, and the token's scope echoing the scopes asked for. Not yet checked against the real Google Drive: the owner does that live probe.

Tested on 26.10.2026 against a local mock of the Google APIs (`bridge/test/mock-google.mjs`). The mock covers the OAuth authorization and token endpoints, including a refresh token on first consent only, plus Drive metadata, media download, media upload with counted revisions, Picker state and `about`. It has a writer and a read-only user. **Not yet checked against a real Google Picker**: the owner must first enable Picker API and create the restricted browser key. The Picker route itself does not require Marketplace installation; the Drive “Open with” route does.

`node --test integrations/googledrive/bridge/test/bridge.test.mjs` covers the whole path with real RSA proof keys:
- Open URL with Drive's `state`;
- `/google/` entry page and `/google/pick` OAuth state;
- Picker page configuration from `SUMOFFICE_GDRIVE_PICKER_KEY`, DOCX/XLSX/XLSM/XLSB/PPTX filter and one-time selected-file handoff;
- a Picker-selected PPTX opening in the editor and saving revision 2 to the same Drive file id;
- Google sign-in, then the callback, then the editor page, which contains no Google token;
- CheckFileInfo, LOCK and GetFile;
- PutFile adds revision 2 of the same file, and GetFile reads it back;
- an expired access token is refreshed;
- a second open reuses the kept refresh token;
- a person who had consented earlier is sent back once with `prompt=consent`;
- `/google/install` in English and Russian, `drive.install` + `drive.file` asked for, the "Done" page, no Drive data read, `drive.install` unticked → `403` with the button again, consent refused → the install page;
- Importing: a Google Doc → `.docx` copy in the same folder, opened, locked and saved to the copy while the Doc stays untouched; a read-only shared Google Sheet → `.xlsx` copy in My Drive's root; a Slides file over Google's export limit → `413`; a Google Form → `415`; the Picker offers Google Docs, Sheets and Slides.

It also checks the refusals:
- a Drive state that is not one file with `action: "open"` → `400`;
- a callback without the browser's cookie, a forged state, an expired state, or a state used twice → `400`;
- consent refused → `403`; a non-Office file → `415`;
- no proof or a forged one → `500`;
- a broken token or another session's token → `401`;
- PutFile without the lock → `409`;
- a reader: `UserCanWrite: false` and the view action, LOCK and save → `401`;
- a save that Drive refuses with `403` → `401`.
