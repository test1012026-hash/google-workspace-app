const ADMIN_URL = "https://admin-panel-amber-nine.vercel.app";
const API_BASE = "https://server-nine-rosy.vercel.app/api";
const APP_ORIGIN = API_BASE.replace(/\/api\/?$/, "");
const SESSION_KEY = "SDS_WORKSPACE_SESSION";
const WEB_APP_DEPLOYMENT_ID =
  "AKfycbzCvUVD8GnLvsGNpux6euGd2WJrYUmGXEE3qp-NK-emFZSFAvN5dPOkIumQLmgcm5RRVA";
const WEB_APP_URL =
  "https://script.google.com/macros/s/" + WEB_APP_DEPLOYMENT_ID + "/exec";

/**
 * From server/.env GOOGLE_GMAIL_* — Workspace Google login (Apps Script OAuth2).
 * Prefer Script Properties via configureGoogleOAuthCredentials(); these are fallbacks.
 */
const GOOGLE_OAUTH_CLIENT_ID =
  "387608086587-s1h4da154kpbupqdbmghup6k87e3gp0b.apps.googleusercontent.com";
const GOOGLE_OAUTH_CLIENT_SECRET = "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";

/** OpenID + Gmail offline scopes (refresh token stored in SecureDocShare DB). */
const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];

function onHomepage(e) {
  return buildMainCard_(e);
}

function onGmailHomepage(e) {
  return buildMainCard_(e);
}

function onGmailMessage(e) {
  return buildGmailMessageCard_(e);
}

/**
 * Not registered (composeTrigger removed). Gmail always opens a card modal for
 * compose selectActions — Encrypt & send lives on the sidebar button instead.
 */
function onGmailCompose(e) {
  return onSidebarEncryptAndSend_(e);
}
