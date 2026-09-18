function onCardToggleAuthMode_(e) {
  var params = (e && e.parameters) || {};
  var next = params.authMode === "signup" ? "signup" : "login";
  setCardAuthMode_(next);
  PropertiesService.getUserProperties().deleteProperty("SDS_CARD_OTP_SENT");
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildMainCard_(e)))
    .build();
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
  var url = buildGoogleSsoLaunchUrl_(isSignup ? "signup" : "login", true);
  if (!url) {
    return notify_("Web app not deployed — cannot open Google sign-in.");
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
  var email = String(form.login_email || "").trim();
  if (!email) return notify_("Enter email first.");
  var terms = form.accept_terms;
  var accepted =
    terms === "yes" ||
    (Array.isArray(terms) && terms.indexOf("yes") >= 0);
  if (!accepted) {
    return notify_("Accept Terms & Conditions to sign up.");
  }
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
  var email = String(form.login_email || "").trim();
  var password = String(form.login_password || "");
  var mode = getCardAuthMode_(e);
  var isSignup = mode === "signup";

  if (!email || !password) {
    return notify_("Email and password are required.");
  }

  if (isSignup) {
    var terms = form.accept_terms;
    var accepted =
      terms === "yes" ||
      (Array.isArray(terms) && terms.indexOf("yes") >= 0);
    if (!accepted) {
      return notify_("Accept Terms & Conditions to sign up.");
    }

    var otpSent =
      PropertiesService.getUserProperties().getProperty("SDS_CARD_OTP_SENT") ===
      "1";
    if (!otpSent) {
      var send = apiSignupSendOtp_(email, true);
      if (!send.ok) return notify_(send.error || "Could not send code.");
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

  var nextCard = buildGmailMessageCard_(e);
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(nextCard))
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
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildMainCard_(e)))
    .setNotification(CardService.newNotification().setText("Signed out."))
    .build();
}

function onCardEncrypt_(e) {
  var form = (e && e.formInput) || {};
  var to = String(form.encrypt_to || "").trim();
  var subject = String(form.encrypt_subject || "").trim();
  var message = String(form.encrypt_message || "");

  if (!to) return notify_("Recipient email is required.");
  if (!String(message || "").trim()) return notify_("Message is required.");

  var gate = verifyLoginAndSubscription_();
  if (!gate.ok) {
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().updateCard(buildMainCard_(e)))
      .setNotification(
        CardService.newNotification().setText(
          gate.error || "Login / subscription required."
        )
      )
      .build();
  }

  var enc = apiEncrypt_(to, subject, message, gate.token);
  if (!enc.ok) return notify_(enc.error || "Encrypt failed.");

  var cipher = enc.messageCipherText || "";
  var meta = enc.mailMetadata || null;
  var metaToken = (meta && meta.token) || "";
  var metaText = (meta && meta.textBlock) || "";
  var section = CardService.newCardSection()
    .addWidget(
      CardService.newTextParagraph().setText(
        "✔ Encrypted. Copy this ciphertext into your Gmail message, then Send."
      )
    )
    .addWidget(
      CardService.newTextInput()
        .setFieldName("cipher_out")
        .setTitle("Ciphertext")
        .setMultiline(true)
        .setValue(cipher)
    );

  if (metaToken || metaText) {
    section.addWidget(
      CardService.newTextParagraph().setText(
        "Also paste the Metadata section below into the same mail (required for admin lookup)."
      )
    );
    section.addWidget(
      CardService.newTextInput()
        .setFieldName("meta_out")
        .setTitle("Metadata")
        .setMultiline(true)
        .setValue(metaText || metaToken)
    );
  }

  section.addWidget(
    CardService.newTextButton()
      .setText("Back")
      .setOnClickAction(
        CardService.newAction().setFunctionName("onCardBack_")
      )
  );

  var card = CardService.newCardBuilder()
    .setHeader(cardHeader_("Encrypted", "Copy into Gmail"))
    .addSection(section)
    .build();

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(card))
    .build();
}

