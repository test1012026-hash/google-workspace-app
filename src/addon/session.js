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
