function onCardToggleAuthMode_(e) {
  var params = (e && e.parameters) || {};
  var next = params.authMode === "signup" ? "signup" : "login";
  setCardAuthMode_(next);
  PropertiesService.getUserProperties().deleteProperty("SDS_CARD_OTP_SENT");
  clearCardSignupDraft_();
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildMainCard_(e)))
    .build();
}

var CARD_SIGNUP_DRAFT_KEY = "SDS_CARD_SIGNUP_DRAFT";

function saveCardSignupDraft_(email, password, acceptTerms) {
  PropertiesService.getUserProperties().setProperty(
    CARD_SIGNUP_DRAFT_KEY,
    JSON.stringify({
      email: String(email || "").trim(),
      password: String(password || ""),
      acceptTerms: Boolean(acceptTerms),
    })
  );
}

function loadCardSignupDraft_() {
  try {
    var raw = PropertiesService.getUserProperties().getProperty(
      CARD_SIGNUP_DRAFT_KEY
    );
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function clearCardSignupDraft_() {
  PropertiesService.getUserProperties().deleteProperty(CARD_SIGNUP_DRAFT_KEY);
}

function onCardGoogleSignIn_(e) {
  var form = (e && e.formInput) || {};
  var mode = getCardAuthMode_(e);
  var isSignup = mode === "signup";
  if (isSignup) {
    var terms = form.accept_terms;
    var accepted =
      terms === "yes" ||
      (Array.isArray(terms) && terms.indexOf("yes") >= 0);
    if (!accepted) {
      return notify_("Accept Terms & Conditions to sign up with Google.");
    }
  }
  var url;
  try {
    url = getGoogleLoginUrl({
      intent: isSignup ? "signup" : "login",
      acceptTerms: true,
    });
  } catch (err) {
    return notify_(String(err.message || err));
  }
  if (!url) {
    return notify_("Google sign-in URL is not configured.");
  }
  return CardService.newActionResponseBuilder()
    .setOpenLink(
      CardService.newOpenLink()
        .setUrl(url)
        .setOpenAs(CardService.OpenAs.FULL_SIZE)
        .setOnClose(CardService.OnClose.RELOAD_ADD_ON)
    )
    .build();
}

function onCardResendOtp_(e) {
  var form = (e && e.formInput) || {};
  var draft = loadCardSignupDraft_() || {};
  var email = String(form.login_email || draft.email || "").trim();
  if (!email) return notify_("Enter email first.");
  var terms = form.accept_terms;
  var accepted =
    terms === "yes" ||
    (Array.isArray(terms) && terms.indexOf("yes") >= 0) ||
    draft.acceptTerms === true;
  if (!accepted) {
    return notify_("Accept Terms & Conditions to sign up.");
  }
  var password = String(form.login_password || draft.password || "");
  saveCardSignupDraft_(email, password, true);
  var sent = apiSignupSendOtp_(email, true);
  if (!sent.ok) return notify_(sent.error || "Could not send code.");
  PropertiesService.getUserProperties().setProperty("SDS_CARD_OTP_SENT", "1");
  setCardAuthMode_("signup");
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildMainCard_(e)))
    .setNotification(
      CardService.newNotification().setText(
        sent.devOtp ? "Dev code: " + sent.devOtp : "Verification code sent."
      )
    )
    .build();
}

