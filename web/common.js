/** Values come from src/config.js (must load before this file). */
var DEFAULT_API_BASE =
  (typeof SecureDocConfig !== "undefined" && SecureDocConfig.getApiBaseUrl()) ||
  "http://localhost:4000/api";
var LOGIN_WEB_URL =
  (typeof SecureDocConfig !== "undefined" && SecureDocConfig.getLoginWebUrl()) ||
  "https://admin-panel-amber-nine.vercel.app/login";
var ADDIN_HTTPS_ORIGIN =
  (typeof SecureDocConfig !== "undefined" &&
    SecureDocConfig.getAddinHttpsOrigin()) ||
  "https://localhost:3000";
var SESSION_STORAGE_KEY =
  (typeof SecureDocConfig !== "undefined" &&
    SecureDocConfig.getSessionStorageKey()) ||
  "securedoc_outlook_session";

function normalizeBaseUrl(url) {
  return String(
    url ||
      (typeof SecureDocConfig !== "undefined" && SecureDocConfig.getApiBaseUrl()) ||
      DEFAULT_API_BASE
  ).replace(/\/$/, "");
}

function getLoginWebUrl() {
  if (typeof SecureDocConfig !== "undefined" && SecureDocConfig.getLoginWebUrl) {
    return SecureDocConfig.getLoginWebUrl();
  }
  return LOGIN_WEB_URL;
}

function getAddinHttpsOrigin() {
  if (
    typeof SecureDocConfig !== "undefined" &&
    SecureDocConfig.getAddinHttpsOrigin
  ) {
    return SecureDocConfig.getAddinHttpsOrigin();
  }
  return ADDIN_HTTPS_ORIGIN;
}

/**
 * Outlook Smart Alerts only clicks HTTPS links.
 * Bridge page redirects to the admin login URL from config.
 */
function getClickableLoginUrl() {
  if (
    typeof SecureDocConfig !== "undefined" &&
    SecureDocConfig.getClickableLoginUrl
  ) {
    return SecureDocConfig.getClickableLoginUrl();
  }
  return (
    getAddinHttpsOrigin() +
    "/open-login.html?to=" +
    encodeURIComponent(getLoginWebUrl())
  );
}

function getTaskpaneCommandId() {
  if (
    typeof SecureDocConfig !== "undefined" &&
    SecureDocConfig.getTaskpaneCommandId
  ) {
    return SecureDocConfig.getTaskpaneCommandId();
  }
  return "SecureDocLoginButton";
}

function loginRequiredMessage(extra) {
  var base =
    "Login required to encrypt. Click Sign in to open the SecureDoc side panel, sign in, then try Send again.";
  if (extra) base = String(extra) + " " + base;
  return base;
}

/**
 * Blocks Send and offers a Smart Alerts action that opens the SecureDoc task pane.
 * (Mailbox 1.14+: commandId → Take Action / customized Don't Send opens the side panel.)
 * Only valid for OnMessageSend — not OnMessageDecrypt.
 */
function loginRequiredCompleted(eventOrComplete, extra) {
  var md =
    "**Login required** to encrypt or decrypt.\n\n" +
    (extra ? String(extra) + "\n\n" : "") +
    "Click **Sign in** to open the SecureDoc side panel, then sign in and try Send again.";

  var payload = {
    allowEvent: false,
    errorMessage: loginRequiredMessage(extra),
    errorMessageMarkdown: md,
    // Opens SecureDoc task pane (side panel) — not a browser page
    commandId: getTaskpaneCommandId(),
    cancelLabel: "Sign in",
  };

  if (typeof eventOrComplete === "function") {
    eventOrComplete(payload);
    return;
  }
  if (eventOrComplete && typeof eventOrComplete.completed === "function") {
    eventOrComplete.completed(payload);
  }
}

/**
 * OnMessageDecrypt cannot use Smart Alerts dialogs (commandId / cancelLabel).
 * Outlook only shows a notification bar; pass a clear errorMessage.
 */
function decryptLoginRequiredCompleted(eventOrComplete, extra) {
  var msg =
    "Login required to decrypt. Open the SecureDoc task pane (Apps → SecureDoc), sign in, then open this message again.";
  if (extra) msg = String(extra) + " " + msg;

  var payload = {
    allowEvent: false,
    errorMessage: msg,
  };

  if (typeof eventOrComplete === "function") {
    eventOrComplete(payload);
    return;
  }
  if (eventOrComplete && typeof eventOrComplete.completed === "function") {
    eventOrComplete.completed(payload);
  }
}

function readSessionFromRoaming() {
  try {
    if (
      typeof Office !== "undefined" &&
      Office.context &&
      Office.context.roamingSettings
    ) {
      var raw = Office.context.roamingSettings.get(SESSION_STORAGE_KEY);
      if (!raw) return null;
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    }
  } catch (e) {}
  return null;
}

function readSessionFromLocal() {
  try {
    if (typeof localStorage === "undefined") return null;
    var raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function getStoredSession() {
  return readSessionFromRoaming() || readSessionFromLocal();
}

function saveSession(session) {
  var data = {
    token: session && session.token ? String(session.token) : "",
    expiresAt: session && session.expiresAt ? String(session.expiresAt) : null,
    email: session && session.email ? String(session.email) : "",
    savedAt: new Date().toISOString(),
  };
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data));
    }
  } catch (e) {}
  try {
    if (
      typeof Office !== "undefined" &&
      Office.context &&
      Office.context.roamingSettings
    ) {
      Office.context.roamingSettings.set(SESSION_STORAGE_KEY, data);
      Office.context.roamingSettings.saveAsync(function () {});
    }
  } catch (e2) {}
  return data;
}

function clearSession() {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch (e) {}
  try {
    if (
      typeof Office !== "undefined" &&
      Office.context &&
      Office.context.roamingSettings
    ) {
      Office.context.roamingSettings.remove(SESSION_STORAGE_KEY);
      Office.context.roamingSettings.saveAsync(function () {});
    }
  } catch (e2) {}
  try {
    if (typeof OfficeRuntime !== "undefined" && OfficeRuntime.storage) {
      OfficeRuntime.storage.removeItem(SESSION_STORAGE_KEY).catch(function () {});
    }
  } catch (e3) {}
}

/**
 * Sign out: invalidate JWT session on the server, then clear local Outlook storage.
 */
function logoutSession(options) {
  options = options || {};
  var baseUrl = normalizeBaseUrl(options.apiBaseUrl);
  var session = getStoredSession();
  var token = session && session.token ? session.token : null;

  function finishLocal() {
    clearSession();
    return success(200, {
      loggedOut: true,
      serverCleared: Boolean(token),
    });
  }

  if (!token) {
    return Promise.resolve(finishLocal());
  }

  return apiRequest(baseUrl, "/auth/logout", {
    method: "POST",
    token: token,
    body: {},
  })
    .then(function (out) {
      // Always clear local session even if server call fails (token may already be invalid)
      var local = finishLocal();
      if (!out.res.ok) {
        console.warn("Server logout failed; local session cleared", out.data);
        return success(200, {
          loggedOut: true,
          serverCleared: false,
          warning: (out.data && out.data.error) || "Server logout failed",
        });
      }
      return local;
    })
    .catch(function (err) {
      console.warn("Server logout error; local session cleared", err);
      finishLocal();
      return success(200, {
        loggedOut: true,
        serverCleared: false,
        warning: (err && err.message) || "Server logout failed",
      });
    });
}

