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
    "This draft is already encrypted. Please close the current compose window and check your Drafts folder. Wait for 1 minute first and check whether the draft is encrypted. If it is not encrypted, open a new compose window and try again.",
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

/**
 * Workspace Google login via Apps Script OAuth2 library (OpenID Connect).
 * Flow: Continue with Google → Google consent → authCallback → verify id_token
 * on SecureDocShare API → store JWT session + Gmail refresh token in DB.
 *
 * Redirect URI (add in Google Cloud OAuth client):
 *   https://script.google.com/macros/d/<SCRIPT_ID>/usercallback
 * Call getGoogleOAuthRedirectUri() in the Apps Script editor to copy it.
 *
 * Requires library: OAuth2
 *   (1B7FSrk5Zi6L1rSxxTDgDEUsPzlukDsi4KGuTMorsTQHhGBzBkMun4iDF)
 */

var GOOGLE_OAUTH_INTENT_KEY = "SDS_GOOGLE_OAUTH_INTENT";

/** Same web client as server GOOGLE_GMAIL_* (identity + Gmail offline). */
function getGoogleOAuthClientId_() {
  var fromProps = PropertiesService.getScriptProperties().getProperty(
    "GOOGLE_OAUTH_CLIENT_ID"
  );
  if (fromProps) return String(fromProps).trim();
  return String(GOOGLE_OAUTH_CLIENT_ID || "").trim();
}

function getGoogleOAuthClientSecret_() {
  var fromProps = PropertiesService.getScriptProperties().getProperty(
    "GOOGLE_OAUTH_CLIENT_SECRET"
  );
  if (fromProps) return String(fromProps).trim();
  return String(GOOGLE_OAUTH_CLIENT_SECRET || "").trim();
}

/** One-time: copy env values into Script Properties (run from editor). */
function configureGoogleOAuthCredentials() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty("GOOGLE_OAUTH_CLIENT_ID", getGoogleOAuthClientId_());
  props.setProperty("GOOGLE_OAUTH_CLIENT_SECRET", getGoogleOAuthClientSecret_());
  return {
    ok: true,
    clientId: getGoogleOAuthClientId_(),
    redirectUri: getGoogleOAuthRedirectUri(),
  };
}

function getGoogleOAuthRedirectUri() {
  return (
    "https://script.google.com/macros/d/" +
    ScriptApp.getScriptId() +
    "/usercallback"
  );
}

function getGoogleOAuthService_() {
  var clientId = getGoogleOAuthClientId_();
  var clientSecret = getGoogleOAuthClientSecret_();
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google OAuth client id/secret missing. Run configureGoogleOAuthCredentials()."
    );
  }
  if (typeof OAuth2 === "undefined" || !OAuth2.createService) {
    throw new Error(
      "OAuth2 library missing. Add library 1B7FSrk5Zi6L1rSxxTDgDEUsPzlukDsi4KGuTMorsTQHhGBzBkMun4iDF"
    );
  }

  return OAuth2.createService("securedoc_google")
    .setAuthorizationBaseUrl("https://accounts.google.com/o/oauth2/v2/auth")
    .setTokenUrl("https://oauth2.googleapis.com/token")
    .setClientId(clientId)
    .setClientSecret(clientSecret)
    .setCallbackFunction("authCallback")
    .setPropertyStore(PropertiesService.getUserProperties())
    .setScope(GOOGLE_OAUTH_SCOPES.join(" "))
    .setParam("access_type", "offline")
    .setParam("prompt", "consent")
    .setParam("include_granted_scopes", "true");
}

function saveGoogleOAuthIntent_(intent, acceptTerms) {
  PropertiesService.getUserProperties().setProperty(
    GOOGLE_OAUTH_INTENT_KEY,
    JSON.stringify({
      intent: intent === "signup" ? "signup" : "login",
      acceptTerms: Boolean(acceptTerms),
    })
  );
}

function loadGoogleOAuthIntent_() {
  try {
    var raw = PropertiesService.getUserProperties().getProperty(
      GOOGLE_OAUTH_INTENT_KEY
    );
    if (!raw) return { intent: "login", acceptTerms: false };
    var parsed = JSON.parse(raw);
    return {
      intent: parsed.intent === "signup" ? "signup" : "login",
      acceptTerms: Boolean(parsed.acceptTerms),
    };
  } catch (e) {
    return { intent: "login", acceptTerms: false };
  }
}

/**
 * Start Google login/signup. Returns authorization URL for OpenLink / top redirect.
 * @param {{intent?: string, acceptTerms?: boolean}|string=} options
 */
function getGoogleLoginUrl(options) {
  options = options || {};
  if (typeof options === "string") {
    options = { intent: options };
  }
  var intent = options.intent === "signup" ? "signup" : "login";
  var acceptTerms = options.acceptTerms === true || intent === "signup";
  if (intent === "signup" && !acceptTerms) {
    throw new Error("Accept Terms & Conditions to sign up with Google.");
  }
  saveGoogleOAuthIntent_(intent, acceptTerms);

  var service = getGoogleOAuthService_();
  // Always re-consent so we can capture refresh token for Gmail send when missing.
  return service.getAuthorizationUrl();
}

/**
 * OAuth2 library callback — Google verified identity, then our DB session.
 */
function authCallback(request) {
  var service = getGoogleOAuthService_();
  var ok = false;
  try {
    ok = service.handleCallback(request);
  } catch (err) {
    return googleOAuthResultPage_(false, String(err.message || err));
  }
  if (!ok) {
    return googleOAuthResultPage_(false, "Google authentication failed.");
  }

  var idToken = "";
  try {
    if (typeof service.getIdToken === "function") {
      idToken = String(service.getIdToken() || "");
    }
  } catch (e0) {}
  if (!idToken) {
    try {
      var tok = service.getToken();
      idToken = String((tok && tok.id_token) || "");
    } catch (e1) {}
  }
  if (!idToken) {
    return googleOAuthResultPage_(
      false,
      "Google did not return an id_token. Ensure openid scope is granted."
    );
  }

  var refreshToken = "";
  var scope = "";
  try {
    var tokenBag = service.getToken();
    refreshToken = String((tokenBag && tokenBag.refresh_token) || "");
    scope = String((tokenBag && tokenBag.scope) || GOOGLE_OAUTH_SCOPES.join(" "));
  } catch (e2) {}

  // Extra identity check against OpenID userinfo (not browser-supplied email).
  try {
    var access = service.getAccessToken();
    if (access) {
      var infoRes = UrlFetchApp.fetch(
        "https://openidconnect.googleapis.com/v1/userinfo",
        {
          headers: { Authorization: "Bearer " + access },
          muteHttpExceptions: true,
        }
      );
      if (infoRes.getResponseCode() >= 200 && infoRes.getResponseCode() < 300) {
        var info = JSON.parse(infoRes.getContentText() || "{}");
        if (info.email_verified === false) {
          return googleOAuthResultPage_(false, "Google email is not verified.");
        }
      }
    }
  } catch (e3) {}

  var intentState = loadGoogleOAuthIntent_();
  var login = apiLoginGoogle_({
    idToken: idToken,
    gmailRefreshToken: refreshToken || null,
    gmailScopes: scope,
    intent: intentState.intent,
    acceptTerms: intentState.acceptTerms,
  });

  if (!login.ok) {
    return googleOAuthResultPage_(false, login.error || "Sign-in failed");
  }

  saveWorkspaceSession({
    token: login.token,
    email: login.email,
    expiresAt: login.expiresAt || null,
  });

  try {
    PropertiesService.getUserProperties().deleteProperty(GOOGLE_OAUTH_INTENT_KEY);
  } catch (e4) {}

  // Land on the Workspace web app (not script.google.com/home).
  var appUrl = String(WEB_APP_URL || "").split("?")[0];
  if (appUrl) {
    return HtmlService.createHtmlOutput(
      "<!DOCTYPE html><html><body style='font-family:system-ui,sans-serif;padding:24px;background:#0f1c24;color:#eef6f8'>" +
        "<p style='font-size:18px;font-weight:700'>SecureDocShare</p>" +
        "<p style='color:#2bb3a0'>Signed in as " +
        escapeHtml_(login.email || "user") +
        "</p>" +
        "<p style='color:#9db4bd'>Please go back to Gmail and refresh the page to continue.</p>" +
        "<script>window.top.location.replace(" +
        JSON.stringify(appUrl) +
        ");</script>" +
        "<p><a style='color:#2bb3a0' href='" +
        escapeHtml_(appUrl) +
        "'>Continue</a></p>" +
        "</body></html>"
    ).setTitle("Signed in");
  }

  return googleOAuthResultPage_(true, login.email || "Signed in");
}

function googleOAuthResultPage_(success, detail) {
  var title = success ? "Signed in" : "Sign-in failed";
  var color = success ? "#2bb3a0" : "#ff6b7a";
  var msg = success
    ? "Signed in as " + escapeHtml_(detail) + ". Close this window and return to Gmail."
    : escapeHtml_(detail);
  return HtmlService.createHtmlOutput(
    "<!DOCTYPE html><html><body style='font-family:system-ui,sans-serif;padding:24px;background:#0f1c24;color:#eef6f8'>" +
      "<p style='font-size:18px;font-weight:700'>SecureDocShare</p>" +
      "<h2 style='color:" +
      color +
      "'>" +
      title +
      "</h2>" +
      "<p>" +
      msg +
      "</p>" +
      "<script>setTimeout(function(){try{window.close();}catch(e){}},1200);</script>" +
      "</body></html>"
  ).setTitle(title);
}

function cardHeader_(title, subtitle) {
  return CardService.newCardHeader()
    .setTitle(title || "SecureDocShare")
    .setSubtitle(subtitle || "Encrypt · Decrypt · Secure mail");
}

/** Status colors for CardService text (HTML font color). */
const STATUS_COLOR = {
  success: "#188038",
  error: "#d93025",
  info: "#1a73e8",
  working: "#1a73e8",
  need_gmail: "#1a73e8",
};

function escapeCardHtml_(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>");
}

/**
 * Map status kind → success (green) | error (red) | info (blue).
 * @param {string} kind
 * @returns {"success"|"error"|"info"}
 */
function statusToneFromKind_(kind) {
  const k = String(kind || "");
  if (k === "encrypted" || k === "success") return "success";
  if (k === "error") return "error";
  return "info";
}

/**
 * Colored status title + body for TextParagraph (green / red / blue).
 * @param {string} kind
 * @param {string} message
 */
function coloredStatusParagraphText_(kind, message) {
  const tone = statusToneFromKind_(kind);
  const color = STATUS_COLOR[tone] || STATUS_COLOR.info;
  let title = "Status";
  if (tone === "success") title = "✔ SUCCESS";
  else if (tone === "error") title = "✖ ERROR";
  else if (kind === "need_gmail") title = "Connect Gmail";
  else if (kind === "working") title = "Working…";
  else title = "ℹ INFO";

  const body = escapeCardHtml_(message);
  return (
    '<font color="' +
    color +
    '"><b>' +
    title +
    "</b></font><br><font color=\"" +
    color +
    '">' +
    body +
    "</font>"
  );
}

function statusRow_(text, ok) {
  return CardService.newDecoratedText()
    .setText(String(text || ""))
    .setWrapText(true)
    .setStartIcon(
      CardService.newIconImage().setIconUrl(
        ok
          ? "https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/check_circle/default/24px.svg"
          : "https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/error/default/24px.svg"
      )
    );
}

function infoRow_(title, text) {
  return CardService.newDecoratedText()
    .setTopLabel(String(title || ""))
    .setText(String(text || ""))
    .setWrapText(true)
    .setStartIcon(
      CardService.newIconImage().setIconUrl(
        "https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/info/default/24px.svg"
      )
    );
}

function primaryBtn_(label, fnName) {
  return CardService.newTextButton()
    .setText(label)
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setOnClickAction(CardService.newAction().setFunctionName(fnName));
}

function secondaryBtn_(label, fnName) {
  return CardService.newTextButton()
    .setText(label)
    .setOnClickAction(CardService.newAction().setFunctionName(fnName));
}

/** Valid session or null (clears expired tokens → login screen). */
function getValidWorkspaceAuth_() {
  var session = getWorkspaceSession_();
  if (!session || !session.token) return null;
  var auth = apiGetSubscription_(session.token);
  if (!auth || !auth.ok) {
    clearWorkspaceSession();
    return null;
  }
  return { session: session, auth: auth };
}

function buildGmailMessageCard_(e) {
  var valid = getValidWorkspaceAuth_();
  var scan = scanMessageForSecureDoc_(e);
  var hasSecure =
    Boolean(scan.cipher) || (scan.attachments && scan.attachments.length > 0);

  if (!valid) {
    var card = CardService.newCardBuilder().setHeader(
      cardHeader_(
        "SecureDocShare",
        hasSecure ? "Encrypted mail — sign in" : "Sign in"
      )
    );
    if (hasSecure) {
      card.addSection(
        CardService.newCardSection()
          .addWidget(
            statusRow_(
              "This mail has SecureDoc content (sds. and/or encrypted file).",
              true
            )
          )
          .addWidget(
            infoRow_("Next step", "Sign in below to decrypt and download.")
          )
      );
    }
    card.addSection(buildLoginSection_(e));
    card.addSection(buildLinksSection_());
    return card.build();
  }

  if (hasSecure) {
    return buildAutoDecryptCard_(e, valid.session, scan);
  }

  return buildMainCard_(e);
}

/**
 * Encrypt data only result card — success/error message + Back to main page.
 * @param {string} kind
 * @param {string} message
 */
function buildEncryptOnlyStatusCard_(kind, message) {
  const statusKind = String(kind || "error");
  const isSuccess = statusKind === "encrypted" || statusKind === "success";
  const needsGmail = statusKind === "need_gmail";
  const subtitle = isSuccess
    ? "Encrypted"
    : needsGmail
      ? "Connect Gmail"
      : "Error";
  const fallbackMessage =
    typeof ENCRYPT_ONLY_MESSAGES !== "undefined"
      ? ENCRYPT_ONLY_MESSAGES.FAILED
      : "Could not encrypt the draft.";

  const section = CardService.newCardSection()
    .addWidget(
      CardService.newTextParagraph().setText(
        coloredStatusParagraphText_(statusKind, message || fallbackMessage)
      )
    )
    .addWidget(
      CardService.newButtonSet().addButton(
        CardService.newTextButton()
          .setText("Back")
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setOnClickAction(
            CardService.newAction().setFunctionName("onBackFromEncryptStatus_")
          )
      )
    );

  if (needsGmail) {
    const valid = getValidWorkspaceAuth_();
    const session = (valid && valid.session) || {};
    const connect = session.token
      ? apiGmailConnectUrl_(session.token)
      : { ok: false };
    if (connect.ok && connect.url) {
      section.addWidget(
        CardService.newButtonSet().addButton(
          CardService.newTextButton()
            .setText("Connect Gmail")
            .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            .setOpenLink(
              CardService.newOpenLink()
                .setUrl(connect.url)
                .setOpenAs(CardService.OpenAs.FULL_SIZE)
                .setOnClose(CardService.OnClose.RELOAD)
            )
        )
      );
    }
  }

  return CardService.newCardBuilder()
    .setHeader(cardHeader_("SecureDocShare", subtitle))
    .addSection(section)
    .build();
}

/** @deprecated Use buildEncryptOnlyStatusCard_ */
function buildEncryptOnlyResultCard_(kind, message) {
  return buildEncryptOnlyStatusCard_(kind, message);
}

/** Side panel: login screen OR tools (never tools without auth). */
function buildMainCard_(e) {
  var valid = getValidWorkspaceAuth_();

  if (!valid) {
    return CardService.newCardBuilder()
      .setHeader(cardHeader_("SecureDocShare", "Sign in"))
      .addSection(buildLoginSection_(e))
      .addSection(buildLinksSection_())
      .build();
  }

  var status =
    typeof peekComposeSidebarStatus_ === "function"
      ? peekComposeSidebarStatus_()
      : null;
  var subtitle = "Ready";
  if (status && status.kind === "encrypted") subtitle = "Encrypted";
  else if (status && status.kind === "success") subtitle = "Sent";
  else if (status && status.kind === "error") subtitle = "Error";
  else if (status && status.kind === "working") subtitle = "Working…";
  else if (status && status.kind === "need_gmail") subtitle = "Connect Gmail";

  var card = CardService.newCardBuilder().setHeader(
    cardHeader_("SecureDocShare", subtitle)
  );

  if (status && status.message) {
    var statusSection = CardService.newCardSection().addWidget(
      CardService.newTextParagraph().setText(
        coloredStatusParagraphText_(status.kind, status.message)
      )
    );

    if (status.kind === "need_gmail") {
      var session = valid.session || {};
      var connect = session.token
        ? apiGmailConnectUrl_(session.token)
        : { ok: false };
      if (connect.ok && connect.url) {
        statusSection.addWidget(
          CardService.newButtonSet().addButton(
            CardService.newTextButton()
              .setText("Connect Gmail")
              .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
              .setOpenLink(
                CardService.newOpenLink()
                  .setUrl(connect.url)
                  .setOpenAs(CardService.OpenAs.FULL_SIZE)
                  .setOnClose(CardService.OnClose.RELOAD)
              )
          )
        );
      }
    }

    statusSection.addWidget(
      CardService.newButtonSet().addButton(
        CardService.newTextButton()
          .setText("Dismiss")
          .setOnClickAction(
            CardService.newAction().setFunctionName("onDismissComposeStatus_")
          )
      )
    );
    card.addSection(statusSection);
  }

  card.addSection(buildSignedInSection_(valid.session, valid.auth));
  card.addSection(buildDecryptSection_(e));
  card.addSection(buildLinksSection_());
  return card.build();
}

function getCardAuthMode_(e) {
  var params = (e && e.parameters) || {};
  var form = (e && e.formInput) || {};
  if (params.authMode === "signup" || form.auth_mode === "signup") {
    return "signup";
  }
  var stored = PropertiesService.getUserProperties().getProperty(
    "SDS_CARD_AUTH_MODE"
  );
  return stored === "signup" ? "signup" : "login";
}

