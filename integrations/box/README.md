# SumOffice for Box

This is a Box Web App Integration. **Open with SumOffice** in a file's **More Options → Integrations** menu opens a `.xlsx`, `.xlsm`, `.xlsb` or `.docx` file in SumSheet (Excel-compatible) or SumDoc (Word-compatible). **Ctrl+S** uploads a new version of the same Box file, written with the person's own Box rights.

The app is a small service (`bridge/`, Node 20+, no dependencies). It does two jobs:

- **Receives Box's popup integration callback.** Box sends the file id and an OAuth 2.0 authorization code (`auth_code`) to the callback URL. The service exchanges the code at `https://api.box.com/oauth2/token`, then redirects the browser (`303`) to a one-time link that opens the editor.
- **Acts as the WOPI host SumOffice talks to.** It reads and writes the file through the Box API with the person's token:
  - `GET https://api.box.com/2.0/files/{id}?fields=name,size,etag,sha1,permissions,owned_by` — metadata; `UserCanWrite` is `permissions.can_upload`;
  - `GET https://api.box.com/2.0/files/{id}/content` — contents. Box answers with a redirect to a short-lived download URL on another host; the service follows it **without** the `Authorization` header;
  - `POST https://upload.box.com/api/2.0/files/{id}/content` — a new version (multipart: `attributes`, then `file`), with `If-Match: <etag>` so a change made in Box meanwhile is never overwritten.

The Box access and refresh tokens never reach the browser. They stay in the service's memory, bound to the editing session; the page only carries a signed WOPI token. When Box answers `401`, the service refreshes the token once (Box refresh tokens are single-use, so concurrent calls share one refresh) and retries. The link the callback redirects to works once, for two minutes. A restart of the service means the file has to be opened again from Box.

## Install

1. **Run the bridge behind HTTPS.** The person's browser, Box and the SumOffice servers must all reach it.

   ```bash
   docker build -t sumoffice-box-bridge integrations/box/bridge
   docker run -d -p 8796:8796 --env-file box-bridge.env sumoffice-box-bridge
   ```

   | Variable | Meaning |
   |---|---|
   | `BOX_CLIENT_ID`, `BOX_CLIENT_SECRET` | The OAuth 2.0 credentials of the Box app (Configuration tab) |
   | `PUBLIC_URL` | The bridge's HTTPS address |
   | `TOKEN_KEY` | 16+ characters, the key for WOPI access tokens |
   | `SUMOFFICE_DISCOVERY_URL` | `https://office.example.com/hosting/discovery` |
   | `VERIFY_PROOF` | `1` by default |
   | `PORT`, `HOST` | `8796`, `0.0.0.0` |
   | `BOX_API_BASE`, `BOX_UPLOAD_BASE` | Tests only: `https://api.box.com` and `https://upload.box.com/api` by default |

   On the SumOffice side, allow the bridge host:
   - SumSheet: `WOPI_ALLOW=sumoffice-box.example.com`
   - SumDoc: `--wopi-hosts https://sumoffice-box.example.com`