function isSessionExpiredLocally(session) {
  if (!session || !session.token) return true;
  if (!session.expiresAt) return false;
  var exp = new Date(session.expiresAt).getTime();
  if (!exp || isNaN(exp)) return false;
  // 30s skew
  return exp <= Date.now() + 30 * 1000;
}

/**
 * Require a valid SecureDoc login token before encrypt/decrypt.
 * Validates local expiry, then GET /auth/subscription with Bearer token.
 */
function ensureAuthSession(options) {
  options = options || {};
  var baseUrl = normalizeBaseUrl(options.apiBaseUrl);
  var session = getStoredSession();

  if (!session || !session.token) {
    return Promise.resolve(
      failure(401, {
        error: loginRequiredMessage("You are not logged in."),
        code: "LOGIN_REQUIRED",
        loginUrl: getLoginWebUrl(),
      })
    );
  }

  if (isSessionExpiredLocally(session)) {
    clearSession();
    return Promise.resolve(
      failure(440, {
        error: loginRequiredMessage("Your session has expired."),
        code: "TOKEN_EXPIRED",
        loginUrl: getLoginWebUrl(),
      })
    );
  }

  return apiRequest(baseUrl, "/auth/subscription", {
    method: "GET",
    token: session.token,
  })
    .then(function (out) {
      var res = out.res;
      var data = out.data || {};
      var status = res.status || 0;

      if (
        status === 440 ||
        data.code === "RELOGIN_REQUIRED" ||
        data.code === "TOKEN_EXPIRED"
      ) {
        clearSession();
        return failure(440, {
          error: loginRequiredMessage("Your session has expired."),
          code: "TOKEN_EXPIRED",
          loginUrl: getLoginWebUrl(),
        });
      }

      if (
        status === 401 ||
        data.code === "TOKEN_MISSING" ||
        data.code === "TOKEN_INVALID"
      ) {
        clearSession();
        return failure(401, {
          error: loginRequiredMessage("Your session is invalid."),
          code: "LOGIN_REQUIRED",
          loginUrl: getLoginWebUrl(),
        });
      }

      if (!res.ok) {
        return failure(
          status || 500,
          data,
          data.error || "Could not verify login session"
        );
      }

      var resolvedEmail = String(
        data.email || session.email || ""
      )
        .trim()
        .toLowerCase();
      if (resolvedEmail && resolvedEmail !== String(session.email || "").toLowerCase()) {
        saveSession({
          token: session.token,
          expiresAt: session.expiresAt,
          email: resolvedEmail,
        });
      }

      return success(200, {
        authenticated: true,
        token: session.token,
        email: resolvedEmail || session.email || null,
        expiresAt: session.expiresAt || null,
        subscription: data,
        loginUrl: getLoginWebUrl(),
      });
    })
    .catch(function (err) {
      return failure(500, {
        error: (err && err.message) || "Could not verify login session",
        code: "AUTH_CHECK_FAILED",
        loginUrl: getLoginWebUrl(),
      });
    });
}

