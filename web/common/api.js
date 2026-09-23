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
  let token = options.token;
  if (!token && typeof getStoredSession === "function") {
    try {
      const session = getStoredSession();
      if (session && session.token) token = session.token;
    } catch (e) {}
  }
  if (token) {
    headers.Authorization = "Bearer " + token;
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
