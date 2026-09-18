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
  var bodyHtml = buildSecureComposeBodyHtml_(cipher, meta);
  var bodyText = buildSecureComposeBodyText_(cipher, meta);
  var toHeader = payload.toJoined || payload.firstTo;
  var subject = payload.subject || "Secure document";
  var oldDraftId =
    payload.matched && payload.matched.ok ? payload.matched.draftId || "" : "";

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