function normalizeEmailAddress(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

/**
 * SecureDoc login email must match the Outlook mailbox sending/reading the mail.
 */
function assertLoginMatchesMailbox(loginEmail, mailboxEmail) {
  var login = normalizeEmailAddress(loginEmail);
  var mailbox = normalizeEmailAddress(mailboxEmail);

  if (!login) {
    return failure(401, {
      error: "Login email missing. Sign out and sign in again.",
      code: "LOGIN_EMAIL_MISSING",
    });
  }
  if (!mailbox) {
    return failure(400, {
      error: "Could not determine the Outlook mailbox email.",
      code: "MAILBOX_EMAIL_MISSING",
    });
  }
  if (login !== mailbox) {
    return failure(403, {
      error:
        "Logged in as " +
        login +
        " but Outlook is " +
        mailbox +
        ". Sign in with the same email as this Outlook account to encrypt or decrypt.",
      code: "SENDER_LOGIN_MISMATCH",
      loginEmail: login,
      mailboxEmail: mailbox,
    });
  }
  return success(200, {
    matched: true,
    email: login,
  });
}

/**
 * Persist token from login/signup API response.
 */
function storeAuthResponse(data, email) {
  var token = data.token || data.accessToken || null;
  if (!token) {
    return failure(500, {
      error: "Succeeded but no token was returned",
      code: "TOKEN_MISSING",
    });
  }
  var saved = saveSession({
    token: token,
    expiresAt: data.expiresAt || null,
    email: data.email || email,
  });
  return success(200, {
    authenticated: true,
    token: saved.token,
    email: saved.email,
    expiresAt: saved.expiresAt,
    loginUrl: getLoginWebUrl(),
  });
}

/**
 * Email/password login for Outlook task pane → stores access token.
 */
function loginWithPassword(options) {
  options = options || {};
  var baseUrl = normalizeBaseUrl(options.apiBaseUrl);
  var email = String(options.email || "").trim().toLowerCase();
  var password = String(options.password || "");

  if (!email || !password) {
    return Promise.resolve(
      failure(400, {
        error: "Email and password are required",
        code: "CREDENTIALS_REQUIRED",
      })
    );
  }

  return apiRequest(baseUrl, "/auth/login", {
    method: "POST",
    body: { email: email, password: password },
  }).then(function (out) {
    var res = out.res;
    var data = out.data || {};
    if (!res.ok) {
      return failure(res.status || 401, data, data.error || "Login failed");
    }
    return storeAuthResponse(data, email);
  });
}

/**
 * Step 1 of email signup: send 4-digit OTP.
 */
function sendSignupOtp(options) {
  options = options || {};
  var baseUrl = normalizeBaseUrl(options.apiBaseUrl);
  var email = String(options.email || "").trim().toLowerCase();
  var acceptTerms = options.acceptTerms === true;

  if (!email) {
    return Promise.resolve(
      failure(400, {
        error: "Email is required",
        code: "EMAIL_REQUIRED",
      })
    );
  }
  if (!acceptTerms) {
    return Promise.resolve(
      failure(400, {
        error: "You must accept the Terms & Conditions to sign up",
        code: "TERMS_REQUIRED",
      })
    );
  }

  return apiRequest(baseUrl, "/auth/signup/send-otp", {
    method: "POST",
    body: { email: email, acceptTerms: true },
  }).then(function (out) {
    var res = out.res;
    var data = out.data || {};
    if (!res.ok) {
      return failure(res.status || 400, data, data.error || "Could not send code");
    }
    return success(res.status || 200, data);
  });
}

/**
 * Email/password signup (same as extension) → stores access token.
 * Requires 4-digit OTP from sendSignupOtp.
 */
function signupWithPassword(options) {
  options = options || {};
  var baseUrl = normalizeBaseUrl(options.apiBaseUrl);
  var email = String(options.email || "").trim().toLowerCase();
  var password = String(options.password || "");
  var otp = String(options.otp || "").trim();
  var acceptTerms = options.acceptTerms === true;

  if (!email || !password) {
    return Promise.resolve(
      failure(400, {
        error: "Email and password are required",
        code: "CREDENTIALS_REQUIRED",
      })
    );
  }
  if (password.length < 12) {
    return Promise.resolve(
      failure(400, {
        error: "Password must be at least 12 characters",
        code: "PASSWORD_TOO_SHORT",
      })
    );
  }
  if (!acceptTerms) {
    return Promise.resolve(
      failure(400, {
        error: "You must accept the Terms & Conditions to sign up",
        code: "TERMS_REQUIRED",
      })
    );
  }
  if (!/^\d{4}$/.test(otp)) {
    return Promise.resolve(
      failure(400, {
        error: "Enter the 4-digit verification code",
        code: "OTP_INVALID",
      })
    );
  }

  return apiRequest(baseUrl, "/auth/signup", {
    method: "POST",
    body: {
      email: email,
      password: password,
      acceptTerms: true,
      otp: otp,
    },
  }).then(function (out) {
    var res = out.res;
    var data = out.data || {};
    if (!res.ok) {
      return failure(res.status || 400, data, data.error || "Signup failed");
    }
    return storeAuthResponse(data, email);
  });
}

/**
 * OAuth 2.0 sign-in / sign-up via Office dialog (Google, Microsoft, Yahoo).
 * Opens oauth-dialog.html → IdP → oauth-dialog-callback.html → messageParent.
 */
function loginWithOAuth(options) {
  options = options || {};
  var provider = String(options.provider || "").toLowerCase();
  var intent = options.intent === "signup" ? "signup" : "login";
  var acceptTerms = options.acceptTerms === true;

  if (["google", "microsoft", "yahoo"].indexOf(provider) < 0) {
    return Promise.resolve(
      failure(400, {
        error: "Unknown OAuth provider",
        code: "OAUTH_PROVIDER_UNKNOWN",
      })
    );
  }
  if (intent === "signup" && !acceptTerms) {
    return Promise.resolve(
      failure(400, {
        error: "You must accept the Terms & Conditions to sign up",
        code: "TERMS_REQUIRED",
      })
    );
  }
  if (
    typeof Office === "undefined" ||
    !Office.context ||
    !Office.context.ui ||
    typeof Office.context.ui.displayDialogAsync !== "function"
  ) {
    // Google Workspace / browser: open OAuth in a popup (no Office dialog).
    var apiBase = normalizeBaseUrl(options.apiBaseUrl);
    var returnOrigin =
      typeof location !== "undefined" && location.origin
        ? String(location.origin).replace(/\/$/, "")
        : getAddinHttpsOrigin();
    var returnPath =
      typeof location !== "undefined" && location.pathname
        ? String(location.pathname)
        : "/";
    var startQs = new URLSearchParams({
      returnOrigin: returnOrigin,
      returnPath: returnPath,
      intent: intent,
    });
    if (intent === "signup") {
      startQs.set("acceptTerms", acceptTerms ? "1" : "0");
    }
    var startUrl =
      apiBase + "/auth/oauth/" + provider + "/start?" + startQs.toString();

    return new Promise(function (resolve) {
      var popup = null;
      try {
        popup = window.open(startUrl, "securedoc_oauth", "width=520,height=720");
      } catch (e) {
        popup = null;
      }
      if (!popup) {
        resolve(
          failure(501, {
            error:
              "Popup blocked. Allow popups and try again, or use email/password.",
            code: "OAUTH_POPUP_BLOCKED",
          })
        );
        return;
      }

      var settled = false;
      function settle(result) {
        if (settled) return;
        settled = true;
        try {
          window.removeEventListener("message", onMessage);
        } catch (e) {}
        try {
          if (popup && !popup.closed) popup.close();
        } catch (e2) {}
        resolve(result);
      }

      function onMessage(ev) {
        var data = ev && ev.data;
        if (!data || typeof data !== "object") return;
        var payload = data.payload || data;
        if (data.source === "securedoc-oauth" || data.type === "securedoc-oauth") {
          payload = data.payload || data;
        } else if (!(payload.token || payload.ok === false || payload.error)) {
          return;
        }
        if (!payload.ok || !payload.token) {
          settle(
            failure(401, {
              error: payload.error || "Sign-in failed",
              code: payload.code || "OAUTH_FAILED",
            })
          );
          return;
        }
        settle(
          storeAuthResponse(
            {
              token: payload.token,
              expiresAt: payload.expiresAt,
              email: payload.email,
              refreshToken: payload.refreshToken,
            },
            payload.email || ""
          )
        );
      }

      window.addEventListener("message", onMessage);
      var ticks = 0;
      var timer = setInterval(function () {
        ticks += 1;
        if (popup && popup.closed) {
          clearInterval(timer);
          settle(
            failure(499, {
              error: "Sign-in cancelled",
              code: "OAUTH_CANCELLED",
            })
          );
        } else if (ticks > 180) {
          clearInterval(timer);
          settle(
            failure(408, {
              error: "Sign-in timed out",
              code: "OAUTH_TIMEOUT",
            })
          );
        }
      }, 1000);
    });
  }

  var origin = getAddinHttpsOrigin();
  var qs = new URLSearchParams({
    provider: provider,
    intent: intent,
  });
  if (intent === "signup") {
    qs.set("acceptTerms", acceptTerms ? "1" : "0");
  }
  var dialogUrl = origin + "/oauth-dialog.html?" + qs.toString();

  return new Promise(function (resolve) {
    var dialog = null;
    var settled = false;

    function settle(result) {
      if (settled) return;
      settled = true;
      try {
        if (dialog && typeof dialog.close === "function") dialog.close();
      } catch (e) {}
      resolve(result);
    }

    Office.context.ui.displayDialogAsync(
      dialogUrl,
      { height: 65, width: 35, displayInIframe: false },
      function (asyncResult) {
        if (asyncResult.status !== Office.AsyncResultStatus.Succeeded) {
          settle(
            failure(500, {
              error:
                (asyncResult.error && asyncResult.error.message) ||
                "Could not open sign-in dialog",
              code: "OAUTH_DIALOG_OPEN_FAILED",
            })
          );
          return;
        }

        dialog = asyncResult.value;
        dialog.addEventHandler(
          Office.EventType.DialogMessageReceived,
          function (arg) {
            var payload = {};
            try {
              payload = JSON.parse(arg.message || "{}");
            } catch (e) {
              settle(
                failure(500, {
                  error: "Invalid response from sign-in dialog",
                  code: "OAUTH_DIALOG_BAD_MESSAGE",
                })
              );
              return;
            }
            if (!payload.ok || !payload.token) {
              settle(
                failure(401, {
                  error: payload.error || "Sign-in failed",
                  code: payload.code || "OAUTH_FAILED",
                })
              );
              return;
            }
            settle(
              storeAuthResponse(
                {
                  token: payload.token,
                  expiresAt: payload.expiresAt,
                  email: payload.email,
                  refreshToken: payload.refreshToken,
                },
                payload.email || ""
              )
            );
          }
        );
        dialog.addEventHandler(
          Office.EventType.DialogEventReceived,
          function (arg) {
            // 12006 = user closed the dialog
            if (arg && arg.error === 12006) {
              settle(
                failure(499, {
                  error: "Sign-in cancelled",
                  code: "OAUTH_CANCELLED",
                })
              );
            }
          }
        );
      }
    );
  });
}

function fetchOAuthProviders(options) {
  options = options || {};
  var baseUrl = normalizeBaseUrl(options.apiBaseUrl);
  return apiRequest(baseUrl, "/auth/oauth/providers", {
    method: "GET",
  }).then(function (out) {
    if (!out.res.ok) {
      return { providers: [] };
    }
    return {
      providers: Array.isArray(out.data && out.data.providers)
        ? out.data.providers
        : [],
    };
  });
}

function failure(status, data, fallbackError) {
  data = data || {};
  return {
    ok: false,
    status: status,
    error: data.error || data.message || fallbackError || "Request failed",
    code: data.code || null,
    data: data,
    subscriptionActive: data.subscriptionActive === true,
  };
}

function success(status, data) {
  data = data || {};
  var out = {
    ok: true,
    status: status,
    error: null,
    code: null,
    data: data,
  };
  for (var key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      out[key] = data[key];
    }
  }
  return out;
}