2. **Create the app in the Box Developer Console** (`https://app.box.com/developers/console`).
   1. **Create New App → Custom App → User Authentication (OAuth 2.0).** Web App Integrations are only available to OAuth 2.0 apps.
   2. **Configuration tab:**
      - copy the **Client ID** and **Client Secret** into `BOX_CLIENT_ID` / `BOX_CLIENT_SECRET`;
      - **OAuth 2.0 Redirect URI:** `https://sumoffice-box.example.com/box/callback` (the bridge never runs its own sign-in flow, but Box requires a redirect URI);
      - **Application Scopes:** *Read all files and folders stored in Box* and *Write all files and folders stored in Box*.
   3. **Integrations tab → Create a Web App Integration:**
      - **Integration name:** `SumOffice`; **Description:** `Open and edit Excel and Word files in SumOffice.`
      - **Supported file extensions:** `xlsx, xlsm, xlsb, docx`;
      - **Permissions:** *Full permissions are required* for an edit integration. Choose *Download permissions are required* instead to also offer it to people who can only view; they then get the read-only editor;
      - **Integration scopes:** the file from which the integration is invoked;
      - **Integration type:** *Files*;
      - **User experience:** a new window (popup integration); the prompt message may stay empty;
      - **Client Callback URL:** `https://sumoffice-box.example.com/box/callback`;
      - **Callback parameters** (method `POST` or `GET`, the bridge reads both; `POST` keeps the code out of the address bar):

        | Parameter name | Value |
        |---|---|
        | `file_id` | `#file_id#` |
        | `file_name` | `#file_name#` |
        | `user_id` | `#user_id#` |
        | `auth_code` | `#auth_code#` |
        | `redirect_to_box_url` | `#redirect_to_box_url#` (optional: becomes the editor's close link) |

        The names on the left are what the bridge expects. Only `file_id` and `auth_code` are required; `file_name` and `user_id` are informational — the bridge reads the name and the user from Box with the token it gets.
      - **Status:** *Development* while testing (only collaborators of the app see it), then *Online*.
   4. **Authorize the app in the enterprise.** A Box admin enables it in the Admin Console (**Integrations → Platform Apps Manager**) if the enterprise restricts third-party apps.
3. **Box App Center (optional).** To list SumOffice for all Box users, submit the app for publication from the Developer Console (**Publishing** tab): logo, short and long description, screenshots, support and privacy links. Box reviews the listing; the callback URL must be publicly reachable.

## Rights

- **Opening.** Box shows the integration only on the listed extensions and to people with the chosen permission level. Box creates the authorization code for the person who clicked; the bridge reads the file only with the token that code yields, so a forged `file_id` can only reach files that person may reach anyway.
- **Saving.** Write access comes from Box itself (`permissions.can_upload`, re-read on every CheckFileInfo). A save is an upload with the person's token. If Box refuses it (`403`), the editor is told the file can't be saved. If the file changed in Box since the editor read it (`412` on `If-Match`), the save is refused with `409` and nothing is overwritten.
- **Tokens.**
  - Box access and refresh tokens stay in the bridge's memory, never in the page, a cookie or a URL.
  - The authorization code is single-use at Box, and the bridge's one-time link lasts two minutes.
  - WOPI access tokens are HMAC-signed and expire after 10 hours.
  - SumOffice's calls are checked against the proof keys in discovery.
  - The download redirect is followed without the `Authorization` header.
- **Locks.** WOPI locks are kept in the bridge's memory for 30 minutes. Box also has its own file lock (`PUT /2.0/files/{id}` with a `lock` object) and the integration option *Lock to only allow current user to overwrite*; the bridge does not use them yet, so a person editing the same file in Box's own apps is only stopped by the `If-Match` check on save.
- **Size.** A save is a single-request upload, which Box limits to 50 MB; larger files would need Box's chunked upload API, not implemented here.

## Checked on

Tested on 25.09.2026 against a local mock of the Box API (`bridge/test/mock-box.mjs`): token endpoint (authorization code and single-use refresh tokens), user, file metadata with `fields`, content with a `302` to a separate download host, and multipart upload of new versions with `If-Match`. **Not yet checked on real Box** — that needs a Box developer account with a Web App Integration pointing at a public bridge.

- `node --test integrations/box/bridge/test/bridge.test.mjs` covers the whole path with real RSA proof keys: callback with `auth_code` → editor page → CheckFileInfo → LOCK → GetFile → PutFile creates a new version → GetFile reads it. It also checks the refusals:
  - no `auth_code` or a malformed `file_id` → `400`; a code Box did not issue, or one used twice → `401`; a file that is not `.xlsx/.xlsm/.xlsb/.docx` → `415`;
  - the one-time link used twice, or opened after two minutes → `410`;
  - no proof or a forged one → `500`;
  - a broken token or another session's token → `401`;
  - PutFile without the lock → `409`; PutFile after the file changed in Box → `409`;
  - a viewer (`can_upload: false`) opens the view action and cannot lock or save → `401`; rights withdrawn in Box after opening → Box's `403` becomes `401`.

  The test also checks that no Box token, the client secret or the auth code appears on the page, that the download host never receives the `Authorization` header, and that an expired access token is refreshed and the call succeeds.

### Assumptions to verify on a real Box account

- Box sends the callback parameters as a form (`application/x-www-form-urlencoded`) for `POST` and in the query for `GET`, from the person's browser.
- `#auth_code#` can be exchanged with `grant_type=authorization_code` and the app's client id and secret, without a `redirect_uri`; Box documents authorization codes as valid for about 30 seconds.
- `permissions.can_upload` is present in the file object when requested in `fields`.
- The upload answer is `201` with `{ total_count, entries: [file] }`, and `entries[0].etag` is the new version's etag.
- `content-md5` (the SHA-1 of the file) is accepted on a version upload.
