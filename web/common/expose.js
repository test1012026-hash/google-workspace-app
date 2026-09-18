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