function onCardDecrypt_(e) {
  var form = (e && e.formInput) || {};
  var cipher = String(form.decrypt_cipher || "").trim();
  if (!cipher) {
    try {
      cipher = extractCipherFromMessage_(e) || "";
    } catch (err) {}
  }
  if (!cipher) return notify_("Paste ciphertext first.");

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
  var dec = apiDecrypt_({
    email: email,
    messageCipherText: cipher,
    token: valid.session.token,
  });
  if (!dec.ok) return notify_(dec.error || "Decrypt failed.");

  var section = CardService.newCardSection().addWidget(
    CardService.newTextParagraph().setText(
      dec.message || "(No message text returned)"
    )
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
    .build();
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

  var tokenRes = apiGmailSendToken_(gate.token);
  if (!tokenRes.ok || !tokenRes.accessToken) {
    return {
      ok: false,
      error:
        tokenRes.error ||
        "Allow Gmail once in the Chrome extension (read + send), then try again.",
      code: tokenRes.code || "GMAIL_NOT_CONNECTED",
    };
  }

  var payload = resolveComposeEncryptPayload_(e, tokenRes.accessToken);
  if (!payload.firstTo) {
    return {
      ok: false,
      error:
        "Add a recipient in To, wait for Gmail autosave, then try again.",
    };
  }
  if (!String(payload.message || "").trim()) {
    return {
      ok: false,
      error:
        (payload.matched && payload.matched.error) ||
        "No draft body found. Type your message, wait for autosave, then try again.",
    };
  }

  var enc = apiEncrypt_(
    payload.firstTo,
    payload.subject,
    payload.message,
    gate.token
  );
  if (!enc.ok) {
    return { ok: false, error: enc.error || "Encrypt failed." };
  }

  var cipher = enc.messageCipherText || "";
  var meta = enc.mailMetadata || null;
  var bodyHtml = buildSecureComposeBodyHtml_(cipher, meta, payload.firstTo);
  var bodyText = buildSecureComposeBodyText_(cipher, meta, payload.firstTo);
  var toHeader = payload.toJoined || payload.firstTo;
  var subject = payload.subject || "Secure document";

  var sent = false;
  var sendErr = "";
  var sendRes = gmailMessagesSendWithToken_(tokenRes.accessToken, {
    from: tokenRes.from || "",
    to: toHeader,
    subject: subject,
    html: bodyHtml,
    text: bodyText,
  });
  if (sendRes.ok) {
    sent = true;
  } else {
    sendErr = sendRes.error || "Send failed.";
  }

  return {
    ok: true,
    sent: sent,
    sendError: sendErr,
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
            "Encrypts this draft, replaces the compose body, and sends."
          )
        )
        .addWidget(
          CardService.newButtonSet().addButton(
            CardService.newTextButton()
              .setText("Encrypt & update compose")
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

function onComposeEncryptAndSend_(e) {
  var result = runComposeEncryptAndSendCore_(e);

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

  if (!result.ok) {
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
          result.sendError ||
            "Encrypted but send failed. Allow Gmail in the Chrome extension."
        )
      )
      .build();
  }

  var updateBuilder = CardService.newUpdateDraftActionResponseBuilder()
    .setUpdateDraftBodyAction(
      CardService.newUpdateDraftBodyAction()
        .addUpdateContent(
          result.bodyHtml || "",
          CardService.ContentType.MUTABLE_HTML
        )
        .setUpdateType(CardService.UpdateDraftBodyType.IN_PLACE_INSERT)
    );

  if (result.subject) {
    updateBuilder.setUpdateDraftSubjectAction(
      CardService.newUpdateDraftSubjectAction().addUpdateSubject(result.subject)
    );
  }

  try {
    if (result.firstTo) {
      updateBuilder.setUpdateDraftToRecipientsAction(
        CardService.newUpdateDraftToRecipientsAction().addUpdateToRecipients([
          result.firstTo,
        ])
      );
    }
  } catch (eTo) {}

  return updateBuilder.build();
}

function buildSecureComposeBodyHtml_(cipher, meta) {
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

  parts.push("</div>");
  return parts.join("");
}