function setCardAuthMode_(mode) {
  PropertiesService.getUserProperties().setProperty(
    "SDS_CARD_AUTH_MODE",
    mode === "signup" ? "signup" : "login"
  );
}

/**
 * Account section — login / signup options:

 * Log in / Sign up, email+password, OTP on signup, Continue with Google.
 */
function buildLoginSection_(e) {
  var mode = getCardAuthMode_(e);
  var isSignup = mode === "signup";
  var otpSent =
    PropertiesService.getUserProperties().getProperty("SDS_CARD_OTP_SENT") ===
    "1";
  var draft = typeof loadCardSignupDraft_ === "function" ? loadCardSignupDraft_() : null;
  var draftEmail = draft && draft.email ? String(draft.email) : "";
  var draftPassword = draft && draft.password ? String(draft.password) : "";
  var draftTerms = Boolean(draft && draft.acceptTerms === true);

  var section = CardService.newCardSection().setHeader("Account");

  section.addWidget(
    CardService.newTextParagraph().setText(
      isSignup ? "<b>Sign up</b>" : "<b>Log in</b>"
    )
  );

  var emailInput = CardService.newTextInput()
    .setFieldName("login_email")
    .setTitle("Email")
    .setHint("you@company.com");
  if (isSignup && draftEmail) emailInput.setValue(draftEmail);

  var passwordInput = CardService.newTextInput()
    .setFieldName("login_password")
    .setTitle("Password");
  if (isSignup && draftPassword) passwordInput.setValue(draftPassword);

  section.addWidget(emailInput).addWidget(passwordInput);

  if (isSignup) {
    section.addWidget(
      CardService.newSelectionInput()
        .setType(CardService.SelectionInputType.CHECK_BOX)
        .setFieldName("accept_terms")
        .addItem("I agree to the Terms & Conditions", "yes", draftTerms)
    );
  }

  if (isSignup && otpSent) {
    section.addWidget(
      CardService.newTextInput()
        .setFieldName("signup_otp")
        .setTitle("4-digit verification code")
        .setHint("••••")
    );
    section.addWidget(
      CardService.newButtonSet().addButton(
        secondaryBtn_("Resend code", "onCardResendOtp_")
      )
    );
  }

  var primaryLabel = isSignup
    ? otpSent
      ? "Verify & sign up"
      : "Send verification code"
    : "Log in";

  section.addWidget(
    CardService.newButtonSet().addButton(
      primaryBtn_(primaryLabel, "onCardLogin_")
    )
  );

  section.addWidget(
    CardService.newButtonSet().addButton(
      CardService.newTextButton()
        .setText("Continue with Google")
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setOnClickAction(
          CardService.newAction().setFunctionName("onCardGoogleSignIn_")
        )
    )
  );

  section.addWidget(
    CardService.newButtonSet().addButton(
      CardService.newTextButton()
        .setText(
          isSignup
            ? "Already have an account? Log in"
            : "Need an account? Sign up"
        )
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName("onCardToggleAuthMode_")
            .setParameters({ authMode: isSignup ? "login" : "signup" })
        )
    )
  );

 

  return section;
}

function buildSignedInSection_(session, prefetchedAuth) {
  var subLine = "Checking subscription…";
  var check =
    prefetchedAuth && typeof prefetchedAuth.ok === "boolean"
      ? prefetchedAuth
      : apiGetSubscription_(session.token);
  var ok = false;
  if (check.ok) {
    ok = Boolean(check.subscriptionActive);
    subLine = ok ? "Subscription active" : "Subscription inactive";
  }

  return CardService.newCardSection()
    .setHeader("Account")
    .addWidget(
      CardService.newDecoratedText()
        .setTopLabel("Signed in")
        .setText(String(session.email || "user"))
        .setBottomLabel(subLine)
        .setWrapText(true)
        .setStartIcon(
          CardService.newIconImage().setIconUrl(
            ok
              ? "https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/verified_user/default/24px.svg"
              : "https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/person/default/24px.svg"
          )
        )
    )
    .addWidget(
      CardService.newButtonSet()
        .addButton(
          CardService.newTextButton()
            .setText("Encrypt & send draft")
            .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            .setOnClickAction(
              CardService.newAction().setFunctionName("onSidebarEncryptAndSend_")
            )
        )
    )
    .addWidget(
      CardService.newButtonSet().addButton(
        CardService.newTextButton()
          .setText("Encrypt data only")
          .setOnClickAction(
            CardService.newAction().setFunctionName("onSidebarEncryptOnly_")
          )
      )
    )
    .addWidget(
      CardService.newTextParagraph().setText(
        "Encrypt data only updates your open draft (no send). Encrypt & send encrypts and sends."
      )
    )
    .addWidget(
      CardService.newButtonSet()
        .addButton(secondaryBtn_("Refresh", "onCardBack_"))
        .addButton(secondaryBtn_("Sign out", "onCardLogout_"))
    );
}

function buildDecryptSection_(e) {
  var detected = "";
  var scan = { cipher: "", attachments: [] };
  try {
    scan = scanMessageForSecureDoc_(e) || scan;
    detected = scan.cipher || "";
  } catch (err) {
    detected = "";
  }

  var section = CardService.newCardSection()
    .setHeader("Decrypt")
    .setCollapsible(true)
    .setNumUncollapsibleWidgets(1);

  if (detected) {
    section.addWidget(
      statusRow_("Encrypted sds. message detected in this mail.", true)
    );
  } else {
    section.addWidget(
      infoRow_(
        "Manual decrypt",
        "Paste an sds. token, or open an encrypted mail for auto-decrypt."
      )
    );
  }

  section
    .addWidget(
      CardService.newTextInput()
        .setFieldName("decrypt_cipher")
        .setTitle("Message ciphertext")
        .setMultiline(true)
        .setValue(detected || "")
    )
    .addWidget(
      CardService.newButtonSet().addButton(
        primaryBtn_("Decrypt message", "onCardDecrypt_")
      )
    );

  addHomePdfDownloadWidgets_(section, e, scan);

  return section;
}

/**
 * List secure attachments and offer download — decrypt only when the user clicks.
 */
function addHomePdfDownloadWidgets_(section, e, scan) {
  var atts = (scan && scan.attachments) || [];
  if (!atts.length) {
    return;
  }

  var session = getWorkspaceSession_();
  if (!session || !session.token) {
    section.addWidget(
      infoRow_(
        "Secure attachment",
        atts.length +
          " encrypted file(s) found. Sign in, then tap Download decrypted file."
      )
    );
    return;
  }

  section.addWidget(
    statusRow_(
      atts.length + " encrypted attachment(s) ready to decrypt.",
      true
    )
  );
  section.addWidget(
    CardService.newButtonSet().addButton(
      CardService.newTextButton()
        .setText("Download decrypted file")
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setOnClickAction(
          CardService.newAction().setFunctionName("onHomeDownloadPdf_")
        )
    )
  );
}

function onHomeDownloadPdf_(e) {
  try {
    var valid = getValidWorkspaceAuth_();
    if (!valid) {
      return CardService.newActionResponseBuilder()
        .setNavigation(CardService.newNavigation().updateCard(buildMainCard_(e)))
        .setNotification(
          CardService.newNotification().setText("Sign in first to download.")
        )
        .build();
    }
    var session = valid.session;
    var auth = valid.auth;
    var scan = scanMessageForSecureDoc_(e);
    if (!scan.attachments || !scan.attachments.length) {
      return CardService.newActionResponseBuilder()
        .setNavigation(
          CardService.newNavigation().updateCard(
            buildDecryptErrorCard_("No secure attachment found on this mail.")
          )
        )
        .setNotification(
          CardService.newNotification().setText("No secure attachment found.")
        )
        .build();
    }

    var email = auth.email || session.email || "";
    if (!email) {
      return CardService.newActionResponseBuilder()
        .setNavigation(
          CardService.newNavigation().updateCard(
            buildDecryptErrorCard_(
              "Signed-in email missing. Sign out and sign in again."
            )
          )
        )
        .setNotification(
          CardService.newNotification().setText("Signed-in email missing.")
        )
        .build();
    }

    var section = CardService.newCardSection().setHeader("Downloads");
    var readyCount = 0;
    var failCount = 0;
    var i;
    for (i = 0; i < scan.attachments.length; i++) {
      var att = scan.attachments[i];
      var fileDec = apiDecrypt_({
        email: email,
        fileCipherText: att.base64,
        token: session.token,
      });
      if (!fileDec.ok) {
        failCount += 1;
        section.addWidget(
          statusRow_(
            (att.name || "file") +
              ": " +
              formatDecryptError_(fileDec, "decrypt failed"),
            false
          )
        );
        continue;
      }
      var fileInfo = fileDec.file || null;
      var dataB64 =
        (fileInfo &&
          (fileInfo.dataBase64 || fileInfo.base64 || fileInfo.data)) ||
        null;
      // Skip message-only packages (.securemsg) — those belong in Message, not Files.
      if (!dataB64 && fileDec.message) {
        continue;
      }
      if (!dataB64) {
        failCount += 1;
        section.addWidget(
          statusRow_(
            (att.name || "file") +
              ": decrypt returned no file data. Try Refresh or open the mail again.",
            false
          )
        );
        continue;
      }

      var meta = normalizeDecryptedFileMeta_(
        att.name,
        fileInfo,
        fileDec.filename
      );
      var ready = prepareDecryptedDownload_(meta.name, meta.mime, dataB64);
      if (ready.ok && ready.downloadUrl) {
        readyCount += 1;
        section.addWidget(
          CardService.newDecoratedText()
            .setTopLabel("Ready")
            .setText(meta.name)
            .setBottomLabel("From " + (att.name || "secure file"))
            .setWrapText(true)
        );
        section.addWidget(
          CardService.newButtonSet().addButton(
            CardService.newTextButton()
              .setText("⬇ Download")
              .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
              .setOpenLink(
                CardService.newOpenLink()
                  .setUrl(ready.downloadUrl)
                  .setOpenAs(CardService.OpenAs.FULL_SIZE)
                  .setOnClose(CardService.OnClose.NOTHING)
              )
          )
        );
      } else {
        failCount += 1;
        section.addWidget(
          statusRow_(
            meta.name + ": " + (ready.error || "download not ready"),
            false
          )
        );
      }
    }

    var card = CardService.newCardBuilder()
      .setHeader(
        cardHeader_(
          "SecureDocShare",
          readyCount ? "Downloads" : "Decrypt failed"
        )
      )
      .addSection(section)
      .addSection(
        CardService.newCardSection().addWidget(
          CardService.newButtonSet().addButton(
            secondaryBtn_("Back", "onCardBack_")
          )
        )
      )
      .build();

    var note = readyCount
      ? readyCount + " file(s) ready to download."
      : failCount
        ? "Could not decrypt attachment(s). See error details on the card."
        : "Could not prepare downloads.";

    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().updateCard(card))
      .setNotification(CardService.newNotification().setText(note))
      .build();
  } catch (err) {
    var crash =
      "Decrypt error: " + String(err && err.message ? err.message : err);
    return CardService.newActionResponseBuilder()
      .setNavigation(
        CardService.newNavigation().updateCard(buildDecryptErrorCard_(crash))
      )
      .setNotification(CardService.newNotification().setText(crash))
      .build();
  }
}

function buildAutoDecryptCard_(e, session, scan) {
  var auth = apiGetSubscription_(session.token);
  if (!auth.ok) {
    clearWorkspaceSession();
    return CardService.newCardBuilder()
      .setHeader(cardHeader_("SecureDocShare", "Session expired"))
      .addSection(
        CardService.newCardSection().addWidget(
          statusRow_(
            auth.error || "Login expired. Sign in again to decrypt.",
            false
          )
        )
      )
      .addSection(buildLoginSection_(e))
      .addSection(buildLinksSection_())
      .build();
  }

  var email = auth.email || session.email || "";
  var statusSection = CardService.newCardSection().setHeader("Status");
  var messageSection = CardService.newCardSection().setHeader("Message");
  var filesSection = CardService.newCardSection().setHeader("Files");
  var hasMessageUi = false;
  var hasFileUi = false;
  var anyFailed = false;

  if (!email) {
    statusSection.addWidget(
      statusRow_(
        "Signed-in email missing. Sign out and sign in again to decrypt.",
        false
      )
    );
    return CardService.newCardBuilder()
      .setHeader(cardHeader_("SecureDocShare", "Decrypt failed"))
      .addSection(statusSection)
      .addSection(buildSignedInSection_(session, auth))
      // .addSection(
      //   CardService.newCardSection().addWidget(
      //     CardService.newButtonSet()
      //       .addButton(secondaryBtn_("Refresh", "onRefreshAutoDecrypt_"))
      //       .addButton(secondaryBtn_("Home", "onCardBack_"))
      //   )
      // )
      .build();
  }

  var foundBits = [];
  if (scan.cipher) foundBits.push("encrypted message");
  if (scan.attachments && scan.attachments.length) {
    foundBits.push(scan.attachments.length + " secure attachment(s)");
  }
  statusSection.addWidget(
    statusRow_("Detected: " + foundBits.join(" + "), true)
  );

  if (scan.cipher) {
    try {
      var msgDec = apiDecrypt_({
        email: email,
        messageCipherText: scan.cipher,
        token: session.token,
      });
      if (msgDec.ok && msgDec.message) {
        hasMessageUi = true;
        messageSection.addWidget(statusRow_("Message decrypted", true));
        addDecryptedMessagePreview_(
          messageSection,
          "auto_plain_message",
          "Decrypted message",
          String(msgDec.message)
        );
      } else {
        hasMessageUi = true;
        anyFailed = true;
        messageSection.addWidget(
          statusRow_(
            "Message decrypt failed: " +
              formatDecryptError_(
                msgDec,
                msgDec && msgDec.ok
                  ? "no message text returned"
                  : "unknown error"
              ),
            false
          )
        );
      }
    } catch (msgErr) {
      hasMessageUi = true;
      anyFailed = true;
      messageSection.addWidget(
        statusRow_(
          "Message decrypt error: " +
            String(msgErr && msgErr.message ? msgErr.message : msgErr),
          false
        )
      );
    }
  }

  var i;
  for (i = 0; i < (scan.attachments || []).length; i++) {
    var att = scan.attachments[i];
    try {
      var fileDec = apiDecrypt_({
        email: email,
        fileCipherText: att.base64,
        token: session.token,
      });
      if (!fileDec.ok) {
        hasFileUi = true;
        anyFailed = true;
        filesSection.addWidget(
          statusRow_(
            (att.name || "attachment") +
              " — " +
              formatDecryptError_(fileDec, "decrypt failed"),
            false
          )
        );
        continue;
      }

      var fileInfo = fileDec.file || null;
      var dataB64 =
        (fileInfo &&
          (fileInfo.dataBase64 || fileInfo.base64 || fileInfo.data)) ||
        null;
      var attMessage = fileDec.message ? String(fileDec.message) : "";

      // Message-only packages (.securemsg / cipher-as-attachment): show once
      // under Message — never duplicate under Files.
      if (attMessage && !hasMessageUi) {
        hasMessageUi = true;
        messageSection.addWidget(statusRow_("Message decrypted", true));
        addDecryptedMessagePreview_(
          messageSection,
          "auto_att_msg_" + i,
          "Decrypted message",
          attMessage
        );
      }

      if (dataB64) {
        hasFileUi = true;
        var meta = normalizeDecryptedFileMeta_(
          att.name,
          fileInfo,
          fileDec.filename
        );
        var ready = prepareDecryptedDownload_(meta.name, meta.mime, dataB64);
        if (ready.ok && ready.downloadUrl) {
          filesSection.addWidget(
            CardService.newDecoratedText()
              .setTopLabel("Attachment")
              .setText(meta.name)
              .setBottomLabel("From " + (att.name || "secure file"))
              .setWrapText(true)
          );
          filesSection.addWidget(
            CardService.newButtonSet().addButton(
              CardService.newTextButton()
                .setText("⬇ Download file")
                .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
                .setOpenLink(
                  CardService.newOpenLink()
                    .setUrl(ready.downloadUrl)
                    .setOpenAs(CardService.OpenAs.FULL_SIZE)
                    .setOnClose(CardService.OnClose.NOTHING)
                )
            )
          );
        } else {
          anyFailed = true;
          filesSection.addWidget(
            statusRow_(
              meta.name + ": " + (ready.error || "download not ready"),
              false
            )
          );
        }
      } else if (!attMessage) {
        hasFileUi = true;
        anyFailed = true;
        filesSection.addWidget(
          statusRow_(
            (att.name || "attachment") +
              " — decrypt returned no file data.",
            false
          )
        );
      }
      // else: message-only attachment already handled in Message section — skip Files.
    } catch (fileErr) {
      hasFileUi = true;
      anyFailed = true;
      filesSection.addWidget(
        statusRow_(
          (att.name || "attachment") +
            " — " +
            String(fileErr && fileErr.message ? fileErr.message : fileErr),
          false
        )
      );
    }
  }

  if (anyFailed) {
    statusSection.addWidget(
      statusRow_(
        "One or more items could not be decrypted. See details below.",
        false
      )
    );
  }

  var builder = CardService.newCardBuilder().setHeader(
    cardHeader_(
      "SecureDocShare",
      anyFailed && !hasMessageUi && !hasFileUi
        ? "Decrypt failed"
        : anyFailed
          ? "Decrypted with errors"
          : "Decrypted"
    )
  );
  builder.addSection(statusSection);
  if (hasMessageUi) builder.addSection(messageSection);
  if (hasFileUi) builder.addSection(filesSection);
  builder.addSection(buildSignedInSection_(session, auth));
  // builder.addSection(
  //   CardService.newCardSection().addWidget(
  //     CardService.newButtonSet()
  //       .addButton(secondaryBtn_("Refresh", "onRefreshAutoDecrypt_"))
  //       .addButton(secondaryBtn_("Home", "onCardBack_"))
  //   )
  // );
  builder.addSection(buildLinksSection_());
  return builder.build();
}

