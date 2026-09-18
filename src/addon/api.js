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

function apiEncrypt_(to, subject, message, token) {
  try {
    var res = UrlFetchApp.fetch(API_BASE + "/files/encrypt", {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + token },
      payload: JSON.stringify({
        recipientEmail: to,
        subject: subject || "",
        message: message || "",
      }),
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    var data = {};
    try {
      data = JSON.parse(res.getContentText() || "{}");
    } catch (e) {}
    if (code < 200 || code >= 300) {
      return { ok: false, error: data.error || "Encrypt failed (" + code + ")" };
    }
    return {
      ok: true,
      messageCipherText: data.messageCipherText || "",
      attachment: data.attachment || null,
      mailMetadata: data.mailMetadata || null,
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Short-lived Gmail access token (extension-connected gmail.send). */
function apiGmailSendToken_(token) {
  try {
    var res = UrlFetchApp.fetch(API_BASE + "/auth/gmail/send-token", {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + token },
      payload: "{}",
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
        code: data.code || "",
        error: data.error || "Gmail send-token failed (" + code + ")",
      };
    }
    return {
      ok: true,
      accessToken: data.accessToken || "",
      from: data.from || "",
      appUrl: data.appUrl || "",
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Decrypt message and/or file package via /public/decrypt */
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
    var res = UrlFetchApp.fetch(API_BASE + "/public/decrypt", {
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
    } catch (e) {}
    if (code < 200 || code >= 300 || data.ok === false) {
      return { ok: false, error: data.error || "Decrypt failed (" + code + ")" };
    }
    return {
      ok: true,
      message: data.message || null,
      file: data.file || null,
      filename: data.filename || null,
      decrypted: true,
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

