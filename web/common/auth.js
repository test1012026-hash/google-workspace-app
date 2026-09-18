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
    } else if (baseUrl) {
      const derived = String(baseUrl)
        .replace(/\/api\/?$/i, "")
        .replace(/\/$/, "");
      if (
        derived &&
        derived.indexOf("script.google.com") < 0 &&
        derived.indexOf("googleusercontent.com") < 0
      ) {
        returnOrigin = derived;
      }
    }
  } catch (eOrigin) {}

  let start =
    baseUrl +
    "/auth/oauth/" +
    encodeURIComponent(provider) +
    "/start?returnOrigin=" +
    encodeURIComponent(returnOrigin) +
    "&returnPath=" +
    encodeURIComponent(returnPath) +
    "&intent=" +
    encodeURIComponent(intent);
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