function onCardLogin_(e) {
  var form = (e && e.formInput) || {};
  var draft = loadCardSignupDraft_() || {};
  var email = String(form.login_email || draft.email || "").trim();
  var password = String(form.login_password || draft.password || "");
  var mode = getCardAuthMode_(e);
  var isSignup = mode === "signup";

  if (!email || !password) {
    return notify_("Email and password are required.");
  }

  if (isSignup) {
    var terms = form.accept_terms;
    var accepted =
      terms === "yes" ||
      (Array.isArray(terms) && terms.indexOf("yes") >= 0) ||
      draft.acceptTerms === true;
    if (!accepted) {
      return notify_("Accept Terms & Conditions to sign up.");
    }

    var otpSent =
      PropertiesService.getUserProperties().getProperty("SDS_CARD_OTP_SENT") ===
      "1";
    if (!otpSent) {
      var send = apiSignupSendOtp_(email, true);
      if (!send.ok) return notify_(send.error || "Could not send code.");
      saveCardSignupDraft_(email, password, true);
      PropertiesService.getUserProperties().setProperty("SDS_CARD_OTP_SENT", "1");
      return CardService.newActionResponseBuilder()
        .setNavigation(CardService.newNavigation().updateCard(buildMainCard_(e)))
        .setNotification(
          CardService.newNotification().setText(
            send.devOtp
              ? "Dev code: " + send.devOtp
              : "Code sent. Enter it below, then Verify & sign up."
          )
        )
        .build();
    }

    var otp = String(form.signup_otp || "").trim();
    if (!/^\d{4}$/.test(otp)) {
      return notify_("Enter the 4-digit verification code.");
    }
    var signed = apiSignup_(email, password, otp, true);
    if (!signed.ok) return notify_(signed.error || "Signup failed.");
    PropertiesService.getUserProperties().deleteProperty("SDS_CARD_OTP_SENT");
    clearCardSignupDraft_();
    setCardAuthMode_("login");
    saveWorkspaceSession({
      token: signed.token,
      email: signed.email || email,
      expiresAt: signed.expiresAt || null,
    });
    return CardService.newActionResponseBuilder()
      .setNavigation(
        CardService.newNavigation().updateCard(buildGmailMessageCard_(e))
      )
      .setNotification(
        CardService.newNotification().setText(
          "Account created — signed in as " + (signed.email || email)
        )
      )
      .build();
  }

  var result = apiLogin_(email, password);
  if (!result.ok) {
    return notify_(result.error || "Login failed.");
  }

  PropertiesService.getUserProperties().deleteProperty("SDS_CARD_OTP_SENT");
  saveWorkspaceSession({
    token: result.token,
    email: result.email || email,
    expiresAt: result.expiresAt || null,
  });

  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation().updateCard(buildGmailMessageCard_(e))
    )
    .setNotification(
      CardService.newNotification().setText(
        "Signed in as " + (result.email || email)
      )
    )
    .build();
}

function onCardLogout_(e) {
  var session = getWorkspaceSession_();
  if (session && session.token) {
    try {
      UrlFetchApp.fetch(API_BASE + "/auth/logout", {
        method: "post",
        contentType: "application/json",
        headers: { Authorization: "Bearer " + session.token },
        payload: "{}",
        muteHttpExceptions: true,
      });
    } catch (err) {}
  }
  clearWorkspaceSession();
  setCardAuthMode_("login");
  PropertiesService.getUserProperties().deleteProperty("SDS_CARD_OTP_SENT");
  clearCardSignupDraft_();
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildMainCard_(e)))
    .setNotification(CardService.newNotification().setText("Signed out."))
    .build();
}

function onCardDecrypt_(e) {
  try {
    var form = (e && e.formInput) || {};
    var cipher = String(form.decrypt_cipher || "").trim();
    if (!cipher) {
      try {
        cipher = extractCipherFromMessage_(e) || "";
      } catch (err) {}
    }
    if (!cipher) {
      return CardService.newActionResponseBuilder()
        .setNavigation(
          CardService.newNavigation().updateCard(
            buildDecryptErrorCard_("Paste ciphertext first, then decrypt.")
          )
        )
        .setNotification(
          CardService.newNotification().setText("Paste ciphertext first.")
        )
        .build();
    }

    var valid = getValidWorkspaceAuth_();
    if (!valid) {
      return CardService.newActionResponseBuilder()
        .setNavigation(CardService.newNavigation().updateCard(buildMainCard_(e)))
        .setNotification(
          CardService.newNotification().setText("Sign in first, then decrypt.")
        )
        .build();
    }

    var email = valid.auth.email || valid.session.email || "";
    if (!email) {
      return CardService.newActionResponseBuilder()
        .setNavigation(
          CardService.newNavigation().updateCard(
            buildDecryptErrorCard_(
              "Signed-in email missing. Sign out and sign in again, then decrypt."
            )
          )
        )
        .setNotification(
          CardService.newNotification().setText("Signed-in email missing.")
        )
        .build();
    }

    var dec = apiDecrypt_({
      email: email,
      messageCipherText: cipher,
      token: valid.session.token,
    });
    if (!dec.ok) {
      var errText = formatDecryptError_(dec, "Decrypt failed.");
      return CardService.newActionResponseBuilder()
        .setNavigation(
          CardService.newNavigation().updateCard(buildDecryptErrorCard_(errText))
        )
        .setNotification(CardService.newNotification().setText(errText))
        .build();
    }

    if (!String(dec.message || "").trim()) {
      var emptyErr =
        "Decrypt succeeded but no message text was returned. Check the ciphertext and try again.";
      return CardService.newActionResponseBuilder()
        .setNavigation(
          CardService.newNavigation().updateCard(buildDecryptErrorCard_(emptyErr))
        )
        .setNotification(CardService.newNotification().setText(emptyErr))
        .build();
    }

    var section = CardService.newCardSection().addWidget(
      CardService.newTextParagraph().setText(dec.message)
    );
    section.addWidget(
      CardService.newTextButton()
        .setText("Back")
        .setOnClickAction(CardService.newAction().setFunctionName("onCardBack_"))
    );

    var card = CardService.newCardBuilder()
      .setHeader(cardHeader_("Decrypted", "SecureDocShare"))
      .addSection(section)
      .build();

    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().pushCard(card))
      .setNotification(
        CardService.newNotification().setText("Message decrypted.")
      )
      .build();
  } catch (err) {
    var crash =
      "Decrypt error: " + String(err && err.message ? err.message : err);
    return CardService.newActionResponseBuilder()
      .setNavigation(
        CardService.newNavigation().updateCard(buildDecryptErrorCard_(crash))
      )
      .setNotification(CardService.newNotification().setText(crash))
      .build();
  }
}

