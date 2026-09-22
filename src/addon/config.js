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

/** User-facing Encrypt data only messages. */
const ENCRYPT_ONLY_MESSAGES = {
  SUCCESS:
    "Draft encrypted (not sent). Please close the current compose and check your drafts. If the mail is not encrypted, wait 1 minute and check again.",
  SIGN_IN: "Please sign in to SecureDocShare first.",
  LOGIN_REQUIRED: "Login or an active subscription is required.",
  GMAIL_CONNECT: "Please connect Gmail, then try Encrypt data only again.",
  ALREADY_ENCRYPTED:
    "This draft is already encrypted. Clear the message body, type a new message, wait for Gmail autosave, then try again.",
  NOTHING_TO_ENCRYPT:
    "Nothing to encrypt. Add a message or file, wait for Gmail autosave, then try again.",
  FAILED: "Could not encrypt the draft.",
  UNEXPECTED: "Encrypt failed.",
};

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
 * Compose toolbar icon (below Send). Registered via gmail.composeTrigger.
 * Must return a Card (ActionResponse causes "Content can't be loaded").
 * Runs Encrypt data only — does not send.
 */
function onGmailCompose(e) {
  try {
    const status = getEncryptOnlyStatus_(e || {});
    try {
      saveComposeSidebarStatus_(status.kind, status.message);
    } catch (_saveErr) {}
    return buildEncryptOnlyStatusCard_(status.kind, status.message);
  } catch (err) {
    const errorMessage =
      ENCRYPT_ONLY_MESSAGES.UNEXPECTED +
      " " +
      String(err && err.message ? err.message : err);
    try {
      saveComposeSidebarStatus_("error", errorMessage);
    } catch (_saveErr) {}
    try {
      return buildEncryptOnlyStatusCard_("error", errorMessage);
    } catch (_cardErr) {
      return CardService.newCardBuilder()
        .setHeader(cardHeader_("SecureDocShare", "Error"))
        .addSection(
          CardService.newCardSection().addWidget(
            CardService.newTextParagraph().setText(
              coloredStatusParagraphText_("error", errorMessage)
            )
          )
        )
        .build();
    }
  }
}