function parseJsonText(text, statusText) {
  try {
    return text ? JSON.parse(text) : null;
  } catch (e) {
    return { error: text || statusText || "Invalid JSON response" };
  }
}

function apiRequest(baseUrl, path, options) {
  options = options || {};
  var headers = { Accept: "application/json" };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.token) {
    headers.Authorization = "Bearer " + options.token;
  }

  return fetch(baseUrl + path, {
    method: options.method || "GET",
    headers: headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }).then(function (res) {
    return res.text().then(function (text) {
      return {
        res: res,
        data: parseJsonText(text, res.statusText),
      };
    });
  });
}

function getSenderEmail() {
  try {
    if (
      Office &&
      Office.context &&
      Office.context.mailbox &&
      Office.context.mailbox.userProfile
    ) {
      return Office.context.mailbox.userProfile.emailAddress || "";
    }
  } catch (e) {}
  return "";
}

function checkSenderSubscription(options) {
  options = options || {};
  var baseUrl = normalizeBaseUrl(options.apiBaseUrl);
  var email = options.email || getSenderEmail();

  if (!email) {
    return Promise.resolve(
      failure(400, {
        error: "Email is required",
        code: "EMAIL_REQUIRED",
      }),
    );
  }

  var qs = "?email=" + encodeURIComponent(String(email).trim().toLowerCase());

  return apiRequest(baseUrl, "/public/subscription-check" + qs, {}).then(
    function (out) {
      var res = out.res;
      var data = out.data || {};

      if (res.status === 404 || data.exists === false) {
        return failure(404, {
          error: data.error || "No account found for this email",
          code: data.code || "USER_NOT_FOUND",
          exists: false,
          subscriptionActive: false,
        });
      }

      if (!res.ok || data.ok === false) {
        return failure(
          res.status || 500,
          data,
          data.error || "Failed to check subscription",
        );
      }

      if (!data.subscriptionActive) {
        return failure(403, {
          error:
            data.code === "SUBSCRIBER_NOT_CLAIMED"
              ? "Account exists but has not been claimed yet"
              : "Subscription is expired or inactive",
          code: data.code || "SUBSCRIPTION_EXPIRED",
          exists: true,
          claimed: Boolean(data.claimed),
          subscriptionActive: false,
          subscriptionExpiresAt: data.subscriptionExpiresAt || null,
          subscriptionDaysLeft:
            data.subscriptionDaysLeft != null ? data.subscriptionDaysLeft : 0,
        });
      }

      return success(200, {
        exists: true,
        claimed: Boolean(data.claimed),
        subscriptionActive: true,
        subscriptionExpiresAt: data.subscriptionExpiresAt || null,
        subscriptionDaysLeft:
          data.subscriptionDaysLeft != null ? data.subscriptionDaysLeft : null,
        code: data.code || "SUBSCRIPTION_ACTIVE",
        email: email,
      });
    },
  );
}

var checkSubscription = checkSenderSubscription;

/**
 * Encrypt message and/or file for recipient.
 * POST /public/encrypt
 * Returns messageCipherText + optional SDSB .securepdf attachment.
 */
function encryptOnly(options) {
  options = options || {};
  var baseUrl = normalizeBaseUrl(options.apiBaseUrl);
  var recipient = options.to || options.receiverEmail;
  var subject = options.subject || "";
  var message = options.message || "";
  var filePayload = options.fileBase64 || options.fileContent || null;
  var fileName = options.fileName;
  var mimeType = options.mimeType;

  if (!recipient) {
    return Promise.resolve(
      failure(400, {
        error: "Recipient email (to) is required",
        code: "RECIPIENT_REQUIRED",
      }),
    );
  }

  var hasMessage = String(message || "").trim().length > 0;
  var hasFile = Boolean(filePayload);
  if (!hasMessage && !hasFile) {
    return Promise.resolve(
      failure(400, {
        error: "Add a message or a file (or both)",
        code: "CONTENT_REQUIRED",
      }),
    );
  }

  var body = {
    to: recipient,
    subject: subject,
    message: message || "",
  };
  if (filePayload) {
    body.fileBase64 = filePayload;
    body.fileName = fileName || "document.bin";
    body.mimeType = mimeType || "application/octet-stream";
  }

  return apiRequest(baseUrl, "/public/encrypt", {
    method: "POST",
    body: body,
  }).then(function (out) {
    var res = out.res;
    var data = out.data || {};

    if (!res.ok || data.ok === false) {
      return failure(res.status || 500, data, data.error || "Encrypt failed");
    }

    return success(res.status, {
      encrypted: true,
      recipientUuid: data.recipientUuid || null,
      recipientEmail: data.recipientEmail || null,
      recipientCreated: Boolean(data.recipientCreated),
      recipientClaimed: Boolean(data.recipientClaimed),
      keysCreated: Boolean(data.keysCreated),
      subscriptionActive: Boolean(data.subscriptionActive),
      subject: data.subject,
      contentKind: data.contentKind || null,
      messageCipherText: data.messageCipherText || null,
      fileCipherText: data.fileCipherText || null,
      attachment: data.attachment || null,
      mailMetadata: data.mailMetadata || null,
    });
  });
}