function onCardBack_(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildMainCard_(e)))
    .build();
}

function getComposeDraftMeta_(e) {
  var gmail = (e && e.gmail) || {};
  var meta = (e && e.draftMetadata) || {};
  var toList =
    gmail.toRecipients ||
    meta.toRecipients ||
    meta.toRecipient ||
    [];
  var ccList = gmail.ccRecipients || meta.ccRecipients || [];
  var bccList = gmail.bccRecipients || meta.bccRecipients || [];
  if (typeof toList === "string") toList = [toList];
  if (typeof ccList === "string") ccList = [ccList];
  if (typeof bccList === "string") bccList = [bccList];
  var to = [];
  var i;
  for (i = 0; i < (toList || []).length; i++) {
    var t = String(toList[i] || "").trim();
    if (t) to.push(t);
  }
  return {
    to: to,
    toJoined: to.join(", "),
    cc: ccList || [],
    bcc: bccList || [],
    subject: String(gmail.subject || meta.subject || "").trim(),
  };
}

function resolveComposeEncryptPayload_(e, gmailAccessToken) {
  var draftMeta = getComposeDraftMeta_(e);
  var toList = (draftMeta.to && draftMeta.to.length) ? draftMeta.to.slice() : [];

  var matched = findMatchingGmailDraft_(
    toList,
    draftMeta.subject || "",
    gmailAccessToken
  );

  var firstTo = "";
  if (toList.length) {
    firstTo = normalizeEmailAddress_(toList[0]) || String(toList[0]).trim();
  } else if (matched.ok && matched.toEmails && matched.toEmails.length) {
    firstTo = matched.toEmails[0];
  }

  var subject =
    (matched.ok && matched.subject) || draftMeta.subject || "";
  var message = (matched.ok && matched.body) || "";

  var toJoined =
    toList.join(", ") ||
    (matched.ok && matched.toHeader) ||
    firstTo;

  return {
    firstTo: firstTo,
    toJoined: toJoined,
    toList: toList,
    subject: subject,
    message: message,
    matched: matched,
    files:
      matched && matched.ok && Array.isArray(matched.files)
        ? matched.files
        : [],
  };
}

