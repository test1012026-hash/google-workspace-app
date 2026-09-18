# SecureDocShare — Google Workspace / Gmail add-on

Login → subscription → encrypt & send → decrypt.

## Gmail limit

Gmail add-ons cannot intercept native Send (unlike Outlook). Use:

1. Web app → **Encrypt and send** (recommended)
2. Gmail compose → **SecureDocShare Encrypt & Send**
3. Encrypt only → copy/paste ciphertext

## Layout

```
src/addon/          Apps Script sources (edit these)
  config.js         Constants + manifest entry points
  ui.js             Card widgets
  cards.js          Card builders
  actions.js        Card / compose handlers
  session.js        User session
  api.js            SecureDoc API (UrlFetch)
  contacts.js       People API search
  gmail-draft.js    Draft match + send
  gmail-scan.js     Open-message scan / decrypt helpers
  webapp.js         doGet + download cache
web/                HtmlService panel sources
  common/           api, auth, crypto, expose
  config.js, app.js, gmail-send.js, compose-ui.js
  index.html, compose.html, styles.css
scripts/
  build-code.cjs    → Code.js
  build-html.cjs    → Index.html + HTML includes
Code.js             Built (clasp push)
*.html              Built (clasp push)
```

## Build

```bash
cd google-workspace-app
npm run build
```

## Deploy

1. Push `Code.js`, `appsscript.json`, and HTML includes
2. Re-authorize Contacts scopes; enable People API if needed
3. Deploy Web app + test deployments

Gmail send uses **your** `GOOGLE_GMAIL_CLIENT_ID` / secret on the server (`/auth/gmail/send-token`).  
It does **not** use Apps Script’s default GCP project (`ScriptApp.getOAuthToken`).

- **Continue with Google** in the add-on stores a Gmail refresh token (offline + compose scopes).
- If missing, Encrypt & send opens `/auth/gmail/connect` (same web OAuth client).
- Enable **Gmail API** on the GCP project that owns `GOOGLE_GMAIL_CLIENT_ID` (not the Apps Script default project).
