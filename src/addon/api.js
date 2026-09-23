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