function runComposeEncryptAndSendCore_(e) {
  var gate = verifyLoginAndSubscription_();
  if (!gate.ok) {
    return {
      ok: false,
      needLogin: true,
      error: gate.error || "Login / subscription required.",
    };
  }

  var tokenRes = getMarketplaceGmailAccess_(gate.token);
  if (!tokenRes.ok || !tokenRes.accessToken) {
    return {
      ok: false,
      needGmailConnect: true,
      error:
        tokenRes.error ||
        "Connect Gmail once with your Google account, then try again.",
      code: tokenRes.code || "GMAIL_NOT_CONNECTED",
    };
  }

  var accessToken = tokenRes.accessToken;
  var payload = resolveComposeEncryptPayload_(e, accessToken);
  if (
    payload.matched &&
    payload.matched.ok === false &&
    payload.matched.error
  ) {
    return {
      ok: false,
      error: payload.matched.error,
    };
  }
  if (!payload.firstTo) {
    return {
      ok: false,
      error:
        "Add a recipient in To, wait for Gmail autosave, then try again.",
    };
  }

  var draftFiles = payload.files || [];
  var blockedExts =
    typeof apiFetchBlockedFileExtensions_ === "function"
      ? apiFetchBlockedFileExtensions_()
      : [];
  var blockedAtt =
    typeof findBlockedDraftAttachment_ === "function"
      ? findBlockedDraftAttachment_(draftFiles, blockedExts)
      : null;

  // Same as Outlook: blocked extension → error, do not encrypt message/file.
  if (blockedAtt) {
    var blockedExt =
      (typeof extensionFromFileName_ === "function"
        ? extensionFromFileName_(blockedAtt.name)
        : "") || "file";
    return {
      ok: false,
      code: "FILE_EXTENSION_BLOCKED",
      error:
        "." +
        blockedExt +
        " [blocked extension] is blocked in this app. Nothing was encrypted. Remove the file, then try again.",
    };
  }

  var fileToEncrypt =
    typeof pickDraftFileToEncrypt_ === "function"
      ? pickDraftFileToEncrypt_(draftFiles, blockedExts)
      : null;

  if (!String(payload.message || "").trim() && !fileToEncrypt) {
    return {
      ok: false,
      error:
        (payload.matched && payload.matched.error) ||
        "No draft body or attachment found. Add a message or file, wait for autosave, then try again.",
    };
  }

  // Reply/forward handling:
  // - Decrypt any parent sds. with the signed-in user's keys
  // - Strip old sdmeta (avoid duplicate / glued "testsdmeta")
  // - Pure forward / empty new body: re-encrypt decrypted plain for the NEW To
  // - Reply with new text: encrypt only the new text; append clear parent (no old meta)
  var split = splitComposeNewAndQuoted_(payload.message || "");
  var newMessage = String(split.newText || "").trim();
  var quotedBlock = String(split.quotedBlock || "").trim();
  var sessionEmail =
    (gate.email && String(gate.email)) ||
    (getWorkspaceSession_() && getWorkspaceSession_().email) ||
    "";
  var subject = payload.subject || "Secure document";
  var isForwardSubject = /^(fw|fwd)\s*:/i.test(String(subject).trim());
  var quotedClear = "";
  var quotedAppendix = "";

  // Body is only ciphertext (common on Forward with no markers).
  if (!quotedBlock && /sds\./i.test(newMessage)) {
    quotedBlock = newMessage;
    newMessage = "";
  }

  if (quotedBlock) {
    var quoteDec = decryptQuotedParentSds_(
      quotedBlock,
      gate.token,
      sessionEmail
    );
    if (!quoteDec.ok) {
      return {
        ok: false,
        error:
          quoteDec.error ||
          "Could not decrypt the quoted parent message. Open the original mail, decrypt once, then try again.",
      };
    }
    quotedClear = stripSecureDocMetadataBlock_(
      String(quoteDec.text || "").trim()
    );
  }

  if (newMessage && /sds\./i.test(newMessage)) {
    var newDec = decryptQuotedParentSds_(
      newMessage,
      gate.token,
      sessionEmail
    );
    if (!newDec.ok) {
      return {
        ok: false,
        error:
          newDec.error ||
          "Could not decrypt the message body before encrypting for the new recipient.",
      };
    }
    newMessage = stripSecureDocMetadataBlock_(String(newDec.text || "").trim());
  }

  var messageToEncrypt = newMessage;
  if (!messageToEncrypt) {
    // Pure forward / empty reply: re-encrypt parent plain for the NEW recipient.
    messageToEncrypt = extractForwardPlainMessage_(quotedClear);
    quotedAppendix = "";
  } else if (quotedClear) {
    // Reply with new text: keep parent readable, without old metadata.
    quotedAppendix = isForwardSubject
      ? ""
      : extractForwardPlainMessage_(quotedClear);
    if (isForwardSubject) {
      // Forward + typed note: encrypt note + parent plain together for new To.
      var parentPlain = extractForwardPlainMessage_(quotedClear);
      messageToEncrypt = parentPlain
        ? messageToEncrypt + "\n\n" + parentPlain
        : messageToEncrypt;
      quotedAppendix = "";
    }
  }

  if (!String(messageToEncrypt || "").trim() && !fileToEncrypt) {
    return {
      ok: false,
      error:
        "Nothing to encrypt. Add a message or file, or forward an encrypted mail you can decrypt.",
    };
  }

  var fileOpts = null;
  if (fileToEncrypt && fileToEncrypt.content) {
    fileOpts = {
      fileBase64: fileToEncrypt.content,
      fileName: fileToEncrypt.name || "document.bin",
      mimeType:
        fileToEncrypt.mimeType ||
        (typeof guessMimeTypeFromName_ === "function"
          ? guessMimeTypeFromName_(fileToEncrypt.name)
          : "application/octet-stream"),
    };
  }

  // Valid file first (if any), then message — same order as Outlook.
  var enc =
    typeof apiEncryptFileThenMessage_ === "function"
      ? apiEncryptFileThenMessage_(
          payload.firstTo,
          subject,
          messageToEncrypt || "",
          gate.token,
          fileOpts
        )
      : apiEncrypt_(
          payload.firstTo,
          subject,
          messageToEncrypt || "",
          gate.token,
          fileOpts
        );
  if (!enc.ok) {
    if (enc.code === "FILE_EXTENSION_BLOCKED") {
      var failExt =
        enc.extension ||
        (fileOpts && fileOpts.fileName
          ? extensionFromFileName_(fileOpts.fileName)
          : "file");
      return {
        ok: false,
        code: "FILE_EXTENSION_BLOCKED",
        error:
          enc.error ||
          "." +
            failExt +
            " [blocked extension] is blocked. Nothing was encrypted. Remove the file, then try again.",
      };
    }
    return { ok: false, error: enc.error || "Encrypt failed." };
  }

  var cipher = enc.messageCipherText || "";
  var meta = enc.mailMetadata || null;
  var bodyHtml = buildSecureComposeBodyHtml_(cipher, meta, quotedAppendix);
  var bodyText = buildSecureComposeBodyText_(cipher, meta, quotedAppendix);
  var toHeader = payload.toJoined || payload.firstTo;
  var oldDraftId =
    payload.matched && payload.matched.ok ? payload.matched.draftId || "" : "";

  var encAtt = enc.attachment || null;
  var encAttB64 =
    (encAtt && (encAtt.attachmentBase64 || encAtt.base64)) ||
    enc.fileCipherText ||
    null;
  var encAttName =
    (encAtt && encAtt.fileName) ||
    (fileToEncrypt && fileToEncrypt.name
      ? String(fileToEncrypt.name).replace(/\.[^.]+$/, "") + ".securefile"
      : "encrypted.securefile");

  if (fileToEncrypt && !encAttB64) {
    return {
      ok: false,
      error:
        "File was encrypted on the server but no secure attachment was returned. Try a smaller PDF, then send again.",
    };
  }

  if (!cipher && !encAttB64) {
    return {
      ok: false,
      error: "Encrypt returned no message and no file. Nothing was sent.",
    };
  }

  var mimeOpts = {
    from: tokenRes.from || "",
    to: toHeader,
    cc:
      payload.matched && payload.matched.ok
        ? payload.matched.ccHeader || ""
        : "",
    bcc:
      payload.matched && payload.matched.ok
        ? payload.matched.bccHeader || ""
        : "",
    subject: subject,
    html: bodyHtml,
    text: bodyText,
    attachmentName: encAttB64 ? encAttName : "",
    attachmentBase64: encAttB64 || "",
  };

  // 1) Create encrypted draft → 2) send → 3) delete plaintext draft
  var flow = gmailCreateEncryptedDraftSendAndCleanup_(
    oldDraftId,
    mimeOpts,
    accessToken
  );

  if (flow.ok && flow.sent) {
    return {
      ok: true,
      sent: true,
      sendError: "",
      oldDraftDeleted: Boolean(flow.oldDeleted),
      warning: flow.error || "",
      firstTo: payload.firstTo,
      subject: subject,
      bodyHtml: bodyHtml,
    };
  }

  // Fallback: messages.send, then delete old plaintext draft
  var sendRes = gmailMessagesSendWithToken_(accessToken, mimeOpts);
  if (!sendRes.ok) {
    return {
      ok: false,
      error:
        flow.sendError ||
        flow.error ||
        sendRes.error ||
        "Send failed. Re-authorize the SecureDocShare add-on and try again.",
    };
  }

  var oldDeleted = false;
  var warning = "";
  if (oldDraftId) {
    var del = gmailDraftDelete_(oldDraftId, accessToken);
    if (del.ok) {
      oldDeleted = true;
    } else {
      warning =
        "Encrypted mail sent, but the old plaintext draft could not be deleted. Discard the open compose window.";
    }
  } else {
    oldDeleted = true;
  }

  if (flow.newDraftId) {
    gmailDraftDelete_(flow.newDraftId, accessToken);
  }

  return {
    ok: true,
    sent: true,
    sendError: "",
    oldDraftDeleted: oldDeleted,
    warning: warning,
    firstTo: payload.firstTo,
    subject: subject,
    bodyHtml: bodyHtml,
  };
}