function looksLikeBase64String(value) {
  var s = String(value || "").replace(/\s+/g, "");
  if (s.length < 80) return false;
  if (s.indexOf("base64,") !== -1) return true;
  return /^[A-Za-z0-9+/=_-]+$/.test(s);
}

function cleanBase64Payload(value) {
  var s = String(value || "");
  var idx = s.indexOf("base64,");
  if (idx !== -1) s = s.slice(idx + 7);
  return s.replace(/\s+/g, "");
}

/**
 * Pull decrypted PDF bytes from any SecureDoc decrypt response shape.
 */
function extractDecryptedFileBase64(res, fallbackName) {
  if (!res) return null;

  var fileName =
    res.filename || res.fileName || fallbackName || "decrypted.pdf";
  var mimeType = res.mimeType || "application/pdf";

  var direct =
    res.decryptedBase64 ||
    res.fileBase64 ||
    res.decryptedFileBase64 ||
    null;
  if (direct && looksLikeBase64String(direct)) {
    return {
      base64: cleanBase64Payload(direct),
      fileName: fileName,
      mimeType: mimeType,
    };
  }

  var file = res.file || res.attachment;
  if (typeof file === "string" && looksLikeBase64String(file)) {
    return {
      base64: cleanBase64Payload(file),
      fileName: fileName,
      mimeType: mimeType,
    };
  }

  if (file && typeof file === "object") {
    var keys = [
      "decryptedBase64",
      "fileBase64",
      "attachmentBase64",
      "base64",
      "content",
      "data",
      "binary",
      "buffer",
      "bytes",
      "fileContent",
      "decryptedContent",
      "payload",
      "body",
    ];
    var i;
    for (i = 0; i < keys.length; i++) {
      var val = file[keys[i]];
      if (val && looksLikeBase64String(val)) {
        return {
          base64: cleanBase64Payload(val),
          fileName:
            file.fileName ||
            file.name ||
            file.filename ||
            fileName,
          mimeType: file.mimeType || file.contentType || mimeType,
        };
      }
    }
    for (var k in file) {
      if (!Object.prototype.hasOwnProperty.call(file, k)) continue;
      if (keys.indexOf(k) !== -1) continue;
      var v = file[k];
      if (v && looksLikeBase64String(v)) {
        return {
          base64: cleanBase64Payload(v),
          fileName:
            file.fileName ||
            file.name ||
            file.filename ||
            fileName,
          mimeType: file.mimeType || file.contentType || mimeType,
        };
      }
    }
  }

  if (res.data && res.data !== res) {
    return extractDecryptedFileBase64(res.data, fallbackName);
  }

  return null;
}

function guessDecryptedFileName(name, mimeType) {
  var n = String(name || "decrypted.bin");
  if (/\.secure[a-z0-9]+$/i.test(n)) {
    n = n.replace(/\.secure[a-z0-9]+$/i, "");
  }
  if (/\.[a-z0-9]+$/i.test(n)) return n;
  var mime = String(mimeType || "").toLowerCase();
  if (mime === "application/pdf" || mime.indexOf("pdf") !== -1) return n + ".pdf";
  if (mime.indexOf("image/png") === 0) return n + ".png";
  if (mime.indexOf("image/jpeg") === 0) return n + ".jpg";
  if (mime.indexOf("image/gif") === 0) return n + ".gif";
  if (mime.indexOf("image/webp") === 0) return n + ".webp";
  if (mime.indexOf("image/") === 0) return n + ".img";
  if (mime.indexOf("text/") === 0) return n + ".txt";
  return n + ".bin";
}

function guessPdfFileName(name) {
  return guessDecryptedFileName(name, "application/pdf");
}

function guessMimeType(fileName) {
  var name = String(fileName || "").toLowerCase();
  if (name.indexOf(".pdf") !== -1) return "application/pdf";
  if (name.indexOf(".png") !== -1) return "image/png";
  if (name.indexOf(".jpg") !== -1 || name.indexOf(".jpeg") !== -1)
    return "image/jpeg";
  return "application/octet-stream";
}

/**
 * Extract SecureDoc message cipher (sds....) from body text, ignoring promo footer.
 * Stops before glued promo like "...==Check below site..."
 */
function extractMessageCipher(bodyText) {
  if (!bodyText) return null;
  var text = String(bodyText).replace(/\r\n/g, "\n");

  var sdsMatch = text.match(
    /sds\.[A-Za-z0-9+/_-]*={0,2}(?=Check\s+below|Learn\s+more|[\s\r\n]|$)/i
  );
  if (sdsMatch && sdsMatch[0]) return sdsMatch[0];

  // Fallback: sds. token up to whitespace
  sdsMatch = text.match(/sds\.[A-Za-z0-9+/=_-]+/);
  if (sdsMatch && sdsMatch[0]) {
    var token = sdsMatch[0];
    var cut = token.search(/Check|Learn/i);
    if (cut > 0) token = token.slice(0, cut);
    return token;
  }

  return null;
}

/**
 * Remove SecureDoc promo / learn-more text from a quoted body.
 */
