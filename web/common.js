const DEFAULT_API_BASE =
  typeof SecureDocConfig !== "undefined" && SecureDocConfig.getApiBaseUrl
    ? SecureDocConfig.getApiBaseUrl()
    : "";
const LOGIN_WEB_URL =
  typeof SecureDocConfig !== "undefined" && SecureDocConfig.getLoginWebUrl
    ? SecureDocConfig.getLoginWebUrl()
    : "";
const SESSION_STORAGE_KEY =
  typeof SecureDocConfig !== "undefined" &&
  SecureDocConfig.getSessionStorageKey
    ? SecureDocConfig.getSessionStorageKey()
    : "securedoc_workspace_session";

function normalizeBaseUrl(url) {
  let raw = String(
    url ||
      (typeof SecureDocConfig !== "undefined" &&
        SecureDocConfig.getApiBaseUrl &&
        SecureDocConfig.getApiBaseUrl()) ||
      DEFAULT_API_BASE
  ).replace(/\/$/, "");

  if (
    typeof SecureDocConfig !== "undefined" &&
    typeof SecureDocConfig.ensureApiBase === "function"
  ) {
    return SecureDocConfig.ensureApiBase(raw);
  }

  if (!raw) {
    return typeof SecureDocConfig !== "undefined" && SecureDocConfig.ENV
      ? SecureDocConfig.ensureApiBase(SecureDocConfig.ENV.API_BASE_URL)
      : "";
  }
  if (/\/api$/i.test(raw)) return raw;
  return raw + "/api";
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
  const out = {
    ok: true,
    status: status,
    error: null,
    code: null,
    data: data,
  };
  for (const key in data) {
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

function resolveApiUrl(baseUrl, path) {
  let base = normalizeBaseUrl(baseUrl);
  let p = String(path || "");
  if (p.charAt(0) !== "/") p = "/" + p;
  if (!/\/api$/i.test(base)) {
    base = String(base || "").replace(/\/$/, "") + "/api";
  }
  return base + p;
}

function apiRequest(baseUrl, path, options) {
  options = options || {};
  const headers = { Accept: "application/json" };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.token) {
    headers.Authorization = "Bearer " + options.token;
  }

  return fetch(resolveApiUrl(baseUrl, path), {
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

;
function getLoginWebUrl() {
  if (typeof SecureDocConfig !== "undefined" && SecureDocConfig.getLoginWebUrl) {
    return SecureDocConfig.getLoginWebUrl();
  }
  return LOGIN_WEB_URL;
}

function loginRequiredMessage(extra) {
  let base = "Login required. Sign in with SecureDocShare, then try again.";
  if (extra) base = String(extra) + " " + base;
  return base;
}

function readSessionFromLocal() {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function getStoredSession() {
  return readSessionFromLocal();
}

function saveSession(session) {
  const data = {
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
  return data;
}

function clearSession() {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch (e) {}
}

function logoutSession(options) {
  options = options || {};
  const baseUrl = normalizeBaseUrl(options.apiBaseUrl);
  const session = getStoredSession();
  const token = session && session.token ? session.token : null;

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
      const local = finishLocal();
      if (!out.res.ok) {
        return success(200, {
          loggedOut: true,
          serverCleared: false,
          warning: (out.data && out.data.error) || "Server logout failed",
        });
      }
      return local;
    })
    .catch(function (err) {
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
  const exp = new Date(session.expiresAt).getTime();
  if (!exp || isNaN(exp)) return false;
  return exp <= Date.now() + 30 * 1000;
}

function ensureAuthSession(options) {
  options = options || {};
  const baseUrl = normalizeBaseUrl(options.apiBaseUrl);
  const session = getStoredSession();

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
      const res = out.res;
      const data = out.data || {};
      const status = res.status || 0;

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

      const resolvedEmail = String(data.email || session.email || "")
        .trim()
        .toLowerCase();
      if (
        resolvedEmail &&
        resolvedEmail !== String(session.email || "").toLowerCase()
      ) {
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

function storeAuthResponse(data, email) {
  const token = data.token || data.accessToken || null;
  if (!token) {
    return failure(500, {
      error: "Succeeded but no token was returned",
      code: "TOKEN_MISSING",
    });
  }
  const saved = saveSession({
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

function loginWithPassword(options) {
  options = options || {};
  const baseUrl = normalizeBaseUrl(options.apiBaseUrl);
  const email = String(options.email || "").trim().toLowerCase();
  const password = String(options.password || "");

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
    const res = out.res;
    const data = out.data || {};
    if (!res.ok) {
      return failure(res.status || 401, data, data.error || "Login failed");
    }
    return storeAuthResponse(data, email);
  });
}

function sendSignupOtp(options) {
  options = options || {};
  const baseUrl = normalizeBaseUrl(options.apiBaseUrl);
  const email = String(options.email || "").trim().toLowerCase();
  const acceptTerms = options.acceptTerms === true;

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
    const res = out.res;
    const data = out.data || {};
    if (!res.ok) {
      return failure(res.status || 400, data, data.error || "Could not send code");
    }
    return success(200, {
      sent: true,
      email: email,
      devOtp: data.devOtp || null,
    });
  });
}

function signupWithPassword(options) {
  options = options || {};
  const baseUrl = normalizeBaseUrl(options.apiBaseUrl);
  const email = String(options.email || "").trim().toLowerCase();
  const password = String(options.password || "");
  const otp = String(options.otp || "").trim();
  const acceptTerms = options.acceptTerms === true;

  if (!email || !password) {
    return Promise.resolve(
      failure(400, {
        error: "Email and password are required",
        code: "CREDENTIALS_REQUIRED",
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
        code: "OTP_REQUIRED",
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
    const res = out.res;
    const data = out.data || {};
    if (!res.ok) {
      return failure(res.status || 400, data, data.error || "Signup failed");
    }
    return storeAuthResponse(data, email);
  });
}

function loginWithOAuth(options) {
  options = options || {};
  return loginWithOAuthPopup_({
    provider: String(options.provider || "").toLowerCase(),
    intent: options.intent === "signup" ? "signup" : "login",
    acceptTerms: options.acceptTerms === true,
    apiBaseUrl: normalizeBaseUrl(options.apiBaseUrl),
  });
}

function loginWithOAuthPopup_(options) {
  const provider = options.provider;
  const intent = options.intent;
  const acceptTerms = options.acceptTerms;
  const baseUrl = options.apiBaseUrl;

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

  let returnOrigin = "https://server-nine-rosy.vercel.app";
  const returnPath = "/api/auth/oauth/popup-done";
  const appOrigin = String(baseUrl || "")
    .replace(/\/api\/?$/i, "")
    .replace(/\/$/, "");
  try {
    if (
      typeof SecureDocConfig !== "undefined" &&
      SecureDocConfig.ENV &&
      SecureDocConfig.ENV.OAUTH_POPUP_DONE_ORIGIN
    ) {
      returnOrigin = String(SecureDocConfig.ENV.OAUTH_POPUP_DONE_ORIGIN).replace(
        /\/$/,
        ""
      );
    } else if (appOrigin) {
      if (
        appOrigin.indexOf("script.google.com") < 0 &&
        appOrigin.indexOf("googleusercontent.com") < 0
      ) {
        returnOrigin = appOrigin;
      }
    }
  } catch (eOrigin) {}

  // Workspace Google login/signup shares /auth/google/callback with Gmail connect.
  // Microsoft/Yahoo keep the Outlook hub at /api/auth/oauth/:provider/start.
  let start;
  if (provider === "google") {
    start =
      (appOrigin || returnOrigin) +
      "/auth/google/start?returnOrigin=" +
      encodeURIComponent(returnOrigin) +
      "&returnPath=" +
      encodeURIComponent(returnPath) +
      "&intent=" +
      encodeURIComponent(intent);
  } else {
    start =
      baseUrl +
      "/auth/oauth/" +
      encodeURIComponent(provider) +
      "/start?returnOrigin=" +
      encodeURIComponent(returnOrigin) +
      "&returnPath=" +
      encodeURIComponent(returnPath) +
      "&intent=" +
      encodeURIComponent(intent);
  }
  if (intent === "signup") {
    start += "&acceptTerms=" + (acceptTerms ? "1" : "0");
  }

  return new Promise(function (resolve) {
    let settled = false;
    let popup = null;
    let timer = null;

    function settle(result) {
      if (settled) return;
      settled = true;
      try {
        if (timer) clearInterval(timer);
      } catch (e0) {}
      try {
        window.removeEventListener("message", onMessage);
      } catch (e) {}
      try {
        if (popup && !popup.closed) popup.close();
      } catch (e2) {}
      resolve(result);
    }

    function onMessage(ev) {
      const data = ev && ev.data;
      if (!data || data.type !== "securedoc-oauth") return;
      if (data.ok && data.token) {
        const saved = storeAuthResponse(
          {
            token: data.token,
            expiresAt: data.expiresAt,
            email: data.email,
            refreshToken: data.refreshToken,
          },
          data.email || ""
        );
        try {
          if (
            typeof google !== "undefined" &&
            google.script &&
            google.script.run &&
            typeof google.script.run.saveWorkspaceSession === "function"
          ) {
            google.script.run.saveWorkspaceSession({
              token: data.token,
              email: data.email || "",
              expiresAt: data.expiresAt || null,
            });
          }
        } catch (e3) {}
        settle(saved);
        return;
      }
      if (data.ok) {
        refreshAuthFromServerAfterOAuth_(baseUrl).then(settle);
        return;
      }
      settle(
        failure(401, {
          error: data.error || "Sign-in failed",
          code: data.code || "OAUTH_FAILED",
        })
      );
    }

    window.addEventListener("message", onMessage);
    popup = window.open(start, "securedoc_oauth", "width=520,height=680");
    if (!popup) {
      settle(
        failure(500, {
          error: "Popup blocked. Allow popups for this site and try again.",
          code: "OAUTH_POPUP_BLOCKED",
        })
      );
      return;
    }
    try {
      popup.focus();
    } catch (e3) {}

    let ticks = 0;
    timer = setInterval(function () {
      ticks += 1;
      try {
        if (popup.closed) {
          clearInterval(timer);
          const session =
            typeof getStoredSession === "function" ? getStoredSession() : null;
          if (session && session.token) {
            settle(
              success(200, {
                authenticated: true,
                token: session.token,
                email: session.email,
                expiresAt: session.expiresAt,
              })
            );
          } else {
            settle(
              failure(499, {
                error: "Sign-in window closed",
                code: "OAUTH_CANCELLED",
              })
            );
          }
        }
      } catch (e) {}
      if (ticks > 180) {
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

function refreshAuthFromServerAfterOAuth_(baseUrl) {
  return ensureAuthSession({ apiBaseUrl: baseUrl }).then(function (auth) {
    if (auth && auth.ok && auth.authenticated) {
      return success(200, {
        authenticated: true,
        token: auth.token,
        email: auth.email,
        expiresAt: auth.expiresAt,
      });
    }
    return failure(401, {
      error:
        "Google sign-in finished. Close this panel and reopen SecureDoc, or refresh.",
      code: "OAUTH_SESSION_PENDING",
    });
  });
}

function fetchOAuthProviders(options) {
  options = options || {};
  const baseUrl = normalizeBaseUrl(options.apiBaseUrl);
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

function completeOAuthTicket(options) {
  options = options || {};
  const baseUrl = normalizeBaseUrl(options.apiBaseUrl);
  const ticket = String(options.ticket || options.oauth_ticket || "").trim();
  if (!ticket) {
    return Promise.resolve(
      failure(400, {
        error: "Missing OAuth ticket",
        code: "OAUTH_TICKET_MISSING",
      })
    );
  }
  return apiRequest(baseUrl, "/auth/oauth/complete", {
    method: "POST",
    body: { ticket: ticket },
  }).then(function (out) {
    if (!out.res.ok) {
      return failure(out.res.status, out.data, "OAuth complete failed");
    }
    const data = out.data || {};
    const token = data.token || data.accessToken;
    if (!token) {
      return failure(401, { error: "No token from Google sign-in" });
    }
    return success(200, {
      token: token,
      email: data.email || "",
      expiresAt: data.expiresAt || null,
      refreshToken: data.refreshToken || null,
    });
  });
}

function checkSenderSubscription(options) {
  options = options || {};
  const baseUrl = normalizeBaseUrl(options.apiBaseUrl);
  const email = options.email || "";

  if (!email) {
    return Promise.resolve(
      failure(400, {
        error: "Email is required",
        code: "EMAIL_REQUIRED",
      })
    );
  }

  const qs = "?email=" + encodeURIComponent(String(email).trim().toLowerCase());

  return apiRequest(baseUrl, "/public/subscription-check" + qs, {}).then(
    function (out) {
      const res = out.res;
      const data = out.data || {};

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
          data.error || "Failed to check subscription"
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
    }
  );
}

;
/**
 * SecureDoc Workspace — Encrypt / decrypt client (slim; no Outlook thread helpers).
 * Concatenated into Common.html by the Apps Script HTML build.
 */

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
 * Pull decrypted file bytes from any SecureDoc decrypt response shape.
 */
function extractDecryptedFileBase64(res, fallbackName) {
  if (!res) return null;

  var fileName =
    res.filename || res.fileName || fallbackName || "decrypted.bin";
  var mimeType = res.mimeType || "application/octet-stream";

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

;
(function exposeSecureDocApi(g) {
  if (!g) return;
  g.SecureDocConfig =
    typeof SecureDocConfig !== "undefined" ? SecureDocConfig : g.SecureDocConfig;
  g.DEFAULT_API_BASE =
    (typeof SecureDocConfig !== "undefined" && SecureDocConfig.getApiBaseUrl()) ||
    DEFAULT_API_BASE;
  g.LOGIN_WEB_URL =
    (typeof SecureDocConfig !== "undefined" && SecureDocConfig.getLoginWebUrl()) ||
    LOGIN_WEB_URL;
  g.getLoginWebUrl = getLoginWebUrl;
  g.loginRequiredMessage = loginRequiredMessage;
  g.getStoredSession = getStoredSession;
  g.saveSession = saveSession;
  g.clearSession = clearSession;
  g.logoutSession = logoutSession;
  g.ensureAuthSession = ensureAuthSession;
  g.normalizeEmailAddress = normalizeEmailAddress;
  g.loginWithPassword = loginWithPassword;
  g.signupWithPassword = signupWithPassword;
  g.sendSignupOtp = sendSignupOtp;
  g.loginWithOAuth = loginWithOAuth;
  g.fetchOAuthProviders = fetchOAuthProviders;
  g.completeOAuthTicket = completeOAuthTicket;
  g.checkSenderSubscription = checkSenderSubscription;
  g.decryptOnly = decryptOnly;
  g.extractDecryptedFileBase64 = extractDecryptedFileBase64;
  g.guessDecryptedFileName = guessDecryptedFileName;
  g.normalizeBaseUrl = normalizeBaseUrl;
  g.apiRequest = apiRequest;
})(typeof globalThis !== "undefined" ? globalThis : window);