function buildComposeDirectCard_(e) {
  var valid = getValidWorkspaceAuth_();
  if (!valid) {
    return CardService.newCardBuilder()
      .setHeader(cardHeader_("SecureDocShare", "Login required"))
      .addSection(buildLoginSection_(e))
      .build();
  }

  return CardService.newCardBuilder()
    .setHeader(cardHeader_("SecureDocShare", "Compose"))
    .addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextParagraph().setText(
            "Encrypts this draft, sends the encrypted mail, and deletes the plaintext draft. Gmail uses your SecureDocShare Google OAuth client (not the Chrome extension)."
          )
        )
        .addWidget(
          CardService.newButtonSet().addButton(
            CardService.newTextButton()
              .setText("Encrypt & send")
              .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
              .setOnClickAction(
                CardService.newAction().setFunctionName(
                  "onComposeEncryptAndSend_"
                )
              )
          )
        )
    )
    .build();
}

function buildComposeSentCard_(result) {
  result = result || {};
  var lines = ["Encrypted mail sent successfully."];
  if (result.oldDraftDeleted) {
    lines.push("Plain text draft removed. Please close this compose window and open a new one to send another email.");
  } else if (result.warning) {
    lines.push(String(result.warning));
  }

  return CardService.newCardBuilder()
    .setHeader(cardHeader_("SecureDocShare", "Sent"))
    .addSection(
      CardService.newCardSection()
        .addWidget(CardService.newTextParagraph().setText(lines.join("\n")))
        // .addWidget(
        //   CardService.newButtonSet().addButton(
        //     CardService.newTextButton()
        //       .setText("Done")
        //       .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        //       .setOnClickAction(
        //         CardService.newAction().setFunctionName("onComposeSentDone_")
        //       )
        //   )
        // )
    )
    .build();
}