function onRefreshAutoDecrypt_(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildGmailMessageCard_(e)))
    .build();
}

function buildLinksSection_() {
  return CardService.newCardSection()
    .setHeader("More")
    .addWidget(
      CardService.newTextButton()
        .setText("Open admin panel")
        .setOpenLink(
          CardService.newOpenLink()
            .setUrl(ADMIN_URL)
            .setOpenAs(CardService.OpenAs.FULL_SIZE)
            .setOnClose(CardService.OnClose.NOTHING)
        )
    );
}

function onCardToggleAuthMode_(e) {
  var params = (e && e.parameters) || {};
  var next = params.authMode === "signup" ? "signup" : "login";
  setCardAuthMode_(next);
  PropertiesService.getUserProperties().deleteProperty("SDS_CARD_OTP_SENT");
  clearCardSignupDraft_();
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildMainCard_(e)))
    .build();
}

var CARD_SIGNUP_DRAFT_KEY = "SDS_CARD_SIGNUP_DRAFT";

function saveCardSignupDraft_(email, password, acceptTerms) {
  PropertiesService.getUserProperties().setProperty(
    CARD_SIGNUP_DRAFT_KEY,
    JSON.stringify({
      email: String(email || "").trim(),
      password: String(password || ""),
      acceptTerms: Boolean(acceptTerms),
    })
  );
}

function loadCardSignupDraft_() {
  try {
    var raw = PropertiesService.getUserProperties().getProperty(
      CARD_SIGNUP_DRAFT_KEY
    );
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function clearCardSignupDraft_() {
  PropertiesService.getUserProperties().deleteProperty(CARD_SIGNUP_DRAFT_KEY);
}

function onCardGoogleSignIn_(e) {
  var form = (e && e.formInput) || {};
  var mode = getCardAuthMode_(e);
  var isSignup = mode === "signup";
  if (isSignup) {
    var terms = form.accept_terms;
    var accepted =
      terms === "yes" ||
      (Array.isArray(terms) && terms.indexOf("yes") >= 0);
    if (!accepted) {
      return notify_("Accept Terms & Conditions to sign up with Google.");
    }
  }
  var url;
  try {
    url = getGoogleLoginUrl({
      intent: isSignup ? "signup" : "login",
      acceptTerms: true,
    });
  } catch (err) {
    return notify_(String(err.message || err));
  }
  if (!url) {
    return notify_("Google sign-in URL is not configured.");
  }
  return CardService.newActionResponseBuilder()
    .setOpenLink(
      CardService.newOpenLink()
        .setUrl(url)
        .setOpenAs(CardService.OpenAs.FULL_SIZE)
        .setOnClose(CardService.OnClose.RELOAD_ADD_ON)
    )
    .build();
}

function onCardResendOtp_(e) {
  var form = (e && e.formInput) || {};
  var draft = loadCardSignupDraft_() || {};
  var email = String(form.login_email || draft.email || "").trim();
  if (!email) return notify_("Enter email first.");
  var terms = form.accept_terms;
  var accepted =
    terms === "yes" ||
    (Array.isArray(terms) && terms.indexOf("yes") >= 0) ||
    draft.acceptTerms === true;
  if (!accepted) {
    return notify_("Accept Terms & Conditions to sign up.");
  }
  var password = String(form.login_password || draft.password || "");
  saveCardSignupDraft_(email, password, true);
  var sent = apiSignupSendOtp_(email, true);
  if (!sent.ok) return notify_(sent.error || "Could not send code.");
  PropertiesService.getUserProperties().setProperty("SDS_CARD_OTP_SENT", "1");
  setCardAuthMode_("signup");
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildMainCard_(e)))
    .setNotification(
      CardService.newNotification().setText(
        sent.devOtp ? "Dev code: " + sent.devOtp : "Verification code sent."
      )
    )
    .build();
}

function onCardLogin_(e) {
  var form = (e && e.formInput) || {};
  var draft = loadCardSignupDraft_() || {};
  var email = String(form.login_email || draft.email || "").trim();
  var password = String(form.login_password || draft.password || "");
  var mode = getCardAuthMode_(e);
  var isSignup = mode === "signup";

  if (!email || !password) {
    return notify_("Email and password are required.");
  }

  if (isSignup) {
    var terms = form.accept_terms;
    var accepted =
      terms === "yes" ||
      (Array.isArray(terms) && terms.indexOf("yes") >= 0) ||
      draft.acceptTerms === true;
    if (!accepted) {
      return notify_("Accept Terms & Conditions to sign up.");
    }

    var otpSent =
      PropertiesService.getUserProperties().getProperty("SDS_CARD_OTP_SENT") ===
      "1";
    if (!otpSent) {
      var send = apiSignupSendOtp_(email, true);
      if (!send.ok) return notify_(send.error || "Could not send code.");
      saveCardSignupDraft_(email, password, true);
      PropertiesService.getUserProperties().setProperty("SDS_CARD_OTP_SENT", "1");
      return CardService.newActionResponseBuilder()
        .setNavigation(CardService.newNavigation().updateCard(buildMainCard_(e)))
        .setNotification(
          CardService.newNotification().setText(
            send.devOtp
              ? "Dev code: " + send.devOtp
              : "Code sent. Enter it below, then Verify & sign up."
          )
        )
        .build();
    }

    var otp = String(form.signup_otp || "").trim();
    if (!/^\d{4}$/.test(otp)) {
      return notify_("Enter the 4-digit verification code.");
    }
    var signed = apiSignup_(email, password, otp, true);
    if (!signed.ok) return notify_(signed.error || "Signup failed.");
    PropertiesService.getUserProperties().deleteProperty("SDS_CARD_OTP_SENT");
    clearCardSignupDraft_();
    setCardAuthMode_("login");
    saveWorkspaceSession({
      token: signed.token,
      email: signed.email || email,
      expiresAt: signed.expiresAt || null,
    });
    return CardService.newActionResponseBuilder()
      .setNavigation(
        CardService.newNavigation().updateCard(buildGmailMessageCard_(e))
      )
      .setNotification(
        CardService.newNotification().setText(
          "Account created — signed in as " + (signed.email || email)
        )
      )
      .build();
  }

  var result = apiLogin_(email, password);
  if (!result.ok) {
    return notify_(result.error || "Login failed.");
  }

  PropertiesService.getUserProperties().deleteProperty("SDS_CARD_OTP_SENT");
  saveWorkspaceSession({
    token: result.token,
    email: result.email || email,
    expiresAt: result.expiresAt || null,
  });

  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation().updateCard(buildGmailMessageCard_(e))
    )
    .setNotification(
      CardService.newNotification().setText(
        "Signed in as " + (result.email || email)
      )
    )
    .build();
}

function onCardLogout_(e) {
  var session = getWorkspaceSession_();
  if (session && session.token) {
    try {
      UrlFetchApp.fetch(API_BASE + "/auth/logout", {
        method: "post",
        contentType: "application/json",
        headers: { Authorization: "Bearer " + session.token },
        payload: "{}",
        muteHttpExceptions: true,
      });
    } catch (err) {}
  }
  clearWorkspaceSession();
  setCardAuthMode_("login");
  PropertiesService.getUserProperties().deleteProperty("SDS_CARD_OTP_SENT");
  clearCardSignupDraft_();
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildMainCard_(e)))
    .setNotification(CardService.newNotification().setText("Signed out."))
    .build();
}

function onCardDecrypt_(e) {
  try {
    var form = (e && e.formInput) || {};
    var cipher = String(form.decrypt_cipher || "").trim();
    if (!cipher) {
      try {
        cipher = extractCipherFromMessage_(e) || "";
      } catch (err) {}
    }
    if (!cipher) {
      return CardService.newActionResponseBuilder()
        .setNavigation(
          CardService.newNavigation().updateCard(
            buildDecryptErrorCard_("Paste ciphertext first, then decrypt.")
          )
        )
        .setNotification(
          CardService.newNotification().setText("Paste ciphertext first.")
        )
        .build();
    }

    var valid = getValidWorkspaceAuth_();
    if (!valid) {
      return CardService.newActionResponseBuilder()
        .setNavigation(CardService.newNavigation().updateCard(buildMainCard_(e)))
        .setNotification(
          CardService.newNotification().setText("Sign in first, then decrypt.")
        )
        .build();
    }

    var email = valid.auth.email || valid.session.email || "";
    if (!email) {
      return CardService.newActionResponseBuilder()
        .setNavigation(
          CardService.newNavigation().updateCard(
            buildDecryptErrorCard_(
              "Signed-in email missing. Sign out and sign in again, then decrypt."
            )
          )
        )
        .setNotification(
          CardService.newNotification().setText("Signed-in email missing.")
        )
        .build();
    }

    var dec = apiDecrypt_({
      email: email,
      messageCipherText: cipher,
      token: valid.session.token,
    });
    if (!dec.ok) {
      var errText = formatDecryptError_(dec, "Decrypt failed.");
      return CardService.newActionResponseBuilder()
        .setNavigation(
          CardService.newNavigation().updateCard(buildDecryptErrorCard_(errText))
        )
        .setNotification(CardService.newNotification().setText(errText))
        .build();
    }

    if (!String(dec.message || "").trim()) {
      var emptyErr =
        "Decrypt succeeded but no message text was returned. Check the ciphertext and try again.";
      return CardService.newActionResponseBuilder()
        .setNavigation(
          CardService.newNavigation().updateCard(buildDecryptErrorCard_(emptyErr))
        )
        .setNotification(CardService.newNotification().setText(emptyErr))
        .build();
    }

    var section = CardService.newCardSection().addWidget(
      CardService.newTextParagraph().setText(dec.message)
    );
    section.addWidget(
      CardService.newTextButton()
        .setText("Back")
        .setOnClickAction(CardService.newAction().setFunctionName("onCardBack_"))
    );

    var card = CardService.newCardBuilder()
      .setHeader(cardHeader_("Decrypted", "SecureDocShare"))
      .addSection(section)
      .build();

    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().pushCard(card))
      .setNotification(
        CardService.newNotification().setText("Message decrypted.")
      )
      .build();
  } catch (err) {
    var crash =
      "Decrypt error: " + String(err && err.message ? err.message : err);
    return CardService.newActionResponseBuilder()
      .setNavigation(
        CardService.newNavigation().updateCard(buildDecryptErrorCard_(crash))
      )
      .setNotification(CardService.newNotification().setText(crash))
      .build();
  }
}

function onCardBack_(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildMainCard_(e)))
    .build();
}

function onDismissComposeStatus_(e) {
  if (typeof clearComposeSidebarStatus_ === "function") {
    clearComposeSidebarStatus_();
  }
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildMainCard_(e)))
    .build();
}

/** Back from Encrypt data only success/error → clear status and open main page. */
function onBackFromEncryptStatus_(e) {
  if (typeof clearComposeSidebarStatus_ === "function") {
    clearComposeSidebarStatus_();
  }
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildMainCard_(e)))
    .build();
}

function getComposeDraftMeta_(e) {
  var gmail = (e && e.gmail) || {};
  var meta = (e && e.draftMetadata) || {};
  var toList =
    gmail.toRecipients ||
    meta.toRecipients ||
    meta.toRecipient ||
    [];
  var ccList = gmail.ccRecipients || meta.ccRecipients || [];
  var bccList = gmail.bccRecipients || meta.bccRecipients || [];
  if (typeof toList === "string") toList = [toList];
  if (typeof ccList === "string") ccList = [ccList];
  if (typeof bccList === "string") bccList = [bccList];
  var to = [];
  var i;
  for (i = 0; i < (toList || []).length; i++) {
    var t = String(toList[i] || "").trim();
    if (t) to.push(t);
  }
  return {
    to: to,
    toJoined: to.join(", "),
    cc: ccList || [],
    bcc: bccList || [],
    subject: String(gmail.subject || meta.subject || "").trim(),
  };
}

function resolveComposeEncryptPayload_(e, gmailAccessToken, opts) {
  opts = opts || {};
  const preferPlainBody = opts.preferPlainBody === true;
  const draftMeta = getComposeDraftMeta_(e);
  const toList =
    draftMeta.to && draftMeta.to.length ? draftMeta.to.slice() : [];

  let matched = findMatchingGmailDraft_(
    toList,
    draftMeta.subject || "",
    gmailAccessToken,
    { preferPlainBody: preferPlainBody }
  );

  // Compose toolbar passes To from METADATA. That often matches an older
  // already-encrypted draft, while the open plain compose (same as sidebar)
  // may not have To synced yet. Fall back to sidebar-style match (no To filter)
  // so the first click encrypts the plain draft.
  if (
    preferPlainBody &&
    matched &&
    matched.ok &&
    matched.isEncryptedBody &&
    toList.length
  ) {
    const plainFallback = findMatchingGmailDraft_(
      [],
      draftMeta.subject || "",
      gmailAccessToken,
      { preferPlainBody: true }
    );
    if (plainFallback && plainFallback.ok && !plainFallback.isEncryptedBody) {
      matched = plainFallback;
    }
  }

  let firstTo = "";
  if (toList.length) {
    firstTo = normalizeEmailAddress_(toList[0]) || String(toList[0]).trim();
  } else if (matched.ok && matched.toEmails && matched.toEmails.length) {
    firstTo = matched.toEmails[0];
  }

  const subject =
    (draftMeta.subject && String(draftMeta.subject).trim()) ||
    (matched.ok && matched.subject) ||
    "";
  const message = (matched.ok && matched.body) || "";

  const toJoined =
    toList.join(", ") ||
    (matched.ok && matched.toHeader) ||
    firstTo;

  return {
    firstTo: firstTo,
    toJoined: toJoined,
    toList: toList,
    subject: subject,
    message: message,
    matched: matched,
    files:
      matched && matched.ok && Array.isArray(matched.files)
        ? matched.files
        : [],
  };
}

function composeSendCacheKey_(to, subject) {
  return (
    "sds_compose_sent_" +
    Utilities.base64EncodeWebSafe(
      String(to || "").toLowerCase() + "|" + String(subject || "").toLowerCase()
    ).slice(0, 80)
  );
}

function rememberComposeSendSuccess_(result) {
  result = result || {};
  try {
    var key = composeSendCacheKey_(result.firstTo || "", result.subject || "");
    CacheService.getUserCache().put(
      key,
      JSON.stringify({
        ok: true,
        sent: true,
        firstTo: result.firstTo || "",
        subject: result.subject || "",
        warning: result.warning || "",
        oldDraftDeleted: Boolean(result.oldDraftDeleted),
        at: Date.now(),
      }),
      120
    );
  } catch (e) {}
}

function getRecentComposeSendSuccess_(to, subject) {
  try {
    var key = composeSendCacheKey_(to || "", subject || "");
    var raw = CacheService.getUserCache().get(key);
    if (!raw) return null;
    var data = JSON.parse(raw);
    if (!data || !data.ok || !data.sent) return null;
    if (Date.now() - Number(data.at || 0) > 120000) return null;
    return data;
  } catch (e) {
    return null;
  }
}

function isMissingDraftError_(result) {
  if (!result) return false;
  if (result.code === "NO_DRAFTS" || result.code === "NO_DRAFT_MATCH") {
    return true;
  }
  return /No drafts found|Could not match an open draft|Wait for Gmail to autosave/i.test(
    String(result.error || "")
  );
}

/**
 * After a successful send the plaintext draft is deleted. A second toolbar
 * click then hits "No drafts found" even though the mail already went out.
 * Cache + lock turn that into a clear success.
 */
function runComposeEncryptAndSendCore_(e) {
  var draftMetaEarly = getComposeDraftMeta_(e);
  var earlyTo = "";
  if (draftMetaEarly.to && draftMetaEarly.to.length) {
    earlyTo =
      normalizeEmailAddress_(draftMetaEarly.to[0]) ||
      String(draftMetaEarly.to[0]).trim();
  }
  var earlySubject = draftMetaEarly.subject || "";

  var lock = LockService.getUserLock();
  var gotLock = false;
  try {
    gotLock = lock.tryLock(45000);
  } catch (eLock) {
    gotLock = false;
  }

  try {
    var result = runComposeEncryptAndSendCoreUnlocked_(e, { encryptOnly: false });
    if (!result.ok && isMissingDraftError_(result)) {
      var recent = getRecentComposeSendSuccess_(
        result.firstTo || earlyTo,
        result.subject || earlySubject
      );
      if (recent) {
        return {
          ok: true,
          sent: true,
          sendError: "",
          oldDraftDeleted: Boolean(recent.oldDraftDeleted),
          warning: recent.warning || "",
          firstTo: recent.firstTo || earlyTo,
          subject: recent.subject || earlySubject,
          bodyHtml: "",
          fromCache: true,
        };
      }
    }
    return result;
  } finally {
    if (gotLock) {
      try {
        lock.releaseLock();
      } catch (eRel) {}
    }
  }
}

/** Encrypt draft body and update via Gmail drafts.update — does not send. */
function runComposeEncryptOnlyCore_(e) {
  var lock = LockService.getUserLock();
  var gotLock = false;
  try {
    gotLock = lock.tryLock(45000);
  } catch (eLock) {
    gotLock = false;
  }
  try {
    return runComposeEncryptAndSendCoreUnlocked_(e, { encryptOnly: true });
  } finally {
    if (gotLock) {
      try {
        lock.releaseLock();
      } catch (eRel) {}
    }
  }
}

