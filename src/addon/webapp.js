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

  // Compose & send modal from Gmail card — compose-only (uses add-on session).
  var view = String(params.view || "");
  var embed = String(params.embed || "");
  if (view === "compose" || view === "encrypt" || embed === "1") {
    return serveComposeModal_(params);
  }

  // Must use Template so <?!= include(...) ?> in Index.html are evaluated.
  return HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("SecureDocShare Workspace")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Overlay compose UI — no login shell; session from ticket or UserProperties. */
function serveComposeModal_(params) {
  var session = null;
  var ticket = String((params && params.compose_ticket) || "").trim();

  if (ticket) {
    try {
      var raw = CacheService.getScriptCache().get("sds_compose_" + ticket);
      CacheService.getScriptCache().remove("sds_compose_" + ticket);
      if (raw) session = JSON.parse(raw);
    } catch (eCache) {
      session = null;
    }
  }
  if (!session || !session.token) {
    session = getWorkspaceSession_();
  }

  var template = HtmlService.createTemplateFromFile("Compose");
  template.sessionJson = JSON.stringify(session || null);
  var page = template
    .evaluate()
    .setTitle("SecureDocShare — Compose")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  try {
    page.setWidth(420).setHeight(640);
  } catch (eSize) {}
  return page;
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