function onComposeSentDone_(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(
      CardService.newNavigation().updateCard(buildMainCard_(e))
    )
    .build();
}

/** Open Google OAuth with YOUR web client — full window, asks all Gmail scopes. */
function openMarketplaceGmailConnect_(e, message) {
  var session = getWorkspaceSession_() || {};
  if (!session.token) {
    return notify_("Sign in to SecureDocShare first.");
  }
  var connect = apiGmailConnectUrl_(session.token);
  if (!connect.ok || !connect.url) {
    return notify_(
      connect.error ||
        "Could not start Gmail connect. Deploy the server with /auth/gmail/connect, then try again."
    );
  }
  return CardService.newActionResponseBuilder()
    .setNotification(
      CardService.newNotification().setText(
        "Opening Google — allow Gmail access, then tap Encrypt & send again."
      )
    )
    .setOpenLink(
      CardService.newOpenLink()
        .setUrl(connect.url)
        .setOpenAs(CardService.OpenAs.FULL_SIZE)
        .setOnClose(CardService.OnClose.RELOAD)
    )
    .build();
}

function onComposeEncryptAndSend_(e) {
  var result;
  try {
    result = runComposeEncryptAndSendCore_(e);
  } catch (err) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText(
          "Encrypt/send error: " +
            String(err && err.message ? err.message : err)
        )
      )
      .build();
  }

  if (result.needLogin) {
    return CardService.newActionResponseBuilder()
      .setNavigation(
        CardService.newNavigation().updateCard(buildComposeDirectCard_(e))
      )
      .setNotification(
        CardService.newNotification().setText(
          result.error || "Login / subscription required."
        )
      )
      .build();
  }

  if (result.needGmailConnect) {
    return openMarketplaceGmailConnect_(e, result.error);
  }

  if (!result.ok) {
    // Fallback: any Gmail-not-connected style error should open Google prompt.
    if (
      result.code === "GMAIL_NOT_CONNECTED" ||
      /Connect Gmail|Gmail not connected|GMAIL_NOT_CONNECTED/i.test(
        String(result.error || "")
      )
    ) {
      return openMarketplaceGmailConnect_(e, result.error);
    }
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText(result.error || "Failed.")
      )
      .build();
  }

  if (!result.sent) {
    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText(
          result.sendError || "Encrypted but send failed."
        )
      )
      .build();
  }

  var note = "Encrypted mail sent.";
  if (result.oldDraftDeleted) {
    note += "";
  } else if (result.warning) {
    note += " " + result.warning;
  }

  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(note))
    .setStateChanged(true)
    .setNavigation(
      CardService.newNavigation().updateCard(buildComposeSentCard_(result))
    )
    .build();
}