function runComposeEncryptAndSendCoreUnlocked_(e, opts) {
  opts = opts || {};
  var encryptOnly = opts.encryptOnly === true;

  var gate = verifyLoginAndSubscription_();
  if (!gate.ok) {
    return {
      ok: false,
      needLogin: true,
      error: gate.error || "Login / subscription required.",
    };
  }

  var tokenRes = getMarketplaceGmailAccess_(gate.token);
  if (!tokenRes.ok || !tokenRes.accessToken) {
    return {
      ok: false,
      needGmailConnect: true,
      error:
        tokenRes.error ||
        "Connect Gmail once with your Google account, then try again.",
      code: tokenRes.code || "GMAIL_NOT_CONNECTED",
    };
  }

  const accessToken = tokenRes.accessToken;
  const payload = resolveComposeEncryptPayload_(e, accessToken, {
    preferPlainBody: encryptOnly,
  });
  if (
    payload.matched &&
    payload.matched.ok === false &&
    payload.matched.error
  ) {
    return {
      ok: false,
      error: payload.matched.error,
      code: payload.matched.code || "",
    };
  }
  if (!payload.firstTo) {
    return {
      ok: false,
      error:
        "Add a recipient in To, wait for Gmail autosave, then try again.",
    };
  }

  var draftFiles = payload.files || [];
  var blockedExts =
    typeof apiFetchBlockedFileExtensions_ === "function"
      ? apiFetchBlockedFileExtensions_()
      : [];
  var blockedAtt =
    typeof findBlockedDraftAttachment_ === "function"
      ? findBlockedDraftAttachment_(draftFiles, blockedExts)
      : null;

  // Same as Outlook: blocked extension → error, do not encrypt message/file.
  if (blockedAtt) {
    var blockedExt =
      (typeof extensionFromFileName_ === "function"
        ? extensionFromFileName_(blockedAtt.name)
        : "") || "file";
    return {
      ok: false,
      code: "FILE_EXTENSION_BLOCKED",
      error:
        "." +
        blockedExt +
        " [blocked extension] is blocked in this app. Nothing was encrypted. Remove the file, then try again.",
    };
  }

  var fileToEncrypt =
    typeof pickDraftFileToEncrypt_ === "function"
      ? pickDraftFileToEncrypt_(draftFiles, blockedExts)
      : null;

  if (!String(payload.message || "").trim() && !fileToEncrypt) {
    return {
      ok: false,
      error:
        (payload.matched && payload.matched.error) ||
        "No draft body or attachment found. Add a message or file, wait for autosave, then try again.",
    };
  }

  // Reply/forward handling (Encrypt & send only):
  // - Decrypt any parent sds. with the signed-in user's keys
  // - Strip old sdmeta (avoid duplicate / glued "testsdmeta")
  // - Pure forward / empty new body: re-encrypt decrypted plain for the NEW To
  // - Reply with new text: encrypt only the new text; append clear parent (no old meta)
  // Encrypt data only: never decrypt — encrypt plain body/file only.
  let messageToEncrypt = "";
  let quotedAppendix = "";
  const subject = payload.subject || "Secure document";

  if (encryptOnly) {
    let plainBody = String(payload.message || "").trim();
    if (/sds\./i.test(plainBody)) {
      const splitBody = splitComposeNewAndQuoted_(plainBody);
      const newPlainText = String(splitBody.newText || "").trim();
      if (newPlainText && !/sds\./i.test(newPlainText)) {
        plainBody = newPlainText;
      } else {
        return {
          ok: false,
          error: ENCRYPT_ONLY_MESSAGES.ALREADY_ENCRYPTED,
          code: "ALREADY_ENCRYPTED",
        };
      }
    }
    messageToEncrypt = plainBody;
    if (!String(messageToEncrypt || "").trim() && !fileToEncrypt) {
      return {
        ok: false,
        error: ENCRYPT_ONLY_MESSAGES.NOTHING_TO_ENCRYPT,
      };
    }
  } else {
    var split = splitComposeNewAndQuoted_(payload.message || "");
    var newMessage = String(split.newText || "").trim();
    var quotedBlock = String(split.quotedBlock || "").trim();
    var sessionEmail =
      (gate.email && String(gate.email)) ||
      (getWorkspaceSession_() && getWorkspaceSession_().email) ||
      "";
    var isForwardSubject = /^(fw|fwd)\s*:/i.test(String(subject).trim());
    var quotedClear = "";

    // Body is only ciphertext (common on Forward with no markers).
    if (!quotedBlock && /sds\./i.test(newMessage)) {
      quotedBlock = newMessage;
      newMessage = "";
    }

    if (quotedBlock) {
      var quoteDec = decryptQuotedParentSds_(
        quotedBlock,
        gate.token,
        sessionEmail
      );
      if (!quoteDec.ok) {
        return {
          ok: false,
          error:
            quoteDec.error ||
            "Could not decrypt the quoted parent message. Open the original mail, decrypt once, then try again.",
        };
      }
      quotedClear = stripSecureDocMetadataBlock_(
        String(quoteDec.text || "").trim()
      );
    }

    if (newMessage && /sds\./i.test(newMessage)) {
      var newDec = decryptQuotedParentSds_(
        newMessage,
        gate.token,
        sessionEmail
      );
      if (!newDec.ok) {
        return {
          ok: false,
          error:
            newDec.error ||
            "Could not decrypt the message body before encrypting for the new recipient.",
        };
      }
      newMessage = stripSecureDocMetadataBlock_(
        String(newDec.text || "").trim()
      );
    }

    messageToEncrypt = newMessage;
    if (!messageToEncrypt) {
      // Pure forward / empty reply: re-encrypt parent plain for the NEW recipient.
      messageToEncrypt = extractForwardPlainMessage_(quotedClear);
      quotedAppendix = "";
    } else if (quotedClear) {
      // Reply with new text: keep parent readable, without old metadata.
      quotedAppendix = isForwardSubject
        ? ""
        : extractForwardPlainMessage_(quotedClear);
      if (isForwardSubject) {
        // Forward + typed note: encrypt note + parent plain together for new To.
        var parentPlain = extractForwardPlainMessage_(quotedClear);
        messageToEncrypt = parentPlain
          ? messageToEncrypt + "\n\n" + parentPlain
          : messageToEncrypt;
        quotedAppendix = "";
      }
    }

    if (!String(messageToEncrypt || "").trim() && !fileToEncrypt) {
      return {
        ok: false,
        error:
          "Nothing to encrypt. Add a message or file, or forward an encrypted mail you can decrypt.",
      };
    }
  }

  var fileOpts = null;
  if (fileToEncrypt && fileToEncrypt.content) {
    fileOpts = {
      fileBase64: fileToEncrypt.content,
      fileName: fileToEncrypt.name || "document.bin",
      mimeType:
        fileToEncrypt.mimeType ||
        (typeof guessMimeTypeFromName_ === "function"
          ? guessMimeTypeFromName_(fileToEncrypt.name)
          : "application/octet-stream"),
    };
  }

  // Valid file first (if any), then message — same order as Outlook.
  var enc =
    typeof apiEncryptFileThenMessage_ === "function"
      ? apiEncryptFileThenMessage_(
          payload.firstTo,
          subject,
          messageToEncrypt || "",
          gate.token,
          fileOpts
        )
      : apiEncrypt_(
          payload.firstTo,
          subject,
          messageToEncrypt || "",
          gate.token,
          fileOpts
        );
  if (!enc.ok) {
    if (enc.code === "FILE_EXTENSION_BLOCKED") {
      var failExt =
        enc.extension ||
        (fileOpts && fileOpts.fileName
          ? extensionFromFileName_(fileOpts.fileName)
          : "file");
      return {
        ok: false,
        code: "FILE_EXTENSION_BLOCKED",
        error:
          enc.error ||
          "." +
            failExt +
            " [blocked extension] is blocked. Nothing was encrypted. Remove the file, then try again.",
      };
    }
    return { ok: false, error: enc.error || "Encrypt failed." };
  }

  var cipher = enc.messageCipherText || "";
  var meta = enc.mailMetadata || null;
  var bodyHtml = buildSecureComposeBodyHtml_(cipher, meta, quotedAppendix);
  var bodyText = buildSecureComposeBodyText_(cipher, meta, quotedAppendix);
  var toHeader = payload.toJoined || payload.firstTo;
  var oldDraftId =
    payload.matched && payload.matched.ok ? payload.matched.draftId || "" : "";

  var encAtt = enc.attachment || null;
  var encAttB64 =
    (encAtt && (encAtt.attachmentBase64 || encAtt.base64)) ||
    enc.fileCipherText ||
    null;
  var encAttName =
    (encAtt && encAtt.fileName) ||
    (fileToEncrypt && fileToEncrypt.name
      ? String(fileToEncrypt.name).replace(/\.[^.]+$/, "") + ".securefile"
      : "encrypted.securefile");

  if (fileToEncrypt && !encAttB64) {
    return {
      ok: false,
      error:
        "File was encrypted on the server but no secure attachment was returned. Try a smaller PDF, then send again.",
    };
  }

  if (!cipher && !encAttB64) {
    return {
      ok: false,
      error: "Encrypt returned no message and no file. Nothing was saved.",
    };
  }

  var mimeOpts = {
    from: tokenRes.from || "",
    to: toHeader,
    cc:
      payload.matched && payload.matched.ok
        ? payload.matched.ccHeader || ""
        : "",
    bcc:
      payload.matched && payload.matched.ok
        ? payload.matched.bccHeader || ""
        : "",
    subject: subject,
    html: bodyHtml,
    text: bodyText,
    attachmentName: encAttB64 ? encAttName : "",
    attachmentBase64: encAttB64 || "",
  };

  // Encrypt data only: update open draft (no send).
  if (encryptOnly) {
    if (!oldDraftId) {
      return {
        ok: false,
        error:
          "No open draft found. Keep compose open, wait for autosave, then try again.",
        code: "NO_DRAFT_MATCH",
      };
    }
    var draftMeta = {
      messageId:
        payload.matched && payload.matched.ok
          ? payload.matched.messageId || ""
          : "",
      threadId:
        payload.matched && payload.matched.ok
          ? payload.matched.threadId || ""
          : "",
    };
    var replaced = gmailReplaceDraftWithEncrypted_(
      oldDraftId,
      mimeOpts,
      accessToken,
      draftMeta
    );
    if (!replaced.ok) {
      return {
        ok: false,
        error: replaced.error || "Could not update draft with encrypted body.",
      };
    }
    return {
      ok: true,
      sent: false,
      encryptedOnly: true,
      draftUpdated: Boolean(replaced.updated),
      draftCreated: Boolean(replaced.created),
      oldDraftDeleted: Boolean(replaced.oldDeleted),
      warning: replaced.error || "",
      firstTo: payload.firstTo,
      subject: subject,
      bodyHtml: bodyHtml,
      bodyText: bodyText,
      cipher: cipher,
      draftId: replaced.draftId || oldDraftId,
    };
  }

  // 1) Create encrypted draft → 2) send → 3) delete plaintext draft
  var flow = gmailCreateEncryptedDraftSendAndCleanup_(
    oldDraftId,
    mimeOpts,
    accessToken
  );

  if (flow.ok && flow.sent) {
    var okResult = {
      ok: true,
      sent: true,
      sendError: "",
      oldDraftDeleted: Boolean(flow.oldDeleted),
      warning: flow.error || "",
      firstTo: payload.firstTo,
      subject: subject,
      bodyHtml: bodyHtml,
    };
    rememberComposeSendSuccess_(okResult);
    return okResult;
  }

  // Fallback: messages.send, then delete old plaintext draft
  var sendRes = gmailMessagesSendWithToken_(accessToken, mimeOpts);
  if (!sendRes.ok) {
    return {
      ok: false,
      error:
        flow.sendError ||
        flow.error ||
        sendRes.error ||
        "Send failed. Re-authorize the SecureDocShare add-on and try again.",
    };
  }

  var oldDeleted = false;
  var warning = "";
  if (oldDraftId) {
    var del = gmailDraftDelete_(oldDraftId, accessToken);
    if (del.ok) {
      oldDeleted = true;
    } else {
      warning =
        "Encrypted mail sent, but the old plaintext draft could not be deleted. Close the open compose window.";
    }
  } else {
    oldDeleted = true;
  }

  if (flow.newDraftId) {
    gmailDraftDelete_(flow.newDraftId, accessToken);
  }

  var fallbackOk = {
    ok: true,
    sent: true,
    sendError: "",
    oldDraftDeleted: oldDeleted,
    warning: warning,
    firstTo: payload.firstTo,
    subject: subject,
    bodyHtml: bodyHtml,
  };
  rememberComposeSendSuccess_(fallbackOk);
  return fallbackOk;
}

/** @deprecated — Gmail connect runs via openMarketplaceGmailConnect_ (sidebar). */
function buildComposeGmailConnectCard_(e, message) {
  return buildMainCard_(e);
}

var COMPOSE_SIDEBAR_STATUS_KEY = "SDS_COMPOSE_SIDEBAR_STATUS";

function saveComposeSidebarStatus_(kind, message) {
  try {
    PropertiesService.getUserProperties().setProperty(
      COMPOSE_SIDEBAR_STATUS_KEY,
      JSON.stringify({
        kind: String(kind || "info"),
        message: String(message || ""),
        at: Date.now(),
      })
    );
  } catch (e) {}
}

function peekComposeSidebarStatus_() {
  try {
    var raw = PropertiesService.getUserProperties().getProperty(
      COMPOSE_SIDEBAR_STATUS_KEY
    );
    if (!raw) return null;
    var data = JSON.parse(raw);
    if (!data) return null;
    if (Date.now() - Number(data.at || 0) > 10 * 60 * 1000) {
      clearComposeSidebarStatus_();
      return null;
    }
    return data;
  } catch (e) {
    return null;
  }
}

function clearComposeSidebarStatus_() {
  try {
    PropertiesService.getUserProperties().deleteProperty(
      COMPOSE_SIDEBAR_STATUS_KEY
    );
  } catch (e) {}
}

/**
 * Persist status, then refresh the existing right-hand sidebar card only.
 * Never uses browser DOM (document) — Apps Script has no DOM.
 */
function finishComposeInSidebar_(e, kind, message) {
  saveComposeSidebarStatus_(kind, message);
  var toast = String(message || "").replace(/\n/g, " ").slice(0, 220);
  if (kind === "success" || kind === "encrypted") toast = "✔ " + toast;
  else if (kind === "error") toast = "✖ " + toast;
  else if (kind === "need_gmail") toast = "Connect Gmail to continue.";

  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(toast))
    .setNavigation(
      CardService.newNavigation().updateCard(buildMainCard_(e))
    )
    .build();
}

/**
 * After Encrypt & send (Workspace-only): update sidebar and open Gmail Inbox.
 * CardService cannot click Discard in the compose DOM; navigating to Inbox
 * dismisses the open compose window without using the Chrome extension.
 */
function finishComposeSendAndCloseCompose_(e, message) {
  saveComposeSidebarStatus_("success", message);
  var toast = ("✔ " + String(message || "Encrypted mail sent."))
    .replace(/\n/g, " ")
    .slice(0, 220);

  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(toast))
    .setNavigation(
      CardService.newNavigation().updateCard(buildMainCard_(e))
    )
    .setOpenLink(
      CardService.newOpenLink()
        .setUrl("https://mail.google.com/mail/u/0/#inbox")
        .setOpenAs(CardService.OpenAs.FULL_SIZE)
        .setOnClose(CardService.OnClose.RELOAD)
    )
    .build();
}

/**
 * Sidebar button only: encrypt & send latest draft.
 * All progress / success / error stay in this sidebar (updateCard).
 */
function onSidebarEncryptAndSend_(e) {
  var valid = getValidWorkspaceAuth_();
  if (!valid) {
    return finishComposeInSidebar_(
      e,
      "error",
      "Sign in to SecureDocShare first."
    );
  }

  saveComposeSidebarStatus_(
    "working",
    "Encrypting and sending your draft…"
  );

  // Match the best autosaved draft via Gmail API (no compose METADATA).
  var fakeE = { gmail: {}, draftMetadata: {} };

  var result;
  try {
    result = runComposeEncryptAndSendCore_(fakeE);
  } catch (err) {
    return finishComposeInSidebar_(
      e,
      "error",
      "Encrypt/send error: " +
        String(err && err.message ? err.message : err)
    );
  }

  if (result.needLogin) {
    return finishComposeInSidebar_(
      e,
      "error",
      result.error || "Login / subscription required."
    );
  }

  if (
    result.needGmailConnect ||
    result.code === "GMAIL_NOT_CONNECTED" ||
    /Connect Gmail|Gmail not connected|GMAIL_NOT_CONNECTED/i.test(
      String(result.error || "")
    )
  ) {
    return finishComposeInSidebar_(
      e,
      "need_gmail",
      result.error ||
        "Connect Gmail once, then tap Encrypt & send draft again."
    );
  }

  if (!result.ok) {
    return finishComposeInSidebar_(e, "error", result.error || "Failed.");
  }

  if (!result.sent) {
    return finishComposeInSidebar_(
      e,
      "error",
      result.sendError || "Encrypted but send failed."
    );
  }

  var okMsg = "Encrypted mail sent successfully.";
  if (result.firstTo) okMsg += "\nTo: " + String(result.firstTo);
  if (result.fromCache) okMsg += "\nAlready sent a moment ago.";
  if (result.warning) okMsg += "\n" + String(result.warning);
  else if (result.oldDraftDeleted) {
    okMsg += "\nPlain text draft removed.";
  }

  return finishComposeSendAndCloseCompose_(e, okMsg);
}

/**
 * Build Encrypt data only status: { kind, message }.
 * @param {Object} event — compose event (draft METADATA) or empty for sidebar.
 */
