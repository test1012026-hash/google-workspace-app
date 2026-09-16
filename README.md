# SecureDocShare — Google Workspace Marketplace test app

Outlook / Chrome extension parity for **login → subscription check → encrypt & send → decrypt**.

## Important Gmail limit

Gmail add-ons **cannot** intercept the native Send button (unlike Outlook `OnMessageSend`).  
Use one of these instead:

1. **Web app → Encrypt and send** (recommended) — same as Chrome extension:
   - Verifies login JWT
   - Verifies subscription
   - `POST /files/encrypt`
   - Gmail API send via `/auth/gmail/send-token`
2. **Gmail compose → SecureDoc Encrypt** — encrypt & insert ciphertext into the draft, then click Gmail Send
3. **Encrypt only** — ciphertext to copy/paste

## Upload into Apps Script

1. `Code.gs` ← `Code.js`
2. `appsscript.json` ← updated manifest (compose trigger + scopes)
3. HTML files: `Index`, `Stylesheet`, `Config`, `Common`, `GmailSend`, `App`
4. Deploy **Web app** + Test deployments

Rebuild:

```bash
cd workspace-marketplace-app
node scripts/build-apps-script-html.cjs
```

## Gmail send prerequisite

First-time Gmail allow must be done once via the **Chrome extension** (stores refresh token). After that, Workspace **Encrypt and send** can send from your account.