function buildSecureComposeBodyHtml_(cipher, meta, quotedClear) {
  var parts = [];
  parts.push(
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.4;color:#202124">'
  );
  parts.push(
    '<div style="font-family:Consolas,\'Courier New\',monospace;font-size:11px;line-height:1.35;word-break:break-all;color:#0F766E">' +
      escapeHtml_(String(cipher || "").replace(/\s+/g, "")) +
      "</div>"
  );

  if (meta && (meta.token || meta.emailEnc || meta.uuidEnc)) {
    parts.push(
      '<div style="margin-top:10px;padding-top:8px;border-top:1px solid #0F766E;font-family:Consolas,\'Courier New\',monospace;font-size:10px;line-height:1.35;word-break:break-all;color:#334155">'
    );
    if (meta.token) {
      parts.push(
        "<div>" + escapeHtml_(String(meta.token).replace(/\s+/g, "")) + "</div>"
      );
    }
    if (meta.emailEnc) {
      parts.push("<div>email: " + escapeHtml_(meta.emailEnc) + "</div>");
    }
    if (meta.uuidEnc) {
      parts.push("<div>uuid: " + escapeHtml_(meta.uuidEnc) + "</div>");
    }
    parts.push("</div>");
  }

  var siteUrl = String(ADMIN_URL || "https://admin-panel-amber-nine.vercel.app").replace(
    /\/$/,
    ""
  );
  parts.push(
    '<div style="margin-top:14px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;color:#475569">' +
      "To know more, visit our website: " +
      '<a href="' +
      escapeHtml_(siteUrl) +
      '" style="color:#0F766E;font-weight:600;text-decoration:underline" target="_blank" rel="noopener noreferrer">' +
      escapeHtml_(siteUrl) +
      "</a></div>"
  );

  var quote = String(quotedClear || "").trim();
  if (quote) {
    parts.push(
      '<div style="margin-top:16px;padding-top:12px;border-top:1px solid #dadce0;color:#5f6368;font-size:12px;line-height:1.45;white-space:pre-wrap">' +
        escapeHtml_(quote).replace(/\n/g, "<br>") +
        "</div>"
    );
  }

  parts.push("</div>");
  return parts.join("");
}

/**
 * Split reply/forward draft into new text vs quoted parent thread.
 */
function splitComposeNewAndQuoted_(body) {
  var text = String(body || "").replace(/\r\n/g, "\n");
  if (!String(text).trim()) {
    return { newText: "", quotedBlock: "" };
  }

  var patterns = [
    /\nOn .{8,240}?wrote:\s*\n/i,
    /\n-+\s*Original Message\s*-+\s*\n/i,
    /\n-+\s*Forwarded message\s*-+\s*\n/i,
    /\nBegin forwarded message:\s*\n/i,
  ];

  var bestStart = -1;
  for (var p = 0; p < patterns.length; p++) {
    var m = patterns[p].exec(text);
    if (!m) continue;
    var start = m.index;
    if (text.charAt(start) === "\n") start += 1;
    if (bestStart < 0 || start < bestStart) bestStart = start;
  }

  // Fallback: quoted ciphertext after blank line(s) when reply markers missing.
  if (bestStart < 0) {
    var sdsAt = text.search(/(?:^|\n)sds\./i);
    if (sdsAt > 0) {
      bestStart = text.charAt(sdsAt) === "\n" ? sdsAt + 1 : sdsAt;
      // Prefer split at blank line before sds if present.
      var before = text.slice(0, bestStart);
      var blank = before.lastIndexOf("\n\n");
      if (blank >= 0 && blank + 2 < bestStart) {
        bestStart = blank + 2;
      }
    }
  }

  if (bestStart < 0) {
    return { newText: text.trim(), quotedBlock: "" };
  }

  return {
    newText: text.slice(0, bestStart).trim(),
    quotedBlock: text.slice(bestStart).trim(),
  };
}