function getEncryptOnlyStatus_(event) {
  const auth = getValidWorkspaceAuth_();
  if (!auth) {
    return {
      kind: "error",
      message: ENCRYPT_ONLY_MESSAGES.SIGN_IN,
    };
  }

  let encryptResult;
  try {
    encryptResult = runComposeEncryptOnlyCore_(event || {});
  } catch (err) {
    return {
      kind: "error",
      message:
        ENCRYPT_ONLY_MESSAGES.UNEXPECTED +
        " " +
        String(err && err.message ? err.message : err),
    };
  }

  if (encryptResult.needLogin) {
    return {
      kind: "error",
      message: encryptResult.error || ENCRYPT_ONLY_MESSAGES.LOGIN_REQUIRED,
    };
  }

  if (
    encryptResult.needGmailConnect ||
    encryptResult.code === "GMAIL_NOT_CONNECTED" ||
    /Connect Gmail|Gmail not connected|GMAIL_NOT_CONNECTED/i.test(
      String(encryptResult.error || "")
    )
  ) {
    return {
      kind: "need_gmail",
      message: encryptResult.error || ENCRYPT_ONLY_MESSAGES.GMAIL_CONNECT,
    };
  }

  if (!encryptResult.ok || !encryptResult.encryptedOnly) {
    let errorMessage = String(
      encryptResult.error || ENCRYPT_ONLY_MESSAGES.FAILED
    );
    if (/DECRYPT|decrypt|recipient UUID/i.test(errorMessage)) {
      errorMessage = ENCRYPT_ONLY_MESSAGES.ALREADY_ENCRYPTED;
    }
    return {
      kind: "error",
      message: errorMessage,
    };
  }

  let successMessage = ENCRYPT_ONLY_MESSAGES.SUCCESS;
  if (encryptResult.warning) {
    successMessage += "\n" + String(encryptResult.warning);
  }
  return { kind: "encrypted", message: successMessage };
}

/** @deprecated Use getEncryptOnlyStatus_ */
function runEncryptOnlyOutcome_(e) {
  return getEncryptOnlyStatus_(e);
}

function formatEncryptOnlyToast_(kind, message) {
  const toastText = String(message || "")
    .replace(/\n/g, " ")
    .slice(0, 220);
  if (kind === "encrypted" || kind === "success") {
    return "✔ " + toastText;
  }
  if (kind === "error") {
    return "✖ " + toastText;
  }
  if (kind === "need_gmail") {
    return ENCRYPT_ONLY_MESSAGES.GMAIL_CONNECT;
  }
  return toastText;
}

/**
 * Sidebar: Encrypt data only — encrypt open/last draft via drafts.update (no send).
 * Shows success or error message only.
 */
function onSidebarEncryptOnly_(e) {
  const status = getEncryptOnlyStatus_({ gmail: {}, draftMetadata: {} });
  try {
    saveComposeSidebarStatus_(status.kind, status.message);
  } catch (_saveErr) {}

  return CardService.newActionResponseBuilder()
    .setNotification(
      CardService.newNotification().setText(
        formatEncryptOnlyToast_(status.kind, status.message)
      )
    )
    .setNavigation(
      CardService.newNavigation().updateCard(
        buildEncryptOnlyStatusCard_(status.kind, status.message)
      )
    )
    .build();
}

/** Persist status then refresh sidebar — never return a standalone compose Card. */
function buildComposeAppResultCard_(e, statusTitle, statusText) {
  var kind = /^error$/i.test(String(statusTitle || ""))
    ? "error"
    : /^sent$/i.test(String(statusTitle || ""))
      ? "success"
      : "info";
  saveComposeSidebarStatus_(kind, statusText);
  return buildMainCard_(e);
}

/** @deprecated — compose toolbar uses onGmailCompose (encrypt only). */
function handleComposeToolbarClick_(e) {
  return onGmailCompose(e);
}

/** @deprecated */
function buildComposeDirectCard_(e) {
  return onGmailCompose(e);
}

/** @deprecated — success/error now live on the sidebar via finishComposeInSidebar_. */
function buildComposeSentCard_(result) {
  result = result || {};
  var okMsg = "Encrypted mail sent successfully.";
  if (result.firstTo) okMsg += "\nTo: " + String(result.firstTo);
  if (result.oldDraftDeleted) {
    okMsg += "\nPlain text draft removed.";
  } else if (result.warning) {
    okMsg += "\n" + String(result.warning);
  }
  saveComposeSidebarStatus_("success", okMsg);
  return buildMainCard_({});
}

function onComposeSentDone_(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation().updateCard(buildMainCard_(e))
    )
    .build();
}

/**
 * Explicit Connect Gmail button only (not called from Encrypt & send).
 * Opens Google OAuth in a browser tab — user must click Connect themselves.
 */
function openMarketplaceGmailConnect_(e, message) {
  var session = getWorkspaceSession_() || {};
  if (!session.token) {
    return finishComposeInSidebar_(
      e,
      "error",
      "Sign in to SecureDocShare first."
    );
  }
  var connect = apiGmailConnectUrl_(session.token);
  if (!connect.ok || !connect.url) {
    return finishComposeInSidebar_(
      e,
      "error",
      connect.error ||
        "Could not start Gmail connect. Try again later."
    );
  }
  // Prefer in-sidebar Connect button; only open when this function is invoked
  // from an explicit Connect action.
  return finishComposeInSidebar_(
    e,
    "need_gmail",
    message ||
      "Connect Gmail once, then tap Encrypt & send draft again."
  );
}

function onComposeEncryptAndSend_(e) {
  return onSidebarEncryptAndSend_(e);
}

function buildSecureComposeBodyHtml_(cipher, meta, quotedClear) {
  var parts = [];
  parts.push(
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.4;color:#202124">'
  );
  parts.push(
    '<div style="font-family:Consolas,\'Courier New\',monospace;font-size:11px;line-height:1.35;word-break:break-all;color:#0F766E">' +
      escapeHtml_(String(cipher || "").replace(/\s+/g, "")) +
      "</div>"
  );

  if (meta && (meta.token || meta.emailEnc || meta.uuidEnc)) {
    parts.push(
      '<div style="margin-top:10px;padding-top:8px;border-top:1px solid #0F766E;font-family:Consolas,\'Courier New\',monospace;font-size:10px;line-height:1.35;word-break:break-all;color:#334155">'
    );
    if (meta.token) {
      parts.push(
        "<div>" + escapeHtml_(String(meta.token).replace(/\s+/g, "")) + "</div>"
      );
    }
    if (meta.emailEnc) {
      parts.push("<div>email: " + escapeHtml_(meta.emailEnc) + "</div>");
    }
    if (meta.uuidEnc) {
      parts.push("<div>uuid: " + escapeHtml_(meta.uuidEnc) + "</div>");
    }
    parts.push("</div>");
  }

  var siteUrl = String(ADMIN_URL || "https://admin-panel-amber-nine.vercel.app").replace(
    /\/$/,
    ""
  );
  parts.push(
    '<div style="margin-top:14px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;color:#475569">' +
      "To know more, visit our website: " +
      '<a href="' +
      escapeHtml_(siteUrl) +
      '" style="color:#0F766E;font-weight:600;text-decoration:underline" target="_blank" rel="noopener noreferrer">' +
      escapeHtml_(siteUrl) +
      "</a></div>"
  );

  var quote = String(quotedClear || "").trim();
  if (quote) {
    parts.push(
      '<div style="margin-top:16px;padding-top:12px;border-top:1px solid #dadce0;color:#5f6368;font-size:12px;line-height:1.45;white-space:pre-wrap">' +
        escapeHtml_(quote).replace(/\n/g, "<br>") +
        "</div>"
    );
  }

  parts.push("</div>");
  return parts.join("");
}

/**
 * Split reply/forward draft into new text vs quoted parent thread.
 */
function splitComposeNewAndQuoted_(body) {
  var text = String(body || "").replace(/\r\n/g, "\n");
  if (!String(text).trim()) {
    return { newText: "", quotedBlock: "" };
  }

  var patterns = [
    /\nOn .{8,240}?wrote:\s*\n/i,
    /\n-+\s*Original Message\s*-+\s*\n/i,
    /\n-+\s*Forwarded message\s*-+\s*\n/i,
    /\nBegin forwarded message:\s*\n/i,
  ];

  var bestStart = -1;
  for (var p = 0; p < patterns.length; p++) {
    var m = patterns[p].exec(text);
    if (!m) continue;
    var start = m.index;
    if (text.charAt(start) === "\n") start += 1;
    if (bestStart < 0 || start < bestStart) bestStart = start;
  }

  // Fallback: quoted ciphertext after blank line(s) when reply markers missing.
  if (bestStart < 0) {
    var sdsAt = text.search(/(?:^|\n)sds\./i);
    if (sdsAt > 0) {
      bestStart = text.charAt(sdsAt) === "\n" ? sdsAt + 1 : sdsAt;
      // Prefer split at blank line before sds if present.
      var before = text.slice(0, bestStart);
      var blank = before.lastIndexOf("\n\n");
      if (blank >= 0 && blank + 2 < bestStart) {
        bestStart = blank + 2;
      }
    }
  }

  if (bestStart < 0) {
    return { newText: text.trim(), quotedBlock: "" };
  }

  return {
    newText: text.slice(0, bestStart).trim(),
    quotedBlock: text.slice(bestStart).trim(),
  };
}

/**
 * Decrypt sds. tokens in text → clear message.
 * Ensures a blank line before any leftover metadata so we never get "testsdmeta…".
 * Uses the signed-in user's email (keys for the mail they received).
 */
function decryptQuotedParentSds_(quotedBlock, authToken, recipientEmail) {
  var out = String(quotedBlock || "");
  if (!out || !/sds\./i.test(out)) {
    return { ok: true, text: out, decrypted: false };
  }

  var email = String(recipientEmail || "").trim();
  if (!email || email.indexOf("@") < 0) {
    var session = getWorkspaceSession_() || {};
    email = String(session.email || "").trim();
  }
  if (!email || email.indexOf("@") < 0) {
    return {
      ok: false,
      error:
        "Signed-in email missing. Sign out and sign in again, then retry Encrypt & send.",
      text: out,
    };
  }

  var replaced = 0;
  var guard = 0;
  while (guard++ < 12) {
    var span = extractSdsCipherSpan_(out);
    if (!span) break;
    var dec = apiDecrypt_({
      email: email,
      messageCipherText: span.cipher,
      token: authToken,
    });
    if (!dec.ok) {
      return {
        ok: false,
        error:
          formatDecryptError_(dec, "Could not decrypt quoted parent message.") ||
          "Could not decrypt quoted parent message.",
        text: out,
      };
    }
    var plain = String(dec.message || "").trim();
    if (!plain) plain = "[Decrypted message was empty]";
    var after = out.slice(span.end);
    // Prevent "test" + "sdmeta…" → "testsdmeta…"
    if (after && !/^\s/.test(after)) {
      plain = plain + "\n\n";
    } else if (after && /^\s*sdmeta\./i.test(after.replace(/^\s+/, ""))) {
      plain = plain + "\n\n";
    } else if (!/\n$/.test(plain) && /^\s*\n?\s*sdmeta\./i.test(after)) {
      plain = plain + "\n\n";
    }
    out = out.slice(0, span.start) + plain + out.slice(span.end);
    replaced += 1;
  }

  return { ok: true, text: out, decrypted: replaced > 0 };
}

