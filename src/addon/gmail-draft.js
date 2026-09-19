function gmailApiRequest_(method, path, body, accessToken) {
  try {
    const token = accessToken || "";
    if (!token) {
      return {
        ok: false,
        code: 401,
        error:
          "Gmail access token missing. Re-authorize the SecureDocShare add-on.",
      };
    }
    const options = {
      method: String(method || "get").toLowerCase(),
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json",
      },
      muteHttpExceptions: true,
    };
    if (body != null) {
      options.contentType = "application/json";
      options.payload = JSON.stringify(body);
    }
    const res = UrlFetchApp.fetch(
      "https://gmail.googleapis.com" + path,
      options
    );
    const code = res.getResponseCode();
    let data = {};
    const text = res.getContentText() || "";
    try {
      data = JSON.parse(text || "{}");
    } catch (err) {
      data = { raw: text };
    }
    if (code < 200 || code >= 300) {
      const errMsg =
        (data && data.error && data.error.message) ||
        data.error ||
        text ||
        "Gmail API error (" + code + ")";
      return { ok: false, code: code, error: String(errMsg), data: data };
    }
    return { ok: true, code: code, data: data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function normalizeEmailAddress_(value) {
  let s = String(value || "").trim().toLowerCase();
  if (!s) return "";
  const m = s.match(/<([^>]+)>/);
  if (m && m[1]) s = String(m[1]).trim().toLowerCase();
  s = s.replace(/^mailto:/i, "").trim();
  if (s.indexOf("@") < 0) return "";
  return s;
}

function extractEmailsFromHeader_(header) {
  const out = [];
  const parts = String(header || "").split(",");
  for (let i = 0; i < parts.length; i++) {
    const e = normalizeEmailAddress_(parts[i]);
    if (e && out.indexOf(e) < 0) out.push(e);
  }
  return out;
}

function emailsOverlap_(a, b) {
  if (!a || !a.length || !b || !b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (b.indexOf(a[i]) >= 0) return true;
  }
  return false;
}

function getMimeHeader_(headers, name) {
  const want = String(name || "").toLowerCase();
  for (let i = 0; i < (headers || []).length; i++) {
    if (String((headers[i] && headers[i].name) || "").toLowerCase() === want) {
      return String(headers[i].value || "");
    }
  }
  return "";
}

function decodeBodyData_(data) {
  if (!data) return "";
  try {
    let padded = String(data).replace(/-/g, "+").replace(/_/g, "/");
    while (padded.length % 4) padded += "=";
    return Utilities.newBlob(Utilities.base64Decode(padded)).getDataAsString(
      "UTF-8"
    );
  } catch (err) {
    try {
      return Utilities.newBlob(
        Utilities.base64DecodeWebSafe(String(data))
      ).getDataAsString("UTF-8");
    } catch (err2) {
      return "";
    }
  }
}

function extractMessagePlainBody_(payload) {
  if (!payload) return "";

  function walk(part) {
    if (!part) return { plain: "", html: "" };
    const mime = String(part.mimeType || "").toLowerCase();
    let plain = "";
    let html = "";
    if (mime === "text/plain" && part.body && part.body.data) {
      plain = decodeBodyData_(part.body.data);
    } else if (mime === "text/html" && part.body && part.body.data) {
      html = decodeBodyData_(part.body.data);
    }
    const parts = part.parts || [];
    for (let i = 0; i < parts.length; i++) {
      const child = walk(parts[i]);
      if (!plain && child.plain) plain = child.plain;
      if (!html && child.html) html = child.html;
    }
    return { plain: plain, html: html };
  }

  const found = walk(payload);
  if (found.plain && String(found.plain).trim()) {
    return String(found.plain).replace(/\r\n/g, "\n").trim();
  }
  if (found.html) {
    return String(found.html)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\r\n/g, "\n")
      .trim();
  }
  if (payload.body && payload.body.data) {
    return decodeBodyData_(payload.body.data).trim();
  }
  return "";
}

function findMatchingGmailDraft_(toEmails, subjectHint, accessToken) {
  const targets = [];
  for (let i = 0; i < (toEmails || []).length; i++) {
    const e = normalizeEmailAddress_(toEmails[i]);
    if (e && targets.indexOf(e) < 0) targets.push(e);
  }
  const subjectWant = String(subjectHint || "").trim().toLowerCase();

  const list = gmailApiRequest_(
    "get",
    "/gmail/v1/users/me/drafts?maxResults=30",
    null,
    accessToken
  );
  if (!list.ok) {
    const scopeHint = /insufficient|scope/i.test(String(list.error || ""))
      ? " Re-authorize the SecureDocShare add-on (needs Gmail modify access)."
      : "";
    return {
      ok: false,
      error: (list.error || "Cannot list drafts.") + scopeHint,
    };
  }

  const drafts = (list.data && list.data.drafts) || [];
  if (!drafts.length) {
    return {
      ok: false,
      error: "No drafts found. Wait for Gmail to autosave, then try again.",
    };
  }

  let best = null;
  for (let i = 0; i < drafts.length; i++) {
    const id = drafts[i] && drafts[i].id;
    if (!id) continue;
    const full = gmailApiRequest_(
      "get",
      "/gmail/v1/users/me/drafts/" + encodeURIComponent(id) + "?format=full",
      null,
      accessToken
    );
    if (!full.ok) continue;
    const draftObj = full.data || {};
    const msg = draftObj.message || {};
    const payload = msg.payload || {};
    const headers = payload.headers || [];
    const toHdr = getMimeHeader_(headers, "To");
    const subj = getMimeHeader_(headers, "Subject");
    const draftTos = extractEmailsFromHeader_(toHdr);
    let score = 0;

    if (targets.length) {
      if (!emailsOverlap_(targets, draftTos)) continue;
      score += 10;
    } else if (draftTos.length) {
      // Reply/forward: compose event often omits To — still match drafts that have recipients.
      score += 8;
    } else {
      score += 1;
    }

    const subjNorm = String(subj || "").trim().toLowerCase();
    if (subjectWant && subjNorm === subjectWant) {
      score += 5;
    } else if (
      subjectWant &&
      (subjNorm.indexOf(subjectWant) >= 0 || subjectWant.indexOf(subjNorm) >= 0)
    ) {
      score += 3;
    } else if (/^(re|fw|fwd)\s*:/i.test(subjNorm)) {
      score += 2;
    }

    // Prefer drafts that look like the open reply (have a body).
    const body = extractMessagePlainBody_(payload);
    if (body && body.length > 0) score += 1;
    if (/sds\./i.test(body) || /On .+wrote:/i.test(body)) score += 2;

    const candidate = {
      ok: true,
      draftId: draftObj.id || id,
      messageId: msg.id || "",
      toHeader: toHdr,
      toEmails: draftTos.length ? draftTos : targets,
      subject: subj || "",
      body: body,
      ccHeader: getMimeHeader_(headers, "Cc"),
      bccHeader: getMimeHeader_(headers, "Bcc"),
      score: score,
    };

    if (!best || candidate.score > best.score) {
      best = candidate;
    }
    if (candidate.score >= 15) break;
  }

  if (!best) {
    return {
      ok: false,
      error:
        "Could not match an open draft. Add a recipient in To, wait for autosave, then try again.",
    };
  }
  return best;
}

function sanitizeMimeHeader_(s) {
  return String(s || "")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function buildRfc822EncryptedMime_(options) {
  options = options || {};
  const boundary = "SecureDocShareAlt_" + String(Date.now());
  const lines = [
    "To: " + sanitizeMimeHeader_(options.to),
    "Subject: " + sanitizeMimeHeader_(options.subject || "Secure document"),
    "MIME-Version: 1.0",
    'Content-Type: multipart/alternative; boundary="' + boundary + '"',
    "",
    "--" + boundary,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    options.text || "",
    "",
    "--" + boundary,
    "Content-Type: text/html; charset=UTF-8",
    "",
    options.html || "",
    "",
    "--" + boundary + "--",
    "",
  ];
  if (options.cc) lines.splice(1, 0, "Cc: " + sanitizeMimeHeader_(options.cc));
  if (options.bcc) {
    lines.splice(
      options.cc ? 2 : 1,
      0,
      "Bcc: " + sanitizeMimeHeader_(options.bcc)
    );
  }
  if (options.from) {
    lines.unshift("From: " + sanitizeMimeHeader_(options.from));
  }
  return lines.join("\r\n");
}

function encodeRawMime_(rfc822) {
  return Utilities.base64EncodeWebSafe(rfc822, Utilities.Charset.UTF_8).replace(
    /=+$/,
    ""
  );
}

/** Create a draft with recipient, subject, and encrypted body. */
function gmailDraftCreate_(options, accessToken) {
  const rfc822 = buildRfc822EncryptedMime_(options);
  const raw = encodeRawMime_(rfc822);
  return gmailApiRequest_(
    "post",
    "/gmail/v1/users/me/drafts",
    { message: { raw: raw } },
    accessToken
  );
}

/** Send a draft (Gmail removes that draft after send). */
function gmailDraftSend_(draftId, accessToken) {
  if (!draftId) {
    return { ok: false, error: "Draft id missing." };
  }
  return gmailApiRequest_(
    "post",
    "/gmail/v1/users/me/drafts/send",
    { id: draftId },
    accessToken
  );
}

/** Delete a draft (used for the old plaintext compose). */
function gmailDraftDelete_(draftId, accessToken) {
  if (!draftId) {
    return { ok: false, error: "Draft id missing." };
  }
  return gmailApiRequest_(
    "delete",
    "/gmail/v1/users/me/drafts/" + encodeURIComponent(draftId),
    null,
    accessToken
  );
}

/**
 * Create encrypted draft → send it → delete old plaintext draft.
 * Returns { ok, newDraftId, sent, oldDeleted, error, sendError }.
 */
function gmailCreateEncryptedDraftSendAndCleanup_(
  oldDraftId,
  mimeOpts,
  accessToken
) {
  const created = gmailDraftCreate_(mimeOpts, accessToken);
  if (!created.ok || !created.data) {
    return {
      ok: false,
      newDraftId: "",
      sent: false,
      oldDeleted: false,
      error: created.error || "Could not create encrypted draft.",
      sendError: "",
    };
  }

  const newDraftId = (created.data && created.data.id) || "";
  if (!newDraftId) {
    return {
      ok: false,
      newDraftId: "",
      sent: false,
      oldDeleted: false,
      error: "Encrypted draft created but id missing.",
      sendError: "",
    };
  }

  const sentRes = gmailDraftSend_(newDraftId, accessToken);
  if (!sentRes.ok) {
    // Leave the encrypted draft for the user; do not delete plaintext yet.
    return {
      ok: false,
      newDraftId: newDraftId,
      sent: false,
      oldDeleted: false,
      error: "",
      sendError: sentRes.error || "Could not send encrypted draft.",
    };
  }

  let oldDeleted = false;
  let deleteError = "";
  if (oldDraftId && oldDraftId !== newDraftId) {
    const del = gmailDraftDelete_(oldDraftId, accessToken);
    if (del.ok) {
      oldDeleted = true;
    } else {
      deleteError = del.error || "Could not delete the old plaintext draft.";
    }
  } else {
    oldDeleted = true;
  }

  return {
    ok: true,
    newDraftId: newDraftId,
    sent: true,
    oldDeleted: oldDeleted,
    error: deleteError,
    sendError: "",
  };
}

function gmailMessagesSendWithToken_(accessToken, options) {
  try {
    const rfc822 = buildRfc822EncryptedMime_(options);
    const raw = encodeRawMime_(rfc822);
    const res = UrlFetchApp.fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "post",
        contentType: "application/json",
        headers: {
          Authorization: "Bearer " + accessToken,
          Accept: "application/json",
        },
        payload: JSON.stringify({ raw: raw }),
        muteHttpExceptions: true,
      }
    );
    const code = res.getResponseCode();
    let data = {};
    try {
      data = JSON.parse(res.getContentText() || "{}");
    } catch (err) {}
    if (code < 200 || code >= 300) {
      const errMsg =
        (data && data.error && data.error.message) ||
        data.error ||
        "Gmail send failed (" + code + ")";
      return { ok: false, code: code, error: String(errMsg) };
    }
    return { ok: true, data: data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function buildSecureComposeBodyText_(cipher, meta, quotedClear) {
  const lines = [String(cipher || "").replace(/\s+/g, "")];
  if (meta && (meta.token || meta.emailEnc || meta.uuidEnc)) {
    lines.push("");
    if (meta.token) lines.push(String(meta.token).replace(/\s+/g, ""));
    if (meta.emailEnc) lines.push("email: " + meta.emailEnc);
    if (meta.uuidEnc) lines.push("uuid: " + meta.uuidEnc);
  }
  lines.push("");
  lines.push(
    "To know more, visit our website: " +
      String(
        typeof ADMIN_URL !== "undefined" && ADMIN_URL
          ? ADMIN_URL
          : "https://admin-panel-amber-nine.vercel.app"
      ).replace(/\/$/, "")
  );
  const quote = String(quotedClear || "").trim();
  if (quote) {
    lines.push("");
    lines.push(quote);
  }
  return lines.join("\n");
}