/**
 * Decrypt sds. tokens in text → clear message.
 * Ensures a blank line before any leftover metadata so we never get "testsdmeta…".
 * Uses the signed-in user's email (keys for the mail they received).
 */
function decryptQuotedParentSds_(quotedBlock, authToken, recipientEmail) {
  var out = String(quotedBlock || "");
  if (!out || !/sds\./i.test(out)) {
    return { ok: true, text: out, decrypted: false };
  }

  var email = String(recipientEmail || "").trim();
  if (!email || email.indexOf("@") < 0) {
    var session = getWorkspaceSession_() || {};
    email = String(session.email || "").trim();
  }
  if (!email || email.indexOf("@") < 0) {
    return {
      ok: false,
      error:
        "Signed-in email missing. Sign out and sign in again, then retry Encrypt & send.",
      text: out,
    };
  }

  var replaced = 0;
  var guard = 0;
  while (guard++ < 12) {
    var span = extractSdsCipherSpan_(out);
    if (!span) break;
    var dec = apiDecrypt_({
      email: email,
      messageCipherText: span.cipher,
      token: authToken,
    });
    if (!dec.ok) {
      return {
        ok: false,
        error:
          formatDecryptError_(dec, "Could not decrypt quoted parent message.") ||
          "Could not decrypt quoted parent message.",
        text: out,
      };
    }
    var plain = String(dec.message || "").trim();
    if (!plain) plain = "[Decrypted message was empty]";
    var after = out.slice(span.end);
    // Prevent "test" + "sdmeta…" → "testsdmeta…"
    if (after && !/^\s/.test(after)) {
      plain = plain + "\n\n";
    } else if (after && /^\s*sdmeta\./i.test(after.replace(/^\s+/, ""))) {
      plain = plain + "\n\n";
    } else if (!/\n$/.test(plain) && /^\s*\n?\s*sdmeta\./i.test(after)) {
      plain = plain + "\n\n";
    }
    out = out.slice(0, span.start) + plain + out.slice(span.end);
    replaced += 1;
  }

  return { ok: true, text: out, decrypted: replaced > 0 };
}

/** Remove SecureDoc metadata blocks from plaintext (old recipient meta must not be forwarded). */
function stripSecureDocMetadataBlock_(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/sdmeta\.v1\.[A-Za-z0-9_-]+/gi, "")
    .replace(/^\s*email:\s*enc:v1:\S+\s*$/gim, "")
    .replace(/^\s*uuid:\s*uid:v1:\S+\s*$/gim, "")
    .replace(/^\s*email:\s*$/gim, "")
    .replace(/^\s*uuid:\s*$/gim, "")
    .replace(/^\s*Metadata\s*$/gim, "")
    .replace(/^\s*error:\s*.+$/gim, "")
    .replace(/To know more, visit our website:\s*https?:\/\/\S+/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * From a decrypted forward/reply quote, keep the human message only
 * (drop Gmail "On … wrote:" / forwarded headers when possible).
 */
function extractForwardPlainMessage_(text) {
  var t = stripSecureDocMetadataBlock_(text);
  if (!t) return "";

  // Drop leading Gmail quote attribution line, keep body after it.
  var onWrote = /^(On .+wrote:\s*)/i.exec(t);
  if (onWrote) {
    t = t.slice(onWrote[0].length).trim();
  }
  t = t
    .replace(/^[-_]{5,}\s*Forwarded message\s*[-_]{5,}\s*/i, "")
    .replace(/^Begin forwarded message:\s*/i, "")
    .replace(/^[-_]{5,}\s*Original Message\s*[-_]{5,}\s*/i, "")
    .replace(/^From:\s.+\nDate:\s.+\nSubject:\s.+\nTo:\s.+\n+/i, "")
    .trim();

  // Quoted lines starting with ">"
  if (/^>/m.test(t) && t.split("\n").every(function (line) {
    return !String(line).trim() || /^\s*>/.test(line);
  })) {
    t = t
      .split("\n")
      .map(function (line) {
        return String(line).replace(/^\s*>\s?/, "");
      })
      .join("\n")
      .trim();
  }

  return stripSecureDocMetadataBlock_(t);
}