/** Remove SecureDoc metadata blocks from plaintext (old recipient meta must not be forwarded). */
function stripSecureDocMetadataBlock_(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/sdmeta\.v1\.[A-Za-z0-9_-]+/gi, "")
    .replace(/^\s*email:\s*enc:v1:\S+\s*$/gim, "")
    .replace(/^\s*uuid:\s*uid:v1:\S+\s*$/gim, "")
    .replace(/^\s*email:\s*$/gim, "")
    .replace(/^\s*uuid:\s*$/gim, "")
    .replace(/^\s*Metadata\s*$/gim, "")
    .replace(/^\s*error:\s*.+$/gim, "")
    .replace(/To know more, visit our website:\s*https?:\/\/\S+/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * From a decrypted forward/reply quote, keep the human message only
 * (drop Gmail "On … wrote:" / forwarded headers when possible).
 */
function extractForwardPlainMessage_(text) {
  var t = stripSecureDocMetadataBlock_(text);
  if (!t) return "";

  // Drop leading Gmail quote attribution line, keep body after it.
  var onWrote = /^(On .+wrote:\s*)/i.exec(t);
  if (onWrote) {
    t = t.slice(onWrote[0].length).trim();
  }
  t = t
    .replace(/^[-_]{5,}\s*Forwarded message\s*[-_]{5,}\s*/i, "")
    .replace(/^Begin forwarded message:\s*/i, "")
    .replace(/^[-_]{5,}\s*Original Message\s*[-_]{5,}\s*/i, "")
    .replace(/^From:\s.+\nDate:\s.+\nSubject:\s.+\nTo:\s.+\n+/i, "")
    .trim();

  // Quoted lines starting with ">"
  if (/^>/m.test(t) && t.split("\n").every(function (line) {
    return !String(line).trim() || /^\s*>/.test(line);
  })) {
    t = t
      .split("\n")
      .map(function (line) {
        return String(line).replace(/^\s*>\s?/, "");
      })
      .join("\n")
      .trim();
  }

  return stripSecureDocMetadataBlock_(t);
}

function saveWorkspaceSession(session) {
  if (!session || !session.token) {
    clearWorkspaceSession();
    return { ok: true };
  }
  PropertiesService.getUserProperties().setProperty(
    SESSION_KEY,
    JSON.stringify({
      token: String(session.token),
      email: String(session.email || ""),
      expiresAt: session.expiresAt || null,
    })
  );
  return { ok: true };
}

function clearWorkspaceSession() {
  PropertiesService.getUserProperties().deleteProperty(SESSION_KEY);
  return { ok: true };
}

function getWorkspaceSession_() {
  try {
    const raw = PropertiesService.getUserProperties().getProperty(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function getWorkspaceSession() {
  return getWorkspaceSession_();
}

function verifyLoginAndSubscription_() {
  const session = getWorkspaceSession_();
  if (!session || !session.token) {
    return { ok: false, error: "Sign in first (login required)." };
  }
  const sub = apiGetSubscription_(session.token);
  if (!sub.ok) {
    return { ok: false, error: sub.error || "Login token invalid." };
  }
  if (sub.subscriptionActive !== true) {
    return { ok: false, error: "Subscription inactive. Renew to encrypt." };
  }
  return {
    ok: true,
    token: session.token,
    email: String(sub.email || session.email || "").trim(),
    subscriptionActive: true,
  };
}

function apiLogin_(email, password) {
  try {
    var res = UrlFetchApp.fetch(API_BASE + "/auth/login", {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ email: email, password: password }),
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    var data = {};
    try {
      data = JSON.parse(res.getContentText() || "{}");
    } catch (err) {}
    if (code < 200 || code >= 300) {
      return { ok: false, error: data.error || "Login failed (" + code + ")" };
    }
    var token = data.token || data.accessToken;
    if (!token) {
      return { ok: false, error: "No token returned from login." };
    }
    return {
      ok: true,
      token: token,
      email: data.email || email,
      expiresAt: data.expiresAt || null,
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function apiSignupSendOtp_(email, acceptTerms) {
  try {
    var res = UrlFetchApp.fetch(API_BASE + "/auth/signup/send-otp", {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        email: email,
        acceptTerms: acceptTerms === true,
      }),
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    var data = {};
    try {
      data = JSON.parse(res.getContentText() || "{}");
    } catch (err) {}
    if (code < 200 || code >= 300) {
      return {
        ok: false,
        error: data.error || "Could not send code (" + code + ")",
      };
    }
    return {
      ok: true,
      devOtp: data.devOtp || null,
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function apiSignup_(email, password, otp, acceptTerms) {
  try {
    var res = UrlFetchApp.fetch(API_BASE + "/auth/signup", {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        email: email,
        password: password,
        otp: otp,
        acceptTerms: acceptTerms === true,
      }),
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    var data = {};
    try {
      data = JSON.parse(res.getContentText() || "{}");
    } catch (err) {}
    if (code < 200 || code >= 300) {
      return { ok: false, error: data.error || "Signup failed (" + code + ")" };
    }
    var token = data.token || data.accessToken;
    if (!token) {
      return { ok: false, error: "No token returned from signup." };
    }
    return {
      ok: true,
      token: token,
      email: data.email || email,
      expiresAt: data.expiresAt || null,
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function apiOAuthComplete_(ticket) {
  try {
    var res = UrlFetchApp.fetch(API_BASE + "/auth/oauth/complete", {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ ticket: ticket }),
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    var data = {};
    try {
      data = JSON.parse(res.getContentText() || "{}");
    } catch (err) {}
    if (code < 200 || code >= 300) {
      return {
        ok: false,
        error: data.error || "OAuth complete failed (" + code + ")",
      };
    }
    var token = data.token || data.accessToken;
    if (!token) {
      return { ok: false, error: "No token from Google sign-in." };
    }
    return {
      ok: true,
      token: token,
      email: data.email || "",
      expiresAt: data.expiresAt || null,
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Apps Script Google OAuth → SecureDocShare session (id_token verified on server).
 * Stores gmailRefreshToken in DB when Google returns offline access.
 */
function apiLoginGoogle_(opts) {
  opts = opts || {};
  try {
    var body = {
      idToken: String(opts.idToken || ""),
      intent: opts.intent === "signup" ? "signup" : "login",
      acceptTerms: Boolean(opts.acceptTerms),
    };
    if (opts.gmailRefreshToken) {
      body.gmailRefreshToken = String(opts.gmailRefreshToken);
    }
    if (opts.gmailScopes) {
      body.gmailScopes = String(opts.gmailScopes);
    }
    var res = UrlFetchApp.fetch(API_BASE + "/auth/login/google", {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    var data = {};
    try {
      data = JSON.parse(res.getContentText() || "{}");
    } catch (err) {}
    if (code < 200 || code >= 300) {
      return {
        ok: false,
        error: data.error || "Google login failed (" + code + ")",
        code: data.code || "",
      };
    }
    var token = data.token || data.accessToken;
    if (!token) {
      return { ok: false, error: "No session token from server." };
    }
    return {
      ok: true,
      token: token,
      email: data.email || "",
      expiresAt: data.expiresAt || null,
      refreshToken: data.refreshToken || null,
      gmailConnected: data.gmailConnected === true,
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function apiGetSubscription_(token) {
  try {
    var res = UrlFetchApp.fetch(API_BASE + "/auth/subscription", {
      method: "get",
      headers: { Authorization: "Bearer " + token },
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    var data = {};
    try {
      data = JSON.parse(res.getContentText() || "{}");
    } catch (e) {}
    if (code < 200 || code >= 300) {
      return { ok: false, error: data.error || "Auth failed (" + code + ")" };
    }
    return {
      ok: true,
      email: data.email || "",
      subscriptionActive: data.subscriptionActive !== false,
      subscriptionExpiresAt: data.subscriptionExpiresAt || null,
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function apiEncrypt_(to, subject, message, token, fileOpts) {
  fileOpts = fileOpts || {};
  try {
    var body = {
      recipientEmail: to,
      subject: subject || "",
      message: message || "",
    };
    if (fileOpts.fileBase64) {
      body.fileBase64 = fileOpts.fileBase64;
      body.fileName = fileOpts.fileName || "document.bin";
      body.mimeType = fileOpts.mimeType || "application/octet-stream";
    }
    var res = UrlFetchApp.fetch(API_BASE + "/files/encrypt", {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + token },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    var data = {};
    try {
      data = JSON.parse(res.getContentText() || "{}");
    } catch (e) {}
    if (code < 200 || code >= 300) {
      return {
        ok: false,
        error: data.error || "Encrypt failed (" + code + ")",
        code: data.code || "",
        extension: data.extension || null,
      };
    }
    return {
      ok: true,
      messageCipherText: data.messageCipherText || "",
      fileCipherText: data.fileCipherText || null,
      attachment: data.attachment || null,
      mailMetadata: data.mailMetadata || null,
    };
  } catch (err) {
    return { ok: false, error: String(err), code: "" };
  }
}

/**
 * Admin blocked extensions (same /files/file-policy as Outlook).
 */
function apiFetchBlockedFileExtensions_() {
  try {
    var res = UrlFetchApp.fetch(API_BASE + "/files/file-policy", {
      method: "get",
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    var data = {};
    try {
      data = JSON.parse(res.getContentText() || "{}");
    } catch (e) {}
    if (code < 200 || code >= 300) return [];
    return Array.isArray(data.blockedFileExtensions)
      ? data.blockedFileExtensions
      : [];
  } catch (err) {
    return [];
  }
}

/**
 * Like Outlook: one encrypt call with file + message.
 * Server rejects blocked extensions before encrypting anything, and encrypts
 * the file before the message.
 */
function apiEncryptFileThenMessage_(to, subject, message, token, fileOpts) {
  return apiEncrypt_(to, subject, message || "", token, fileOpts || null);
}

/**
 * Gmail access via YOUR OAuth client (GOOGLE_GMAIL_CLIENT_ID on the server).
 * Not Apps Script's default GCP project — avoids "Gmail API disabled on project …".
 */
function getMarketplaceGmailAccess_(secureDocToken) {
  try {
    if (!secureDocToken) {
      return {
        ok: false,
        code: "LOGIN_REQUIRED",
        error: "Sign in to SecureDocShare first.",
      };
    }
    var res = UrlFetchApp.fetch(API_BASE + "/auth/gmail/send-token", {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + secureDocToken },
      payload: "{}",
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    var data = {};
    try {
      data = JSON.parse(res.getContentText() || "{}");
    } catch (e) {}
    if (code < 200 || code >= 300) {
      var err = data.error || "Gmail send-token failed (" + code + ")";
      if (data.code === "GMAIL_NOT_CONNECTED" || code === 403) {
        return {
          ok: false,
          code: "GMAIL_NOT_CONNECTED",
          error:
            "Connect Gmail once with your Google account (SecureDocShare), then try Encrypt & send again.",
        };
      }
      return { ok: false, code: data.code || "", error: err };
    }
    return {
      ok: true,
      accessToken: data.accessToken || "",
      from: data.from || "",
      appUrl: data.appUrl || "",
      scope: data.scope || "",
      hasCompose: data.hasCompose === true,
    };
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
    };
  }
}

/** Start Gmail OAuth with YOUR web client (server /gmail/connect → /gmail/go). */
function apiGmailConnectUrl_(secureDocToken) {
  try {
    var res = UrlFetchApp.fetch(API_BASE + "/auth/gmail/connect", {
      method: "get",
      headers: { Authorization: "Bearer " + secureDocToken },
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    var data = {};
    try {
      data = JSON.parse(res.getContentText() || "{}");
    } catch (e) {}
    if (code < 200 || code >= 300) {
      return {
        ok: false,
        error: data.error || "Could not start Gmail connect (" + code + ")",
      };
    }
    // Prefer same-origin /gmail/go (add-on OpenLink), then Google URL.
    var openUrl = data.goUrl || data.url || "";
    if (!openUrl) {
      return { ok: false, error: "Gmail connect URL missing from server." };
    }
    return { ok: true, url: openUrl, googleUrl: data.url || "" };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** HtmlService: token for Encrypt and send. */
function getMarketplaceGmailSendToken() {
  var session = getWorkspaceSession_() || {};
  return getMarketplaceGmailAccess_(session.token);
}

function apiDecrypt_(options) {
  options = options || {};
  try {
    var payload = {
      email: options.email,
    };
    if (options.messageCipherText) {
      payload.messageCipherText = options.messageCipherText;
    }
    if (options.fileCipherText) {
      payload.fileCipherText = options.fileCipherText;
    }
    var headers = {};
    if (options.token) {
      headers.Authorization = "Bearer " + options.token;
    }
    var res = UrlFetchApp.fetch(API_BASE + "/files/decrypt", {
      method: "post",
      contentType: "application/json",
      headers: headers,
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    var data = {};
    try {
      data = JSON.parse(res.getContentText() || "{}");
    } catch (e) {
      return {
        ok: false,
        code: "BAD_RESPONSE",
        error: "Decrypt failed: invalid server response (" + code + ").",
      };
    }
    if (code < 200 || code >= 300 || data.ok === false) {
      return {
        ok: false,
        code: data.code || "",
        error:
          data.error ||
          data.message ||
          "Decrypt failed (" + code + ").",
      };
    }
    return {
      ok: true,
      message: data.message || null,
      file: data.file || null,
      filename: data.filename || null,
      decrypted: true,
    };
  } catch (err) {
    return {
      ok: false,
      code: "DECRYPT_EXCEPTION",
      error: "Decrypt error: " + String(err && err.message ? err.message : err),
    };
  }
}

function formatDecryptError_(result, fallback) {
  var base = fallback || "Decrypt failed.";
  if (!result) return base;
  var msg = String(result.error || "").trim();
  if (!msg) msg = base;
  if (result.code && String(msg).indexOf(String(result.code)) < 0) {
    msg = msg + " [" + result.code + "]";
  }
  return msg;
}

function buildDecryptErrorCard_(message) {
  return CardService.newCardBuilder()
    .setHeader(cardHeader_("SecureDocShare", "Decrypt failed"))
    .addSection(
      CardService.newCardSection()
        .addWidget(statusRow_(String(message || "Decrypt failed."), false))
        .addWidget(
          CardService.newButtonSet().addButton(
            secondaryBtn_("Back", "onCardBack_")
          )
        )
    )
    .build();
}

/** Exposed to HtmlService: return current user's OAuth token for People API. */
function getWorkspaceOAuthToken() {
  return ScriptApp.getOAuthToken();
}

/**
 * Search Contacts + Other contacts (People API via marketplace OAuth).
 * @param {string} query
 * @returns {{ok:boolean, results:Array<{email:string,name:string}>, error?:string, code?:string}}
 */
function searchWorkspaceContacts(query) {
  try {
    return searchWorkspaceContacts_(String(query || ""));
  } catch (err) {
    return {
      ok: false,
      results: [],
      error: String(err && err.message ? err.message : err),
      code: "CONTACTS_SEARCH_FAILED",
    };
  }
}

function searchWorkspaceContacts_(query) {
  var q = String(query || "").trim();
  if (q.length < 2) {
    return { ok: true, results: [] };
  }

  var token = ScriptApp.getOAuthToken();
  var mask = "names,emailAddresses";
  var encoded = encodeURIComponent(q);
  var maskEnc = encodeURIComponent(mask);

  // Warmup (Google requires empty query once per session for freshness).
  try {
    UrlFetchApp.fetch(
      "https://people.googleapis.com/v1/people:searchContacts?query=&readMask=" +
        maskEnc +
        "&pageSize=1",
      {
        method: "get",
        headers: { Authorization: "Bearer " + token },
        muteHttpExceptions: true,
      }
    );
    UrlFetchApp.fetch(
      "https://people.googleapis.com/v1/otherContacts:search?query=&readMask=" +
        maskEnc +
        "&pageSize=1",
      {
        method: "get",
        headers: { Authorization: "Bearer " + token },
        muteHttpExceptions: true,
      }
    );
  } catch (eWarm) {}

  var urls = [
    "https://people.googleapis.com/v1/people:searchContacts?query=" +
      encoded +
      "&readMask=" +
      maskEnc +
      "&pageSize=30",
    "https://people.googleapis.com/v1/otherContacts:search?query=" +
      encoded +
      "&readMask=" +
      maskEnc +
      "&pageSize=30",
  ];

  var results = [];
  var lastError = null;
  var scopeError = false;
  var disabledError = false;

  for (var i = 0; i < urls.length; i++) {
    var res = UrlFetchApp.fetch(urls[i], {
      method: "get",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json",
      },
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    var text = res.getContentText() || "";
    var data = {};
    try {
      data = JSON.parse(text || "{}");
    } catch (eParse) {}

    if (code < 200 || code >= 300) {
      var msg = String(
        (data.error && data.error.message) || text || "HTTP " + code
      );
      lastError = msg;
      if (
        /has not been used|is disabled|API has not been|SERVICE_DISABLED/i.test(
          msg
        )
      ) {
        disabledError = true;
      }
      if (
        code === 401 ||
        code === 403 ||
        /insufficient|ACCESS_TOKEN_SCOPE|authentication scopes/i.test(msg)
      ) {
        scopeError = true;
      }
      continue;
    }

    var rows = data.results || [];
    for (var r = 0; r < rows.length; r++) {
      var person = rows[r].person || rows[r] || {};
      var name =
        (person.names &&
          person.names[0] &&
          (person.names[0].displayName ||
            person.names[0].unstructuredName)) ||
        "";
      var emails = person.emailAddresses || [];
      for (var e = 0; e < emails.length; e++) {
        var email = String(emails[e].value || "")
          .trim()
          .toLowerCase();
        if (email.indexOf("@") < 0) continue;
        results.push({
          email: email,
          name: name || email.split("@")[0],
        });
      }
    }
  }

  var deduped = [];
  var seen = {};
  for (var d = 0; d < results.length; d++) {
    var key = results[d].email;
    if (seen[key]) continue;
    seen[key] = true;
    deduped.push(results[d]);
  }

  if (!deduped.length && lastError) {
    if (disabledError) {
      return {
        ok: false,
        results: [],
        error:
          "People API is disabled. Enable “People API” in Google Cloud Console, then try again.",
        code: "PEOPLE_API_DISABLED",
      };
    }
    if (scopeError) {
      return {
        ok: false,
        results: [],
        error:
          "Google Contacts permission missing. Re-authorize the Workspace app and allow Contacts access.",
        code: "CONTACTS_SCOPE_REQUIRED",
      };
    }
    return {
      ok: false,
      results: [],
      error: lastError,
      code: "PEOPLE_API_ERROR",
    };
  }

  return { ok: true, results: deduped };
}

function gmailApiRequest_(method, path, body, accessToken) {
  try {
    const token = accessToken || "";
    if (!token) {
      return {
        ok: false,
        code: 401,
        error:
          "Gmail access token missing. Re-authorize the SecureDocShare add-on.",
      };
    }
    const options = {
      method: String(method || "get").toLowerCase(),
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json",
      },
      muteHttpExceptions: true,
    };
    if (body != null) {
      options.contentType = "application/json";
      options.payload = JSON.stringify(body);
    }
    const res = UrlFetchApp.fetch(
      "https://gmail.googleapis.com" + path,
      options
    );
    const code = res.getResponseCode();
    let data = {};
    const text = res.getContentText() || "";
    try {
      data = JSON.parse(text || "{}");
    } catch (err) {
      data = { raw: text };
    }
    if (code < 200 || code >= 300) {
      const errMsg =
        (data && data.error && data.error.message) ||
        data.error ||
        text ||
        "Gmail API error (" + code + ")";
      return { ok: false, code: code, error: String(errMsg), data: data };
    }
    return { ok: true, code: code, data: data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function normalizeEmailAddress_(value) {
  let s = String(value || "").trim().toLowerCase();
  if (!s) return "";
  const m = s.match(/<([^>]+)>/);
  if (m && m[1]) s = String(m[1]).trim().toLowerCase();
  s = s.replace(/^mailto:/i, "").trim();
  if (s.indexOf("@") < 0) return "";
  return s;
}

function extractEmailsFromHeader_(header) {
  const out = [];
  const parts = String(header || "").split(",");
  for (let i = 0; i < parts.length; i++) {
    const e = normalizeEmailAddress_(parts[i]);
    if (e && out.indexOf(e) < 0) out.push(e);
  }
  return out;
}

function emailsOverlap_(a, b) {
  if (!a || !a.length || !b || !b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (b.indexOf(a[i]) >= 0) return true;
  }
  return false;
}

function getMimeHeader_(headers, name) {
  const want = String(name || "").toLowerCase();
  for (let i = 0; i < (headers || []).length; i++) {
    if (String((headers[i] && headers[i].name) || "").toLowerCase() === want) {
      return String(headers[i].value || "");
    }
  }
  return "";
}

function decodeBodyData_(data) {
  if (!data) return "";
  try {
    let padded = String(data).replace(/-/g, "+").replace(/_/g, "/");
    while (padded.length % 4) padded += "=";
    return Utilities.newBlob(Utilities.base64Decode(padded)).getDataAsString(
      "UTF-8"
    );
  } catch (err) {
    try {
      return Utilities.newBlob(
        Utilities.base64DecodeWebSafe(String(data))
      ).getDataAsString("UTF-8");
    } catch (err2) {
      return "";
    }
  }
}

function extractMessagePlainBody_(payload) {
  if (!payload) return "";

  function walk(part) {
    if (!part) return { plain: "", html: "" };
    const mime = String(part.mimeType || "").toLowerCase();
    let plain = "";
    let html = "";
    if (mime === "text/plain" && part.body && part.body.data) {
      plain = decodeBodyData_(part.body.data);
    } else if (mime === "text/html" && part.body && part.body.data) {
      html = decodeBodyData_(part.body.data);
    }
    const parts = part.parts || [];
    for (let i = 0; i < parts.length; i++) {
      const child = walk(parts[i]);
      if (!plain && child.plain) plain = child.plain;
      if (!html && child.html) html = child.html;
    }
    return { plain: plain, html: html };
  }

  const found = walk(payload);
  if (found.plain && String(found.plain).trim()) {
    return String(found.plain).replace(/\r\n/g, "\n").trim();
  }
  if (found.html) {
    return String(found.html)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\r\n/g, "\n")
      .trim();
  }
  if (payload.body && payload.body.data) {
    return decodeBodyData_(payload.body.data).trim();
  }
  return "";
}

function extensionFromFileName_(fileName) {
  const base = String(fileName || "").split(/[\\/]/).pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base
    .slice(dot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isAlreadyEncryptedName_(fileName) {
  return /\.secure[a-z0-9]+$/i.test(String(fileName || ""));
}

function isBlockedFileName_(fileName, blockedList) {
  const ext = extensionFromFileName_(fileName);
  if (!ext || !blockedList || !blockedList.length) return false;
  for (let i = 0; i < blockedList.length; i++) {
    if (String(blockedList[i] || "").toLowerCase() === ext) return true;
  }
  return false;
}

function findBlockedDraftAttachment_(files, blockedList) {
  if (!files || !files.length || !blockedList || !blockedList.length) return null;
  for (let i = 0; i < files.length; i++) {
    if (isAlreadyEncryptedName_(files[i].name)) continue;
    if (isBlockedFileName_(files[i].name, blockedList)) return files[i];
  }
  return null;
}

/** First non-encrypted, non-blocked attachment with content (same as Outlook). */
function pickDraftFileToEncrypt_(files, blockedList) {
  if (!files || !files.length) return null;
  for (let i = 0; i < files.length; i++) {
    if (
      !isAlreadyEncryptedName_(files[i].name) &&
      !isBlockedFileName_(files[i].name, blockedList || []) &&
      files[i].content
    ) {
      return files[i];
    }
  }
  return null;
}

function guessMimeTypeFromName_(fileName) {
  const ext = extensionFromFileName_(fileName);
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "txt") return "text/plain";
  if (ext === "doc") return "application/msword";
  if (ext === "docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return "application/octet-stream";
}

function listMimeAttachmentParts_(payload, out) {
  out = out || [];
  if (!payload) return out;

  const mime = String(payload.mimeType || "").toLowerCase();
  let filename = String(payload.filename || "").trim();
  if (!filename) {
    const cd = getMimeHeader_(payload.headers || [], "Content-Disposition");
    const m = /filename\*?=(?:UTF-8''|"?)([^";]+)"?/i.exec(cd || "");
    if (m && m[1]) {
      try {
        filename = decodeURIComponent(String(m[1]).replace(/"/g, "").trim());
      } catch (e) {
        filename = String(m[1]).replace(/"/g, "").trim();
      }
    }
  }

  if (filename && mime.indexOf("multipart/") !== 0) {
    const disposition = String(
      getMimeHeader_(payload.headers || [], "Content-Disposition") || ""
    );
    const isInlineImage =
      /^inline\b/i.test(disposition) && mime.indexOf("image/") === 0;
    if (!isInlineImage) {
      out.push({
        name: filename,
        mimeType: mime || "application/octet-stream",
        attachmentId: (payload.body && payload.body.attachmentId) || "",
        data: (payload.body && payload.body.data) || "",
      });
    }
  }

  const parts = payload.parts || [];
  for (let i = 0; i < parts.length; i++) {
    listMimeAttachmentParts_(parts[i], out);
  }
  return out;
}

function gmailAttachmentDataToBase64_(data) {
  var s = String(data || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/\s+/g, "");
  var pad = (4 - (s.length % 4)) % 4;
  if (pad) s += "====".slice(0, pad);
  return s;
}

function fetchGmailAttachmentBase64_(messageId, attachmentId, accessToken) {
  if (!messageId || !attachmentId) return "";
  const res = gmailApiRequest_(
    "get",
    "/gmail/v1/users/me/messages/" +
      encodeURIComponent(messageId) +
      "/attachments/" +
      encodeURIComponent(attachmentId),
    null,
    accessToken
  );
  if (!res.ok || !res.data || !res.data.data) return "";
  return gmailAttachmentDataToBase64_(res.data.data);
}

/**
 * List draft attachment metadata (names) for blocked-extension checks.
 * Does not download bytes.
 */
function listDraftAttachmentMetas_(payload) {
  return listMimeAttachmentParts_(payload, []).map(function (p) {
    return {
      name: p.name,
      mimeType: p.mimeType || guessMimeTypeFromName_(p.name),
      attachmentId: p.attachmentId || "",
      data: p.data || "",
      content: null,
    };
  });
}

/** Load clear draft attachments (base64) for encrypt. Fails if a named file cannot be read. */
function loadDraftEncryptFiles_(messageId, payload, accessToken) {
  const parts = listMimeAttachmentParts_(payload, []);
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    let b64 = "";
    if (p.data) {
      b64 = gmailAttachmentDataToBase64_(p.data);
    } else if (p.attachmentId) {
      if (!messageId) {
        throw new Error(
          "Could not read draft attachment \"" +
            p.name +
            "\" (missing message id). Wait for Gmail autosave, then try again."
        );
      }
      b64 = fetchGmailAttachmentBase64_(
        messageId,
        p.attachmentId,
        accessToken
      );
      if (!b64) {
        throw new Error(
          "Could not download draft attachment \"" +
            p.name +
            "\". Wait for Gmail autosave, then try again."
        );
      }
    }
    if (!b64) {
      throw new Error(
        "Draft attachment \"" + p.name + "\" has no content to encrypt."
      );
    }
    files.push({
      name: p.name,
      mimeType: p.mimeType || guessMimeTypeFromName_(p.name),
      content: b64,
    });
  }
  return files;
}

/**
 * Find the open compose draft.
 * @param {string[]} toEmails
 * @param {string} subjectHint
 * @param {string} accessToken
 * @param {{ preferPlainBody?: boolean }} opts
 *   preferPlainBody (Encrypt data only): prefer plaintext drafts so first click
 *   does not match an older already-encrypted draft.
 */
function findMatchingGmailDraft_(toEmails, subjectHint, accessToken, opts) {
  opts = opts || {};
  const preferPlainBody = opts.preferPlainBody === true;
  const targets = [];
  for (let i = 0; i < (toEmails || []).length; i++) {
    const email = normalizeEmailAddress_(toEmails[i]);
    if (email && targets.indexOf(email) < 0) targets.push(email);
  }
  const subjectWant = String(subjectHint || "")
    .trim()
    .toLowerCase();

  let drafts = [];
  let listError = "";
  const listAttempts = 3;
  for (let attempt = 0; attempt < listAttempts; attempt++) {
    if (attempt > 0) {
      Utilities.sleep(1000);
    }
    const list = gmailApiRequest_(
      "get",
      "/gmail/v1/users/me/drafts?maxResults=40",
      null,
      accessToken
    );
    if (!list.ok) {
      const scopeHint = /insufficient|scope/i.test(String(list.error || ""))
        ? " Re-authorize the SecureDocShare add-on (needs Gmail modify access)."
        : "";
      listError = (list.error || "Cannot list drafts.") + scopeHint;
      continue;
    }
    drafts = (list.data && list.data.drafts) || [];
    if (drafts.length) break;
  }

  if (listError && !drafts.length) {
    return { ok: false, error: listError };
  }
  if (!drafts.length) {
    return {
      ok: false,
      error: "No drafts found. Wait for Gmail to autosave, then try again.",
      code: "NO_DRAFTS",
    };
  }

  function scoreDraftCandidate_(draftObj, msg, payload, headers, body) {
    const toHdr = getMimeHeader_(headers, "To");
    const subj = getMimeHeader_(headers, "Subject");
    const draftTos = extractEmailsFromHeader_(toHdr);
    let score = 0;

    if (targets.length) {
      if (!emailsOverlap_(targets, draftTos)) return null;
      score += 10;
    } else if (draftTos.length) {
      score += 8;
    } else {
      score += 1;
    }

    const subjNorm = String(subj || "")
      .trim()
      .toLowerCase();
    if (subjectWant && subjNorm === subjectWant) {
      score += 5;
    } else if (
      subjectWant &&
      (subjNorm.indexOf(subjectWant) >= 0 || subjectWant.indexOf(subjNorm) >= 0)
    ) {
      score += 3;
    } else if (/^(re|fw|fwd)\s*:/i.test(subjNorm)) {
      score += 2;
    }

    if (body && body.length > 0) score += 1;

    const isEncryptedBody = /sds\./i.test(body || "");
    const internalDate = Number(msg.internalDate || 0);

    return {
      ok: true,
      draftId: draftObj.id || "",
      messageId: msg.id || "",
      threadId: msg.threadId || "",
      toHeader: toHdr,
      toEmails: draftTos.length ? draftTos : targets,
      subject: subj || "",
      body: body,
      ccHeader: getMimeHeader_(headers, "Cc"),
      bccHeader: getMimeHeader_(headers, "Bcc"),
      payload: payload,
      score: score,
      internalDate: internalDate,
      isEncryptedBody: isEncryptedBody,
    };
  }

  function compareDraftRank_(a, b) {
    if (a.score !== b.score) return b.score - a.score;
    return b.internalDate - a.internalDate;
  }

  function pickBestFromDraftList_(draftList) {
    const candidates = [];
    for (let i = 0; i < draftList.length; i++) {
      const id = draftList[i] && draftList[i].id;
      if (!id) continue;
      const full = gmailApiRequest_(
        "get",
        "/gmail/v1/users/me/drafts/" + encodeURIComponent(id) + "?format=full",
        null,
        accessToken
      );
      if (!full.ok) continue;
      const draftObj = full.data || {};
      const msg = draftObj.message || {};
      const payload = msg.payload || {};
      const headers = payload.headers || [];
      const body = extractMessagePlainBody_(payload);
      const candidate = scoreDraftCandidate_(
        draftObj,
        msg,
        payload,
        headers,
        body
      );
      if (!candidate) continue;
      candidate.draftId = draftObj.id || id;
      candidates.push(candidate);
    }

    if (!candidates.length) return null;

    // Encrypt data only: if any plaintext draft matches, never pick encrypted.
    if (preferPlainBody) {
      const plainDrafts = candidates.filter(function (c) {
        return !c.isEncryptedBody;
      });
      if (plainDrafts.length) {
        plainDrafts.sort(compareDraftRank_);
        return plainDrafts[0];
      }
    }

    candidates.sort(compareDraftRank_);
    return candidates[0];
  }

  let best = pickBestFromDraftList_(drafts);

  // Prefer plaintext: if To-filter only found encrypted drafts, widen search
  // (same behavior as sidebar Encrypt data only).
  if (preferPlainBody && best && best.isEncryptedBody && targets.length) {
    Utilities.sleep(1500);
    const listAgain = gmailApiRequest_(
      "get",
      "/gmail/v1/users/me/drafts?maxResults=40",
      null,
      accessToken
    );
    const again =
      listAgain.ok && listAgain.data && listAgain.data.drafts
        ? listAgain.data.drafts
        : drafts;

    const savedTargets = targets.slice();
    targets.length = 0;
    const wideBest = pickBestFromDraftList_(again);
    targets.push.apply(targets, savedTargets);

    if (wideBest && !wideBest.isEncryptedBody) {
      best = wideBest;
    } else {
      const retryBest = pickBestFromDraftList_(again);
      if (retryBest && !retryBest.isEncryptedBody) best = retryBest;
      else if (retryBest) best = retryBest;
    }
  } else if (preferPlainBody && best && best.isEncryptedBody) {
    Utilities.sleep(1500);
    const listAgain = gmailApiRequest_(
      "get",
      "/gmail/v1/users/me/drafts?maxResults=40",
      null,
      accessToken
    );
    if (listAgain.ok) {
      const again = (listAgain.data && listAgain.data.drafts) || [];
      const retryBest = pickBestFromDraftList_(again);
      if (retryBest) best = retryBest;
    }
  }

  if (!best) {
    return {
      ok: false,
      error:
        "Could not match an open draft. Add a recipient in To, wait for autosave, then try again.",
      code: "NO_DRAFT_MATCH",
    };
  }

  try {
    best.attachmentMetas = listDraftAttachmentMetas_(best.payload);
    best.files = loadDraftEncryptFiles_(
      best.messageId,
      best.payload,
      accessToken
    );
  } catch (loadErr) {
    return {
      ok: false,
      error:
        (loadErr && loadErr.message) ||
        "Could not read draft attachments. Wait for Gmail autosave, then try again.",
    };
  }
  delete best.payload;
  return best;
}

function sanitizeMimeHeader_(s) {
  return String(s || "")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function buildRfc822EncryptedMime_(options) {
  options = options || {};
  const altBoundary = "SecureDocShareAlt_" + String(Date.now());
  const attachments = [];
  if (options.attachmentBase64) {
    attachments.push({
      fileName: options.attachmentName || "encrypted.securefile",
      base64: options.attachmentBase64,
      mimeType: options.attachmentMimeType || "application/octet-stream",
    });
  }
  const extra = options.attachments || [];
  for (let a = 0; a < extra.length; a++) {
    if (extra[a] && extra[a].base64) attachments.push(extra[a]);
  }

  const headerLines = [
    "To: " + sanitizeMimeHeader_(options.to),
    "Subject: " + sanitizeMimeHeader_(options.subject || "Secure document"),
    "MIME-Version: 1.0",
  ];
  if (options.cc) headerLines.splice(1, 0, "Cc: " + sanitizeMimeHeader_(options.cc));
  if (options.bcc) {
    headerLines.splice(
      options.cc ? 2 : 1,
      0,
      "Bcc: " + sanitizeMimeHeader_(options.bcc)
    );
  }
  if (options.from) {
    headerLines.unshift("From: " + sanitizeMimeHeader_(options.from));
  }

  const altParts = [
    "--" + altBoundary,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    options.text || "",
    "",
    "--" + altBoundary,
    "Content-Type: text/html; charset=UTF-8",
    "",
    options.html || "",
    "",
    "--" + altBoundary + "--",
  ];

  if (!attachments.length) {
    return headerLines
      .concat([
        'Content-Type: multipart/alternative; boundary="' + altBoundary + '"',
        "",
      ])
      .concat(altParts)
      .concat([""])
      .join("\r\n");
  }

  const mixedBoundary = "SecureDocShareMixed_" + String(Date.now());
  const lines = headerLines.concat([
    'Content-Type: multipart/mixed; boundary="' + mixedBoundary + '"',
    "",
    "--" + mixedBoundary,
    'Content-Type: multipart/alternative; boundary="' + altBoundary + '"',
    "",
  ]);
  for (let i = 0; i < altParts.length; i++) lines.push(altParts[i]);

  for (let j = 0; j < attachments.length; j++) {
    const att = attachments[j];
    const safeName = sanitizeMimeHeader_(
      att.fileName || "encrypted.securefile"
    ).replace(/"/g, "");
    const b64 = String(att.base64 || "").replace(/\s+/g, "");
    const chunked = b64.replace(/(.{76})/g, "$1\r\n");
    lines.push("");
    lines.push("--" + mixedBoundary);
    lines.push(
      "Content-Type: " +
        (att.mimeType || "application/octet-stream") +
        '; name="' +
        safeName +
        '"'
    );
    lines.push("Content-Transfer-Encoding: base64");
    lines.push('Content-Disposition: attachment; filename="' + safeName + '"');
    lines.push("");
    lines.push(chunked.replace(/\r\n$/, ""));
  }
  lines.push("");
  lines.push("--" + mixedBoundary + "--");
  lines.push("");
  return lines.join("\r\n");
}

function encodeRawMime_(rfc822) {
  // Encode raw MIME bytes (ASCII). Avoid Charset.UTF_8 path — more reliable for large attachments.
  const bytes = Utilities.newBlob(String(rfc822 || "")).getBytes();
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, "");
}

/** Create a draft with recipient, subject, and encrypted body. */
function gmailDraftCreate_(options, accessToken) {
  const rfc822 = buildRfc822EncryptedMime_(options);
  const raw = encodeRawMime_(rfc822);
  return gmailApiRequest_(
    "post",
    "/gmail/v1/users/me/drafts",
    { message: { raw: raw } },
    accessToken
  );
}

/**
 * Update an existing draft in place (Gmail drafts.update).
 * Same draft id — used by Encrypt data only.
 */
function gmailDraftUpdate_(draftId, options, accessToken, draftMeta) {
  if (!draftId) {
    return { ok: false, error: "Draft id missing." };
  }
  draftMeta = draftMeta || {};
  const rfc822 = buildRfc822EncryptedMime_(options);
  const raw = encodeRawMime_(rfc822);
  const message = { raw: raw };
  if (draftMeta.messageId) message.id = String(draftMeta.messageId);
  if (draftMeta.threadId) message.threadId = String(draftMeta.threadId);
  return gmailApiRequest_(
    "put",
    "/gmail/v1/users/me/drafts/" + encodeURIComponent(draftId),
    {
      id: draftId,
      message: message,
    },
    accessToken
  );
}

/**
 * Encrypt-only: prefer drafts.update on the open draft.
 * Falls back to create + delete old only if update is not possible.
 */
function gmailReplaceDraftWithEncrypted_(oldDraftId, mimeOpts, accessToken, draftMeta) {
  if (oldDraftId) {
    const updated = gmailDraftUpdate_(
      oldDraftId,
      mimeOpts,
      accessToken,
      draftMeta || {}
    );
    if (updated.ok) {
      return {
        ok: true,
        draftId: oldDraftId,
        updated: true,
        created: false,
        oldDeleted: false,
        error: "",
      };
    }
  }

  const created = gmailDraftCreate_(mimeOpts, accessToken);
  if (!created.ok || !created.data) {
    return {
      ok: false,
      draftId: "",
      updated: false,
      created: false,
      oldDeleted: false,
      error:
        (oldDraftId ? "Could not update draft; create also failed. " : "") +
        (created.error || "Could not create encrypted draft."),
    };
  }

  const newDraftId = (created.data && created.data.id) || "";
  let oldDeleted = false;
  let deleteError = "";
  if (oldDraftId && oldDraftId !== newDraftId) {
    const del = gmailDraftDelete_(oldDraftId, accessToken);
    if (del.ok) {
      oldDeleted = true;
    } else {
      deleteError =
        del.error ||
        "Encrypted draft created, but the old plaintext draft could not be deleted.";
    }
  }

  return {
    ok: true,
    draftId: newDraftId,
    updated: false,
    created: true,
    oldDeleted: oldDeleted,
    error: deleteError,
  };
}

/** Send a draft (Gmail removes that draft after send). */
function gmailDraftSend_(draftId, accessToken) {
  if (!draftId) {
    return { ok: false, error: "Draft id missing." };
  }
  return gmailApiRequest_(
    "post",
    "/gmail/v1/users/me/drafts/send",
    { id: draftId },
    accessToken
  );
}

/** Delete a draft (used for the old plaintext compose). */
function gmailDraftDelete_(draftId, accessToken) {
  if (!draftId) {
    return { ok: false, error: "Draft id missing." };
  }
  return gmailApiRequest_(
    "delete",
    "/gmail/v1/users/me/drafts/" + encodeURIComponent(draftId),
    null,
    accessToken
  );
}

/**
 * Create encrypted draft → send it → delete old plaintext draft.
 * Returns { ok, newDraftId, sent, oldDeleted, error, sendError }.
 */
function gmailCreateEncryptedDraftSendAndCleanup_(
  oldDraftId,
  mimeOpts,
  accessToken
) {
  const created = gmailDraftCreate_(mimeOpts, accessToken);
  if (!created.ok || !created.data) {
    return {
      ok: false,
      newDraftId: "",
      sent: false,
      oldDeleted: false,
      error: created.error || "Could not create encrypted draft.",
      sendError: "",
    };
  }

  const newDraftId = (created.data && created.data.id) || "";
  if (!newDraftId) {
    return {
      ok: false,
      newDraftId: "",
      sent: false,
      oldDeleted: false,
      error: "Encrypted draft created but id missing.",
      sendError: "",
    };
  }

  const sentRes = gmailDraftSend_(newDraftId, accessToken);
  if (!sentRes.ok) {
    // Leave the encrypted draft for the user; do not delete plaintext yet.
    return {
      ok: false,
      newDraftId: newDraftId,
      sent: false,
      oldDeleted: false,
      error: "",
      sendError: sentRes.error || "Could not send encrypted draft.",
    };
  }

  let oldDeleted = false;
  let deleteError = "";
  if (oldDraftId && oldDraftId !== newDraftId) {
    const del = gmailDraftDelete_(oldDraftId, accessToken);
    if (del.ok) {
      oldDeleted = true;
    } else {
      deleteError = del.error || "Could not delete the old plaintext draft.";
    }
  } else {
    oldDeleted = true;
  }

  return {
    ok: true,
    newDraftId: newDraftId,
    sent: true,
    oldDeleted: oldDeleted,
    error: deleteError,
    sendError: "",
  };
}

function gmailMessagesSendWithToken_(accessToken, options) {
  try {
    const rfc822 = buildRfc822EncryptedMime_(options);
    const raw = encodeRawMime_(rfc822);
    const res = UrlFetchApp.fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "post",
        contentType: "application/json",
        headers: {
          Authorization: "Bearer " + accessToken,
          Accept: "application/json",
        },
        payload: JSON.stringify({ raw: raw }),
        muteHttpExceptions: true,
      }
    );
    const code = res.getResponseCode();
    let data = {};
    try {
      data = JSON.parse(res.getContentText() || "{}");
    } catch (err) {}
    if (code < 200 || code >= 300) {
      const errMsg =
        (data && data.error && data.error.message) ||
        data.error ||
        "Gmail send failed (" + code + ")";
      return { ok: false, code: code, error: String(errMsg) };
    }
    return { ok: true, data: data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function buildSecureComposeBodyText_(cipher, meta, quotedClear) {
  const lines = [String(cipher || "").replace(/\s+/g, "")];
  if (meta && (meta.token || meta.emailEnc || meta.uuidEnc)) {
    lines.push("");
    if (meta.token) lines.push(String(meta.token).replace(/\s+/g, ""));
    if (meta.emailEnc) lines.push("email: " + meta.emailEnc);
    if (meta.uuidEnc) lines.push("uuid: " + meta.uuidEnc);
  }
  lines.push("");
  lines.push(
    "To know more, visit our website: " +
      String(
        typeof ADMIN_URL !== "undefined" && ADMIN_URL
          ? ADMIN_URL
          : "https://admin-panel-amber-nine.vercel.app"
      ).replace(/\/$/, "")
  );
  const quote = String(quotedClear || "").trim();
  if (quote) {
    lines.push("");
    lines.push(quote);
  }
  return lines.join("\n");
}

function getGmailMessage_(e) {
  if (!e || !e.gmail) return null;
  var accessToken = e.gmail.accessToken;
  var messageId = e.gmail.messageId;
  if (!accessToken || !messageId) return null;
  GmailApp.setCurrentMessageAccessToken(accessToken);
  return GmailApp.getMessageById(messageId);
}

function scanMessageForSecureDoc_(e) {
  var out = { cipher: "", attachments: [] };
  try {
    var msg = getGmailMessage_(e);
    if (!msg) return out;
    var body = msg.getPlainBody() || msg.getBody() || "";
    out.cipher = extractSdsCipher_(body) || "";

    var atts = [];
    try {
      atts =
        msg.getAttachments({
          includeInlineImages: false,
          includeAttachments: true,
        }) || [];
    } catch (attErr) {
      atts = msg.getAttachments() || [];
    }
    var i;
    for (i = 0; i < atts.length; i++) {
      var name = String(atts[i].getName() || "");
      var lower = name.toLowerCase();
      var bytes = atts[i].getBytes();
      var isSecureName = /\.secure[a-z0-9]+$/i.test(lower);
      var b0 = bytes && bytes.length >= 4 ? bytes[0] & 0xff : 0;
      var b1 = bytes && bytes.length >= 4 ? bytes[1] & 0xff : 0;
      var b2 = bytes && bytes.length >= 4 ? bytes[2] & 0xff : 0;
      var b3 = bytes && bytes.length >= 4 ? bytes[3] & 0xff : 0;
      var isSdsb = b0 === 0x53 && b1 === 0x44 && b2 === 0x53 && b3 === 0x42;
      if (isSecureName || isSdsb) {
        out.attachments.push({
          name: name || "encrypted.securefile",
          base64: Utilities.base64Encode(bytes),
        });
      }
    }
  } catch (err) {
    console.error("scanMessageForSecureDoc_", err);
  }
  return out;
}

function extractCipherFromMessage_(e) {
  return scanMessageForSecureDoc_(e).cipher || "";
}

/**
 * First sds. token in text, including start/end indexes in the original string
 * (whitespace inside the token is skipped when building cipher but included in the span).
 */
function extractSdsCipherSpan_(text) {
  var raw = String(text || "");
  var match = /sds\./i.exec(raw);
  if (!match) return null;

  var start = match.index;
  var i = match.index + 4;
  var b64 = "";
  while (i < raw.length) {
    var ch = raw.charAt(i);
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[A-Za-z0-9+/_\-]/.test(ch)) {
      b64 += ch;
      i += 1;
      continue;
    }
    if (ch === "=") {
      b64 += "=";
      i += 1;
      while (i < raw.length && /\s/.test(raw.charAt(i))) i += 1;
      if (raw.charAt(i) === "=") {
        b64 += "=";
        i += 1;
      }
      break;
    }
    break;
  }

  if (b64.length < 8) return null;
  return {
    cipher: "sds." + b64,
    start: start,
    end: i,
  };
}

function extractSdsCipher_(text) {
  var span = extractSdsCipherSpan_(text);
  return span ? span.cipher : "";
}

/**
 * Show ~4 lines in the card. "Show full message" downloads a .txt file
 * with the complete decrypted message (same download flow as PDF).
 */
function addDecryptedMessagePreview_(section, fieldName, title, fullText) {
  var preview = previewFourLines_(fullText);
  section.addWidget(
    CardService.newTextInput()
      .setFieldName(fieldName)
      .setTitle(title + " (first 4 lines)")
      .setMultiline(true)
      .setValue(preview)
  );

  var ready = prepareFullMessageTxtDownload_(fullText);
  if (ready.ok && ready.downloadUrl) {
    section.addWidget(
      CardService.newButtonSet().addButton(
        CardService.newTextButton()
          .setText("Show full message (.txt)")
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setOpenLink(
            CardService.newOpenLink()
              .setUrl(ready.downloadUrl)
              .setOpenAs(CardService.OpenAs.FULL_SIZE)
              .setOnClose(CardService.OnClose.NOTHING)
          )
      )
    );
  } else {
    section.addWidget(
      infoRow_(
        "Full message",
        ready.error || "Could not prepare message download."
      )
    );
  }
}

function previewFourLines_(text) {
  var s = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  var lines = s.split("\n");
  if (lines.length <= 4) {
    if (s.length <= 280) return s;
    return s.substring(0, 280) + "…";
  }
  return lines.slice(0, 4).join("\n") + "\n…";
}

/**
 * Build a .txt file from the full decrypted message and stage it for download.
 */
function prepareFullMessageTxtDownload_(fullText) {
  var text = String(fullText || "");
  if (!text) {
    return { ok: false, error: "Empty message", downloadUrl: "" };
  }

  // Strip HTML to plain text for the .txt file.
  if (/<\/?[a-z][\s\S]*>/i.test(text)) {
    text = text
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/\s*p\s*>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  var stamp = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone() || "UTC",
    "yyyyMMdd-HHmmss"
  );
  var filename = "securedoc-message-" + stamp + ".txt";
  var b64 = Utilities.base64Encode(text);
  return prepareDecryptedDownload_(filename, "text/plain;charset=utf-8", b64);
}

/**
 * Restore decrypted file to original name/mime (do not force .pdf).
 */

function normalizeDecryptedFileMeta_(attName, fileInfo, fallbackName) {
  var raw =
    (fileInfo && (fileInfo.filename || fileInfo.name)) ||
    fallbackName ||
    attName ||
    "document.bin";
  var name = String(raw).replace(/[\\/:*?"<>|]/g, "_");
  if (/\.secure[a-z0-9]+$/i.test(name)) {
    name = name.replace(/\.secure[a-z0-9]+$/i, "");
  }
  var mime =
    (fileInfo && (fileInfo.mimeType || fileInfo.contentType)) ||
    "application/octet-stream";
  if (!/\.[a-z0-9]+$/i.test(name)) {
    if (/pdf/i.test(mime)) name = name + ".pdf";
    else if (/png/i.test(mime)) name = name + ".png";
    else if (/jpeg|jpg/i.test(mime)) name = name + ".jpg";
    else if (/gif/i.test(mime)) name = name + ".gif";
    else if (/webp/i.test(mime)) name = name + ".webp";
    else if (/image\//i.test(mime)) name = name + ".img";
    else if (/text\//i.test(mime)) name = name + ".txt";
    else name = name + ".bin";
  }
  if (/\.pdf$/i.test(name)) mime = "application/pdf";
  else if (/\.png$/i.test(name)) mime = "image/png";
  else if (/\.jpe?g$/i.test(name)) mime = "image/jpeg";
  else if (/\.gif$/i.test(name)) mime = "image/gif";
  else if (/\.webp$/i.test(name)) mime = "image/webp";
  else if (/\.txt$/i.test(name) && mime === "application/octet-stream") {
    mime = "text/plain";
  }
  return { name: name, mime: mime };
}

/**
 * Decrypt → stage bytes in Apps Script cache → Download button saves to computer.
 * No server / Drive / DB. Gmail cannot write disk directly, so the button opens a
 * tiny download page that only triggers the browser Save dialog (not the login UI).
 *
 * Web app deploy MUST be: Execute as = Me, Who has access = Anyone
 * (If you pick "Anyone with Google account", Google shows a login screen.)
 */
function prepareDecryptedDownload_(filename, mimeType, dataBase64) {
  var safeName = String(filename || "decrypted.bin").replace(/[\\/:*?"<>|]/g, "_");
  var mime = mimeType || "application/octet-stream";
  var b64 = String(dataBase64 || "").replace(/\s+/g, "");
  if (!b64) {
    return { ok: false, error: "Empty file bytes", downloadUrl: "" };
  }

  var web = getWebAppUrl_();
  if (!web) {
    return {
      ok: false,
      error:
        "Deploy Web app first: Deploy → New deployment → Web app → Execute as Me, Access Anyone.",
      downloadUrl: "",
    };
  }

  try {
    var key = Utilities.getUuid().replace(/-/g, "").slice(0, 24);
    var CHUNK = 90000;
    var chunks = Math.ceil(b64.length / CHUNK) || 1;
    if (chunks > 80) {
      return {
        ok: false,
        error: "File too large for add-on download.",
        downloadUrl: "",
      };
    }
    // ScriptCache works when Web app runs as "Me" (UserCache does not).
    var meta = JSON.stringify({ n: safeName, m: mime, c: chunks });
    putDownloadCache_("sdl_" + key, meta);
    var i;
    for (i = 0; i < chunks; i++) {
      putDownloadCache_("sdl_" + key + "_" + i, b64.substr(i * CHUNK, CHUNK));
    }
    var sep = web.indexOf("?") >= 0 ? "&" : "?";
    return {
      ok: true,
      downloadUrl: web + sep + "download=" + encodeURIComponent(key),
    };
  } catch (cacheErr) {
    return {
      ok: false,
      error: String(cacheErr),
      downloadUrl: "",
    };
  }
}

function putDownloadCache_(k, v) {
  CacheService.getScriptCache().put(k, v, 600);
  try {
    CacheService.getUserCache().put(k, v, 600);
  } catch (e) {}
}

function getDownloadCache_(k) {
  var v = CacheService.getScriptCache().get(k);
  if (v != null) return v;
  try {
    return CacheService.getUserCache().get(k);
  } catch (e) {
    return null;
  }
}

function escapeHtml_(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function notify_(text) {
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(String(text || "")))
    .build();
}

function getWebAppUrl_() {
  if (WEB_APP_URL && String(WEB_APP_URL).indexOf("http") === 0) {
    return String(WEB_APP_URL);
  }
  try {
    var url = ScriptApp.getService().getUrl();
    if (url && String(url).indexOf("http") === 0) return String(url);
  } catch (e) {}
  return "";
}

/** Web app: ?download= | OAuth callback | Index panel */
function doGet(e) {
  e = e || {};
  var params = e.parameter || {};
  var downloadKey = params.download || "";
  if (!downloadKey && e.parameters && e.parameters.download) {
    downloadKey = e.parameters.download[0] || "";
  }
  if (downloadKey) {
    return serveCachedDownload_(String(downloadKey));
  }

  var oauthError = params.oauth_error || "";
  if (!oauthError && e.parameters && e.parameters.oauth_error) {
    oauthError = e.parameters.oauth_error[0] || "";
  }
  var oauthTicket = params.oauth_ticket || "";
  if (!oauthTicket && e.parameters && e.parameters.oauth_ticket) {
    oauthTicket = e.parameters.oauth_ticket[0] || "";
  }

  if (oauthError) {
    return HtmlService.createHtmlOutput(
      "<!DOCTYPE html><html><body style='font-family:Arial,sans-serif;padding:24px;background:#0f1c24;color:#eef6f8'>" +
        "<p style='font-size:18px;font-weight:700'>SecureDocShare</p>" +
        "<p style='color:#ff6b7a'>Sign-in failed: " +
        escapeHtml_(oauthError) +
        "</p>" +
        "<p style='color:#9db4bd'>Close this tab and try again from the Gmail add-on.</p>" +
        "</body></html>"
    ).setTitle("Sign-in failed");
  }

  if (oauthTicket) {
    // Legacy fallback: ticket landed on Apps Script instead of API popup-done.
    // Complete server-side, then tell opener (or show close page).
    var done = apiOAuthComplete_(String(oauthTicket));
    if (!done.ok) {
      return HtmlService.createHtmlOutput(
        "<!DOCTYPE html><html><body style='font-family:Arial,sans-serif;padding:24px;background:#0f1c24;color:#eef6f8'>" +
          "<p style='font-size:18px;font-weight:700'>SecureDocShare</p>" +
          "<p style='color:#ff6b7a'>" +
          escapeHtml_(done.error || "Google sign-in failed") +
          "</p>" +
          "<p style='color:#9db4bd'>Close this tab and try again.</p>" +
          "</body></html>"
      ).setTitle("Sign-in failed");
    }
    saveWorkspaceSession({
      token: done.token,
      email: done.email,
      expiresAt: done.expiresAt || null,
    });
    var payload = {
      type: "securedoc-oauth",
      ok: true,
      token: done.token || "",
      email: done.email || "",
      expiresAt: done.expiresAt || null,
      refreshToken: done.refreshToken || null,
    };
    return HtmlService.createHtmlOutput(
      "<!DOCTYPE html><html><body style='font-family:Arial,sans-serif;padding:24px;background:#0f1c24;color:#eef6f8'>" +
        "<p style='font-size:18px;font-weight:700'>SecureDocShare</p>" +
        "<p style='color:#2bb3a0'>✔ Signed in as " +
        escapeHtml_(done.email || "user") +
        "</p>" +
        "<p style='color:#9db4bd'>Closing this window…</p>" +
        "<script>(function(){var p=" +
        JSON.stringify(payload) +
        ";try{if(window.opener&&!window.opener.closed){window.opener.postMessage(p,'*');}}catch(e){}" +
        "setTimeout(function(){try{window.close();}catch(e2){}" +
        "document.body.innerHTML='<p style=\"font-family:Arial;padding:24px\">Signed in. You can close this tab and return to Gmail.</p>';},500);})();</script>" +
        "</body></html>"
    )
      .setTitle("Signed in")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // Must use Template so <?!= include(...) ?> in Index.html are evaluated.
  return HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("SecureDocShare Workspace")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function serveCachedDownload_(key) {
  var raw = getDownloadCache_("sdl_" + key);
  if (!raw) {
    return HtmlService.createHtmlOutput(
      "<!DOCTYPE html><html><body style='font-family:Arial;padding:16px'>" +
        "<p><b>Download expired or Web app access is wrong.</b></p>" +
        "<p>1) Open the mail in SecureDocShare again (decrypt refreshes the file).</p>" +
        "<p>2) Redeploy Web app: <b>Execute as: Me</b>, <b>Who has access: Anyone</b>.</p>" +
        "</body></html>"
    ).setTitle("Download expired");
  }
  var meta = {};
  try {
    meta = JSON.parse(raw);
  } catch (err) {
    return HtmlService.createHtmlOutput("<p>Invalid download token.</p>");
  }
  var name = String(meta.n || "decrypted.bin").replace(/"/g, "");
  var mime = String(meta.m || "application/octet-stream").replace(/"/g, "");
  var b64 = String(meta.b || "");
  var chunks = Number(meta.c || 0);
  if (!b64 && chunks > 0) {
    var parts = [];
    var i;
    for (i = 0; i < chunks; i++) {
      var part = getDownloadCache_("sdl_" + key + "_" + i);
      if (part == null) {
        return HtmlService.createHtmlOutput(
          "<p>Download data incomplete. Open the mail and decrypt again.</p>"
        ).setTitle("Download failed");
      }
      parts.push(part);
    }
    b64 = parts.join("");
  }
  if (!b64) {
    return HtmlService.createHtmlOutput("<p>No file data found.</p>").setTitle(
      "Download failed"
    );
  }

  // Minimal page: only triggers browser download of the decrypted file.
  var html =
    "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Saving file</title></head>" +
    "<body style='font-family:Arial,sans-serif;padding:20px;color:#333'>" +
    "<p>Saving <b>" +
    escapeHtml_(name) +
    "</b> to your computer…</p>" +
    "<p style='font-size:13px;color:#666'>If the file did not save, <a id='manual' href='#'>click here</a>.</p>" +
    "<script>(function(){" +
    "var b64=" +
    JSON.stringify(b64) +
    ",mime=" +
    JSON.stringify(mime) +
    ",name=" +
    JSON.stringify(name) +
    ";" +
    "function save(){" +
    "var bin=atob(b64),arr=new Uint8Array(bin.length);" +
    "for(var i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);" +
    "var blob=new Blob([arr],{type:mime||'application/octet-stream'});" +
    "var url=URL.createObjectURL(blob);" +
    "var a=document.createElement('a');a.href=url;a.download=name;" +
    "document.body.appendChild(a);a.click();" +
    "setTimeout(function(){URL.revokeObjectURL(url);},2000);" +
    "return url;" +
    "}" +
    "var u=save();" +
    "var m=document.getElementById('manual');" +
    "if(m){m.onclick=function(ev){ev.preventDefault();m.href=save();m.download=name;};}" +
    "})();</script></body></html>";
  return HtmlService.createHtmlOutput(html)
    .setTitle("Download " + name)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
