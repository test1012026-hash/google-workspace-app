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