function stripSecureDocPromo(text) {
  return String(text || "")
    .replace(/Check below site to decrypt this mail[\s\S]*?(?=(\nFrom:|\nSent:|\n-----|$))/gi, "")
    .replace(/Check below site to decrypt this mail[\s\S]*$/gi, "")
    .replace(/Learn more:\s*https?:\/\/\S+/gi, "")
    .replace(/https:\/\/www\.securedocshare\.example\.com/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Replace cipher (+ glued promo) with decrypted plaintext, keep Outlook quote headers.
 */
function replaceCipherWithPlain(bodyText, cipher, plainMessage) {
  var text = String(bodyText || "");
  if (!cipher) return text;

  var escaped = cipher.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  var glued = new RegExp(
    escaped +
      "(?:\\s*)?(?:Check below site to decrypt this mail)?(?:\\s*)?(?:Learn more:\\s*)?(?:https?:\\/\\/\\S+)?",
    "i"
  );
  if (glued.test(text)) {
    return text.replace(glued, plainMessage);
  }
  return text.split(cipher).join(plainMessage);
}

/**
 * Outlook Text body often glues reply + headers with no newlines, e.g.
 *   "aaaaaFrom: Patel AshikSent: Wednesday...To: xSubject: rrr"
 * Also glues body onto Subject: "Subject: New testThis Is message"
 * Insert newlines so From/Sent/To/Subject and body split cleanly.
 */
function normalizeOutlookReplyText(bodyText) {
  var text = String(bodyText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\u200b/g, "");

  // Labels glued to previous text / each other
  text = text.replace(/([^\n])(?=From:\s)/gi, "$1\n");
  text = text.replace(/([^\n])(?=Sent:\s)/gi, "$1\n");
  text = text.replace(/([^\n])(?=To:\s)/gi, "$1\n");
  text = text.replace(/([^\n])(?=Cc:\s)/gi, "$1\n");
  text = text.replace(/([^\n])(?=Subject:\s)/gi, "$1\n");
  text = text.replace(/([^\n])(?=-----Original Message-----)/gi, "$1\n");
  // Only break before a NEW underscore-run (not between underscores inside it)
  text = text.replace(/([^\n_])(?=_{10,})/g, "$1\n");
  text = text.replace(/([^\n])(?=sds\.)/gi, "$1\n");
  text = text.replace(/([^\n])(?=Check below site to decrypt)/gi, "$1\n");

  // Header labels stuck together: Sent:Wed → Sent: Wed (keep value on same line)
  text = text.replace(
    /(From|Sent|To|Cc|Subject):\s*(?=\S)/gi,
    function (m) {
      return m.replace(/:\s*/, ": ");
    }
  );

  // Body glued to Subject value: "Subject: New testThis is…" → split at camelCase glue
  text = text.replace(/^(Subject:\s*)(.+)$/gim, function (_m, prefix, rest) {
    var glue = rest.search(/[a-z0-9]([A-Z][a-zA-Z])/);
    if (glue > 0) {
      return prefix + rest.slice(0, glue + 1) + "\n\n" + rest.slice(glue + 1);
    }
    // ALL-CAPS body glued to subject: "Re: TESTSECOND MESSAGE" / "TESTFIRST MESSAGE"
    var ord = rest.match(
      /^(.*?)((?:FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH)\b[\s\S]*)$/i
    );
    if (ord && ord[1] && String(ord[1]).trim() && ord[2]) {
      return prefix + String(ord[1]).replace(/\s+$/, "") + "\n\n" + ord[2];
    }
    return prefix + rest;
  });

  // Ensure blank line after Subject header before body when next line is not a header
  text = text.replace(
    /(^Subject:\s*[^\n]+)\n(?!\n)(?!(?:From|Sent|To|Cc|Subject):)/gim,
    "$1\n\n"
  );

  // Collapse stacked underscore separators into one blank-line-bounded separator
  // Important: do NOT use \s here — it matches newlines and shreds the separator.
  text = text.replace(
    /\n[_\t ]{10,}\n(?:[_\t ]{10,}\n)*/g,
    "\n\n________________________________________________________________\n\n"
  );
  text = text.replace(/^[_\t ]{10,}\n+/gm, "________________________________________________________________\n\n");

  // Outlook inserts ____ between quote Subject and the previous message body.
  // Remove that so body stays bundled under its Subject (one message block).
  text = text.replace(
    /(^Subject:\s*[^\n]+)\n+[_\t ]{10,}\n+/gim,
    "$1\n\n"
  );

  // Forward/reply history: nested "From:" blocks often have no ____ between them.
  // Insert one separator before each new From: that follows message body text.
  text = text.replace(
    /(\n(?!(?:From|Sent|To|Cc|Subject):)[^\n]+)\n+(?=From:\s)/gi,
    "$1\n\n________________________________________________________________\n\n"
  );

  // Also split on Outlook "Original Message" markers
  text = text.replace(
    /\n+-+\s*Original Message\s*-+\n+/gi,
    "\n\n________________________________________________________________\n\n"
  );

  // Tidy excessive blank lines
  text = text.replace(/\n{3,}/g, "\n\n");

  return text;
}

/**
 * True if segment starts with Outlook quote headers (From/Sent/To/Subject).
 */
function segmentStartsWithOutlookHeaders(seg) {
  return /^(From|Sent|To|Cc|Subject):\s*/im.test(String(seg || "").trim());
}

/**
 * Merge header-only blocks with the following body block.
 * Fixes: [headers][____][body] → [headers + body] so body sits under Subject.
 */
function mergeThreadSegments(segments) {
  var merged = [];
  var i;
  for (i = 0; i < segments.length; i++) {
    var seg = String(segments[i] || "").trim();
    if (!seg) continue;

    if (segmentStartsWithOutlookHeaders(seg)) {
      var next = String(segments[i + 1] || "").trim();
      // Next part is message body (not another header block) → bundle under Subject
      if (next && !segmentStartsWithOutlookHeaders(next)) {
        merged.push(seg + "\n\n" + next);
        i++;
        continue;
      }
    }
    merged.push(seg);
  }
  return merged;
}

/**
 * Split one segment that still contains nested From: blocks (common on Forward).
 * Returns array of message blocks (newest intro body and/or header+body pairs).
 */
function splitNestedFromBlocks(segment) {
  var text = String(segment || "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  var lines = text.split("\n");
  var blocks = [];
  var current = [];
  var i;
  var sawHeaders = false;
  var sawBody = false;

  function flush() {
    var block = current.join("\n").trim();
    if (block) blocks.push(block);
    current = [];
    sawHeaders = false;
    sawBody = false;
  }

  for (i = 0; i < lines.length; i++) {
    var raw = lines[i];
    var t = String(raw || "").trim();

    if (/^_{10,}$/.test(t) || /^-+Original Message-+$/i.test(t)) {
      flush();
      continue;
    }

    // New Outlook message header starts a new block (forward history)
    if (
      /^From:\s*/i.test(t) &&
      current.length > 0 &&
      (sawHeaders || sawBody)
    ) {
      flush();
    }

    if (/^(From|Sent|To|Cc|Subject):\s*/i.test(t)) {
      sawHeaders = true;
    } else if (t) {
      sawBody = true;
    }

    current.push(raw);
  }
  flush();
  return blocks;
}

/**
 * Format decrypted / combined thread plaintext as Outlook-like HTML.
 * Same layout for Reply and Forward: one HR between messages; body under Subject.
 */
function formatSecureDocThreadHtml(plainMessage) {
  var text =
    typeof normalizeOutlookReplyText === "function"
      ? normalizeOutlookReplyText(plainMessage || "")
      : String(plainMessage || "").replace(/\r\n/g, "\n");

  if (typeof stripSecureDocPromo === "function") {
    text = stripSecureDocPromo(text);
  }
  text = String(text || "").trim();
  if (!text) return "";

  var rawSegments = text.split(/\n_{10,}\n|\n_{10,}$|^_{10,}\n/);
  var merged = mergeThreadSegments(rawSegments);

  // Forward: expand any segment that still has nested From: history
  var segments = [];
  var m;
  for (m = 0; m < merged.length; m++) {
    var parts = splitNestedFromBlocks(merged[m]);
    if (!parts.length) continue;
    segments = segments.concat(parts);
  }

  var htmlParts = [];
  var rendered = 0;
  var s;

  for (s = 0; s < segments.length; s++) {
    var seg = String(segments[s] || "").trim();
    if (!seg) continue;

    if (rendered > 0) {
      htmlParts.push(
        '<hr style="display:inline-block;width:98%;border:none;border-top:1px solid #B5B5B5;margin:12px 0;"/>'
      );
    }

    htmlParts.push(formatOutlookThreadSegmentHtml(seg));
    rendered++;
  }

  return (
    '<div style="font-family:Calibri,sans-serif;font-size:11pt;color:#000;">' +
    htmlParts.join("") +
    "</div>"
  );
}

/**
 * One thread segment: optional From/Sent/To/Subject headers + body.
 */
function formatOutlookThreadSegmentHtml(segment) {
  var text = String(segment || "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";

  var lines = text.split("\n");
  var from = "";
  var sent = "";
  var to = "";
  var subject = "";
  var i = 0;
  var bodyLines = [];

  while (i < lines.length && !String(lines[i]).trim()) i++;

  for (; i < lines.length; i++) {
    var t = String(lines[i] || "").trim();
    if (!from && /^From:\s*/i.test(t)) {
      from = t.replace(/^From:\s*/i, "").trim();
      continue;
    }
    if (!sent && /^Sent:\s*/i.test(t)) {
      sent = t.replace(/^Sent:\s*/i, "").trim();
      continue;
    }
    if (!to && /^To:\s*/i.test(t)) {
      to = t.replace(/^To:\s*/i, "").trim();
      continue;
    }
    if (!subject && /^Subject:\s*/i.test(t)) {
      subject = t.replace(/^Subject:\s*/i, "").trim();
      // Body may still be glued on same subject line (camelCase or ALL-CAPS)
      var glue = subject.search(/[a-z0-9]([A-Z][a-zA-Z])/);
      if (glue > 0) {
        bodyLines.push(subject.slice(glue + 1));
        subject = subject.slice(0, glue + 1);
      } else {
        var ord = subject.match(
          /^(.*?)((?:FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH)\b[\s\S]*)$/i
        );
        if (ord && ord[1] && String(ord[1]).trim() && ord[2]) {
          subject = String(ord[1]).replace(/\s+$/, "");
          bodyLines.push(ord[2]);
        }
      }
      continue;
    }
    if (/^_{10,}$/.test(t)) continue;
    bodyLines = bodyLines.concat(lines.slice(i));
    break;
  }

  if (!from && !sent && !to && !subject) {
    bodyLines = lines;
  }

  var escape =
    typeof escapeHtml === "function"
      ? escapeHtml
      : function (s) {
          return String(s || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
        };

  var bodyText = bodyLines.join("\n").replace(/^\s+/, "").replace(/\s+$/, "");
  if (typeof stripSecureDocPromo === "function") {
    bodyText = stripSecureDocPromo(bodyText);
  }
  // Drop leftover cipher tokens from display
  if (typeof extractMessageCipher === "function") {
    var c = extractMessageCipher(bodyText);
    if (c) bodyText = bodyText.split(c).join("").trim();
  }

  var out = "";
  if (from || sent || to || subject) {
    out += '<div dir="ltr" style="margin:8px 0 4px 0;">';
    if (from) out += "<div><b>From:</b> " + escape(from) + "</div>";
    if (sent) out += "<div><b>Sent:</b> " + escape(sent) + "</div>";
    if (to) out += "<div><b>To:</b> " + escape(to) + "</div>";
    if (subject) out += "<div><b>Subject:</b> " + escape(subject) + "</div>";
    out += "</div>";
  }

  if (bodyText) {
    out +=
      '<div style="white-space:pre-wrap;margin:6px 0 10px 0;">' +
      escape(bodyText).replace(/\n/g, "<br/>") +
      "</div>";
  }

  return out;
}

/**
 * Split reply/forward compose body into:
 *   newPart  = only what the user typed now (to ENCRYPT)
 *   quotedPart = Outlook previous message block (to DECRYPT / keep clear)
 */
function splitReplyForwardBody(bodyText, subject) {
  var text = normalizeOutlookReplyText(bodyText);
  var replySubject = isReplyOrForwardSubject(subject);

  // Outlook native quote header block (most reliable)
  var headerPatterns = [
    /(?:^|\n)From:\s*[^\n]+\nSent:\s*/i,
    /(?:^|\n)From:\s*[^\n]+\nTo:\s*/i,
    /(?:^|\n)From:\s*[^\n]+\nSubject:\s*/i,
    /(?:^|\n)-----Original Message-----\s*(?:\n|$)/i,
    /(?:^|\n)_{10,}\s*\nFrom:\s*/i,
    /(?:^|\n)-+\s*Original Message\s*-+\s*(?:\n|$)/i,
    /(?:^|\n)On .{8,120} wrote:\s*(?:\n|$)/i,
  ];

  var cutAt = -1;
  for (var i = 0; i < headerPatterns.length; i++) {
    var m = text.search(headerPatterns[i]);
    if (m !== -1 && (cutAt === -1 || m < cutAt)) cutAt = m;
  }

  // Single From: line (after normalize, always on its own line when present)
  if (cutAt === -1) {
    var fromOnly = text.search(/(?:^|\n)From:\s+\S/i);
    if (fromOnly !== -1) cutAt = fromOnly;
  }

  // Quoted previous encrypted body (no headers detected)
  var sdsAt = text.search(/sds\.[A-Za-z0-9+/_-]/);
  if (cutAt === -1 && sdsAt > 0) {
    cutAt = sdsAt;
  }
  if (cutAt === -1 && sdsAt === 0 && replySubject) {
    return {
      newPart: "",
      quotedPart: text.trim(),
      isReplyOrForward: true,
    };
  }

  // Promo line often starts the quoted encrypted block
  var promoAt = text.search(/(?:^|\n)Check below site to decrypt/i);
  if (cutAt === -1 && promoAt > 0) cutAt = promoAt;

  if (cutAt === -1) {
    return {
      newPart: text.trim(),
      quotedPart: "",
      isReplyOrForward: replySubject,
    };
  }

  // cutAt may point at leading \n — keep quote starting at content
  var quoteStart = cutAt;
  if (text.charAt(quoteStart) === "\n") quoteStart += 1;

  return {
    newPart: text.slice(0, cutAt).trim(),
    quotedPart: text.slice(quoteStart).trim(),
    isReplyOrForward: true,
  };
}

function isReplyOrForwardSubject(subject) {
  return /^\s*(re|fw|fwd)\s*:/i.test(String(subject || ""));
}

/**
 * Previous message was encrypted for the original To: recipient.
 * Prefer that email when decrypting a quoted cipher (important when
 * the sender replies from Sent items).
 */
function getQuoteDecryptEmail(quotedPart, fallbackEmail) {
  var text = normalizeOutlookReplyText(quotedPart || "");
  var toMatch = text.match(/(?:^|\n)To:\s*(.+)/i);
  if (toMatch && toMatch[1]) {
    var toLine = toMatch[1].trim();
    var angle = toLine.match(/<([^>]+)>/);
    if (angle && angle[1]) return angle[1].trim().toLowerCase();
    var em = toLine.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (em) return em[0].toLowerCase();
  }
  return (fallbackEmail || "").toLowerCase();
}

/**
 * Collect candidate emails for decrypting a quoted cipher.
 */
function collectQuoteDecryptEmails(quotedPart, currentUserEmail, extraEmails) {
  var emails = [];
  function add(e) {
    e = String(e || "")
      .toLowerCase()
      .trim();
    if (!e || emails.indexOf(e) !== -1) return;
    emails.push(e);
  }

  add(currentUserEmail);
  add(getQuoteDecryptEmail(quotedPart, ""));

  var text = normalizeOutlookReplyText(quotedPart || "");
  var found = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  for (var i = 0; i < found.length; i++) add(found[i]);

  if (extraEmails && extraEmails.length) {
    for (var j = 0; j < extraEmails.length; j++) add(extraEmails[j]);
  }
  return emails;
}

/**
 * Try decrypt with current user, quote To:, and any extra candidates.
 */
function decryptQuotedCipher(
  cipher,
  currentUserEmail,
  quotedPart,
  apiBase,
  extraEmails
) {
  var emails = collectQuoteDecryptEmails(
    quotedPart,
    currentUserEmail,
    extraEmails
  );

  function attempt(index, last) {
    if (index >= emails.length) {
      return Promise.resolve(
        last || { dec: { ok: false, error: "No decrypt email" }, email: "" }
      );
    }
    var email = emails[index];
    console.log("Quote decrypt attempt", { index: index, email: email });
    return decryptOnly({
      apiBaseUrl: apiBase,
      email: email,
      messageCipherText: cipher,
    }).then(function (dec) {
      var out = { dec: dec, email: email };
      if (dec && dec.ok && dec.message) return out;
      return attempt(index + 1, out);
    });
  }

  return attempt(0, null);
}

/**
 * Decrypt message and/or file cipher text for recipient.
 * POST /public/decrypt
 */
function decryptOnly(options) {
  options = options || {};
  var baseUrl = normalizeBaseUrl(options.apiBaseUrl);
  var recipient =
    options.email || options.to || options.receiverEmail || null;

  if (!recipient) {
    return Promise.resolve(
      failure(400, {
        error: "Recipient email is required",
        code: "EMAIL_REQUIRED",
      })
    );
  }

  var msgCipher =
    options.messageCipherText ||
    options.packageText ||
    options.encryptedMessage ||
    null;
  var fileCipher =
    options.fileCipherText ||
    options.packageBase64 ||
    options.encryptedFile ||
    options.encryptedPdf ||
    null;

  if (!msgCipher && !fileCipher) {
    return Promise.resolve(
      failure(400, {
        error: "Provide messageCipherText and/or fileCipherText",
        code: "CIPHERTEXT_REQUIRED",
      })
    );
  }

  var body = { email: recipient };
  if (msgCipher) body.messageCipherText = msgCipher;
  if (fileCipher) body.fileCipherText = fileCipher;

  return apiRequest(baseUrl, "/public/decrypt", {
    method: "POST",
    body: body,
  }).then(function (out) {
    var res = out.res;
    var data = out.data || {};

    if (!res.ok || data.ok === false) {
      return failure(
        res.status || 500,
        data,
        data.error || "Decrypt failed"
      );
    }

    return success(res.status, {
      decrypted: true,
      recipientUuid: data.recipientUuid || null,
      recipientEmail: data.recipientEmail || null,
      recipientClaimed: Boolean(data.recipientClaimed),
      messageDecrypted: Boolean(data.messageDecrypted),
      fileDecrypted: Boolean(data.fileDecrypted),
      message: data.message || null,
      file: data.file || data.attachment || null,
      kind: data.kind || null,
      filename: data.filename || data.fileName || null,
      decryptedBase64:
        data.decryptedBase64 ||
        data.fileBase64 ||
        data.decryptedFileBase64 ||
        null,
      mimeType: data.mimeType || null,
    });
  });
}

(function exposeSecureDocApi(g) {
  if (!g) return;
  g.SecureDocConfig = typeof SecureDocConfig !== "undefined" ? SecureDocConfig : g.SecureDocConfig;
  g.DEFAULT_API_BASE =
    (typeof SecureDocConfig !== "undefined" && SecureDocConfig.getApiBaseUrl()) ||
    DEFAULT_API_BASE;
  g.LOGIN_WEB_URL =
    (typeof SecureDocConfig !== "undefined" && SecureDocConfig.getLoginWebUrl()) ||
    LOGIN_WEB_URL;
  g.ADDIN_HTTPS_ORIGIN =
    (typeof SecureDocConfig !== "undefined" &&
      SecureDocConfig.getAddinHttpsOrigin()) ||
    ADDIN_HTTPS_ORIGIN;
  g.getLoginWebUrl = getLoginWebUrl;
  g.getClickableLoginUrl = getClickableLoginUrl;
  g.getAddinHttpsOrigin = getAddinHttpsOrigin;
  g.getTaskpaneCommandId = getTaskpaneCommandId;
  g.loginRequiredMessage = loginRequiredMessage;
  g.loginRequiredCompleted = loginRequiredCompleted;
  g.decryptLoginRequiredCompleted = decryptLoginRequiredCompleted;
  g.getStoredSession = getStoredSession;
  g.saveSession = saveSession;
  g.clearSession = clearSession;
  g.logoutSession = logoutSession;
  g.ensureAuthSession = ensureAuthSession;
  g.assertLoginMatchesMailbox = assertLoginMatchesMailbox;
  g.normalizeEmailAddress = normalizeEmailAddress;
  g.loginWithPassword = loginWithPassword;
  g.signupWithPassword = signupWithPassword;
  g.sendSignupOtp = sendSignupOtp;
  g.loginWithOAuth = loginWithOAuth;
  g.fetchOAuthProviders = fetchOAuthProviders;
  g.getSenderEmail = getSenderEmail;
  g.checkSenderSubscription = checkSenderSubscription;
  g.checkSubscription = checkSubscription;
  g.encryptOnly = encryptOnly;
  g.decryptOnly = decryptOnly;
  g.guessMimeType = guessMimeType;
  g.extractMessageCipher = extractMessageCipher;
  g.splitReplyForwardBody = splitReplyForwardBody;
  g.normalizeOutlookReplyText = normalizeOutlookReplyText;
  g.formatSecureDocThreadHtml = formatSecureDocThreadHtml;
  g.formatOutlookThreadSegmentHtml = formatOutlookThreadSegmentHtml;
  g.mergeThreadSegments = mergeThreadSegments;
  g.splitNestedFromBlocks = splitNestedFromBlocks;
  g.isReplyOrForwardSubject = isReplyOrForwardSubject;
  g.stripSecureDocPromo = stripSecureDocPromo;
  g.replaceCipherWithPlain = replaceCipherWithPlain;
  g.getQuoteDecryptEmail = getQuoteDecryptEmail;
  g.decryptQuotedCipher = decryptQuotedCipher;
  g.extractDecryptedFileBase64 = extractDecryptedFileBase64;
  g.guessPdfFileName = guessPdfFileName;
})(typeof globalThis !== "undefined" ? globalThis : window);
