/** Valid session or null (clears expired tokens → login screen). */
function getValidWorkspaceAuth_() {
  var session = getWorkspaceSession_();
  if (!session || !session.token) return null;
  var auth = apiGetSubscription_(session.token);
  if (!auth || !auth.ok) {
    clearWorkspaceSession();
    return null;
  }
  return { session: session, auth: auth };
}

function buildGmailMessageCard_(e) {
  var valid = getValidWorkspaceAuth_();
  var scan = scanMessageForSecureDoc_(e);
  var hasSecure =
    Boolean(scan.cipher) || (scan.attachments && scan.attachments.length > 0);

  if (!valid) {
    var card = CardService.newCardBuilder().setHeader(
      cardHeader_(
        "SecureDocShare",
        hasSecure ? "Encrypted mail — sign in" : "Sign in"
      )
    );
    if (hasSecure) {
      card.addSection(
        CardService.newCardSection()
          .addWidget(
            statusRow_(
              "This mail has SecureDoc content (sds. and/or encrypted file).",
              true
            )
          )
          .addWidget(
            infoRow_("Next step", "Sign in below to decrypt and download.")
          )
      );
    }
    card.addSection(buildLoginSection_(e));
    card.addSection(buildLinksSection_());
    return card.build();
  }

  if (hasSecure) {
    return buildAutoDecryptCard_(e, valid.session, scan);
  }

  return buildMainCard_(e);
}

/** Side panel: login screen OR tools (never tools without auth). */
function buildMainCard_(e) {
  var valid = getValidWorkspaceAuth_();

  if (!valid) {
    return CardService.newCardBuilder()
      .setHeader(cardHeader_("SecureDocShare", "Sign in"))
      .addSection(buildLoginSection_(e))
      .addSection(buildLinksSection_())
      .build();
  }

  var card = CardService.newCardBuilder().setHeader(
    cardHeader_("SecureDocShare", "Ready")
  );
  card.addSection(buildSignedInSection_(valid.session, valid.auth));
  card.addSection(buildDecryptSection_(e));
  card.addSection(buildLinksSection_());
  return card.build();
}

function getCardAuthMode_(e) {
  var params = (e && e.parameters) || {};
  var form = (e && e.formInput) || {};
  if (params.authMode === "signup" || form.auth_mode === "signup") {
    return "signup";
  }
  var stored = PropertiesService.getUserProperties().getProperty(
    "SDS_CARD_AUTH_MODE"
  );
  return stored === "signup" ? "signup" : "login";
}

function setCardAuthMode_(mode) {
  PropertiesService.getUserProperties().setProperty(
    "SDS_CARD_AUTH_MODE",
    mode === "signup" ? "signup" : "login"
  );
}

/**
 * Account section — login / signup options:

 * Log in / Sign up, email+password, OTP on signup, Continue with Google.
 */
function buildLoginSection_(e) {
  var mode = getCardAuthMode_(e);
  var isSignup = mode === "signup";
  var otpSent =
    PropertiesService.getUserProperties().getProperty("SDS_CARD_OTP_SENT") ===
    "1";

  var section = CardService.newCardSection().setHeader("Account");

  section.addWidget(
    CardService.newTextParagraph().setText(
      isSignup ? "<b>Sign up</b>" : "<b>Log in</b>"
    )
  );

  section
    .addWidget(
      CardService.newTextInput()
        .setFieldName("login_email")
        .setTitle("Email")
        .setHint("you@company.com")
    )
    .addWidget(
      CardService.newTextInput()
        .setFieldName("login_password")
        .setTitle("Password")
    );

  if (isSignup) {
    section.addWidget(
      CardService.newSelectionInput()
        .setType(CardService.SelectionInputType.CHECK_BOX)
        .setFieldName("accept_terms")
        .addItem("I agree to the Terms & Conditions", "yes", false)
    );
  }

  if (isSignup && otpSent) {
    section.addWidget(
      CardService.newTextInput()
        .setFieldName("signup_otp")
        .setTitle("4-digit verification code")
        .setHint("••••")
    );
    section.addWidget(
      CardService.newButtonSet().addButton(
        secondaryBtn_("Resend code", "onCardResendOtp_")
      )
    );
  }

  var primaryLabel = isSignup
    ? otpSent
      ? "Verify & sign up"
      : "Send verification code"
    : "Log in";

  section.addWidget(
    CardService.newButtonSet().addButton(
      primaryBtn_(primaryLabel, "onCardLogin_")
    )
  );

  section.addWidget(
    CardService.newButtonSet().addButton(
      CardService.newTextButton()
        .setText("Continue with Google")
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setOnClickAction(
          CardService.newAction().setFunctionName("onCardGoogleSignIn_")
        )
    )
  );

  section.addWidget(
    CardService.newButtonSet().addButton(
      CardService.newTextButton()
        .setText(
          isSignup
            ? "Already have an account? Log in"
            : "Need an account? Sign up"
        )
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName("onCardToggleAuthMode_")
            .setParameters({ authMode: isSignup ? "login" : "signup" })
        )
    )
  );

 

  return section;
}

function buildSignedInSection_(session, prefetchedAuth) {
  var subLine = "Checking subscription…";
  var check =
    prefetchedAuth && typeof prefetchedAuth.ok === "boolean"
      ? prefetchedAuth
      : apiGetSubscription_(session.token);
  var ok = false;
  if (check.ok) {
    ok = Boolean(check.subscriptionActive);
    subLine = ok ? "Subscription active" : "Subscription inactive";
  }

  return CardService.newCardSection()
    .setHeader("Account")
    .addWidget(
      CardService.newDecoratedText()
        .setTopLabel("Signed in")
        .setText(String(session.email || "user"))
        .setBottomLabel(subLine)
        .setWrapText(true)
        .setStartIcon(
          CardService.newIconImage().setIconUrl(
            ok
              ? "https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/verified_user/default/24px.svg"
              : "https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/person/default/24px.svg"
          )
        )
    )
    .addWidget(
      CardService.newButtonSet()
        .addButton(secondaryBtn_("Refresh", "onCardBack_"))
        .addButton(secondaryBtn_("Sign out", "onCardLogout_"))
    );
}

function buildDecryptSection_(e) {
  var detected = "";
  var scan = { cipher: "", attachments: [] };
  try {
    scan = scanMessageForSecureDoc_(e) || scan;
    detected = scan.cipher || "";
  } catch (err) {
    detected = "";
  }

  var section = CardService.newCardSection()
    .setHeader("Decrypt")
    .setCollapsible(true)
    .setNumUncollapsibleWidgets(1);

  if (detected) {
    section.addWidget(
      statusRow_("Encrypted sds. message detected in this mail.", true)
    );
  } else {
    section.addWidget(
      infoRow_(
        "Manual decrypt",
        "Paste an sds. token, or open an encrypted mail for auto-decrypt."
      )
    );
  }

  section
    .addWidget(
      CardService.newTextInput()
        .setFieldName("decrypt_cipher")
        .setTitle("Message ciphertext")
        .setMultiline(true)
        .setValue(detected || "")
    )
    .addWidget(
      CardService.newButtonSet().addButton(
        primaryBtn_("Decrypt message", "onCardDecrypt_")
      )
    );

  addHomePdfDownloadWidgets_(section, e, scan);

  return section;
}

/**
 * List secure attachments and offer download — decrypt only when the user clicks.
 */
function addHomePdfDownloadWidgets_(section, e, scan) {
  var atts = (scan && scan.attachments) || [];
  if (!atts.length) {
    return;
  }

  var session = getWorkspaceSession_();
  if (!session || !session.token) {
    section.addWidget(
      infoRow_(
        "Secure attachment",
        atts.length +
          " encrypted file(s) found. Sign in, then tap Download decrypted file."
      )
    );
    return;
  }

  section.addWidget(
    statusRow_(
      atts.length + " encrypted attachment(s) ready to decrypt.",
      true
    )
  );
  section.addWidget(
    CardService.newButtonSet().addButton(
      CardService.newTextButton()
        .setText("Download decrypted file")
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setOnClickAction(
          CardService.newAction().setFunctionName("onHomeDownloadPdf_")
        )
    )
  );
}

function onHomeDownloadPdf_(e) {
  try {
    var valid = getValidWorkspaceAuth_();
    if (!valid) {
      return CardService.newActionResponseBuilder()
        .setNavigation(CardService.newNavigation().updateCard(buildMainCard_(e)))
        .setNotification(
          CardService.newNotification().setText("Sign in first to download.")
        )
        .build();
    }
    var session = valid.session;
    var auth = valid.auth;
    var scan = scanMessageForSecureDoc_(e);
    if (!scan.attachments || !scan.attachments.length) {
      return CardService.newActionResponseBuilder()
        .setNavigation(
          CardService.newNavigation().updateCard(
            buildDecryptErrorCard_("No secure attachment found on this mail.")
          )
        )
        .setNotification(
          CardService.newNotification().setText("No secure attachment found.")
        )
        .build();
    }

    var email = auth.email || session.email || "";
    if (!email) {
      return CardService.newActionResponseBuilder()
        .setNavigation(
          CardService.newNavigation().updateCard(
            buildDecryptErrorCard_(
              "Signed-in email missing. Sign out and sign in again."
            )
          )
        )
        .setNotification(
          CardService.newNotification().setText("Signed-in email missing.")
        )
        .build();
    }

    var section = CardService.newCardSection().setHeader("Downloads");
    var readyCount = 0;
    var failCount = 0;
    var i;
    for (i = 0; i < scan.attachments.length; i++) {
      var att = scan.attachments[i];
      var fileDec = apiDecrypt_({
        email: email,
        fileCipherText: att.base64,
        token: session.token,
      });
      if (!fileDec.ok) {
        failCount += 1;
        section.addWidget(
          statusRow_(
            (att.name || "file") +
              ": " +
              formatDecryptError_(fileDec, "decrypt failed"),
            false
          )
        );
        continue;
      }
      var fileInfo = fileDec.file || null;
      var dataB64 =
        (fileInfo &&
          (fileInfo.dataBase64 || fileInfo.base64 || fileInfo.data)) ||
        null;
      if (!dataB64) {
        failCount += 1;
        section.addWidget(
          statusRow_(
            (att.name || "file") +
              ": decrypt returned no file data. Try Refresh or open the mail again.",
            false
          )
        );
        continue;
      }

      var meta = normalizeDecryptedFileMeta_(
        att.name,
        fileInfo,
        fileDec.filename
      );
      var ready = prepareDecryptedDownload_(meta.name, meta.mime, dataB64);
      if (ready.ok && ready.downloadUrl) {
        readyCount += 1;
        section.addWidget(
          CardService.newDecoratedText()
            .setTopLabel("Ready")
            .setText(meta.name)
            .setBottomLabel("From " + (att.name || "secure file"))
            .setWrapText(true)
        );
        section.addWidget(
          CardService.newButtonSet().addButton(
            CardService.newTextButton()
              .setText("⬇ Download")
              .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
              .setOpenLink(
                CardService.newOpenLink()
                  .setUrl(ready.downloadUrl)
                  .setOpenAs(CardService.OpenAs.FULL_SIZE)
                  .setOnClose(CardService.OnClose.NOTHING)
              )
          )
        );
      } else {
        failCount += 1;
        section.addWidget(
          statusRow_(
            meta.name + ": " + (ready.error || "download not ready"),
            false
          )
        );
      }
    }

    var card = CardService.newCardBuilder()
      .setHeader(
        cardHeader_(
          "SecureDocShare",
          readyCount ? "Downloads" : "Decrypt failed"
        )
      )
      .addSection(section)
      .addSection(
        CardService.newCardSection().addWidget(
          CardService.newButtonSet().addButton(
            secondaryBtn_("Back", "onCardBack_")
          )
        )
      )
      .build();

    var note = readyCount
      ? readyCount + " file(s) ready to download."
      : failCount
        ? "Could not decrypt attachment(s). See error details on the card."
        : "Could not prepare downloads.";

    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().updateCard(card))
      .setNotification(CardService.newNotification().setText(note))
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

function buildAutoDecryptCard_(e, session, scan) {
  var auth = apiGetSubscription_(session.token);
  if (!auth.ok) {
    clearWorkspaceSession();
    return CardService.newCardBuilder()
      .setHeader(cardHeader_("SecureDocShare", "Session expired"))
      .addSection(
        CardService.newCardSection().addWidget(
          statusRow_(
            auth.error || "Login expired. Sign in again to decrypt.",
            false
          )
        )
      )
      .addSection(buildLoginSection_(e))
      .addSection(buildLinksSection_())
      .build();
  }

  var email = auth.email || session.email || "";
  var statusSection = CardService.newCardSection().setHeader("Status");
  var messageSection = CardService.newCardSection().setHeader("Message");
  var filesSection = CardService.newCardSection().setHeader("Files");
  var hasMessageUi = false;
  var hasFileUi = false;
  var anyFailed = false;

  if (!email) {
    statusSection.addWidget(
      statusRow_(
        "Signed-in email missing. Sign out and sign in again to decrypt.",
        false
      )
    );
    return CardService.newCardBuilder()
      .setHeader(cardHeader_("SecureDocShare", "Decrypt failed"))
      .addSection(statusSection)
      .addSection(buildSignedInSection_(session, auth))
      .addSection(
        CardService.newCardSection().addWidget(
          CardService.newButtonSet()
            .addButton(secondaryBtn_("Refresh", "onRefreshAutoDecrypt_"))
            .addButton(secondaryBtn_("Home", "onCardBack_"))
        )
      )
      .build();
  }

  var foundBits = [];
  if (scan.cipher) foundBits.push("encrypted message");
  if (scan.attachments && scan.attachments.length) {
    foundBits.push(scan.attachments.length + " secure attachment(s)");
  }
  statusSection.addWidget(
    statusRow_("Detected: " + foundBits.join(" + "), true)
  );

  if (scan.cipher) {
    try {
      var msgDec = apiDecrypt_({
        email: email,
        messageCipherText: scan.cipher,
        token: session.token,
      });
      if (msgDec.ok && msgDec.message) {
        hasMessageUi = true;
        messageSection.addWidget(statusRow_("Message decrypted", true));
        addDecryptedMessagePreview_(
          messageSection,
          "auto_plain_message",
          "Decrypted message",
          String(msgDec.message)
        );
      } else {
        hasMessageUi = true;
        anyFailed = true;
        messageSection.addWidget(
          statusRow_(
            "Message decrypt failed: " +
              formatDecryptError_(
                msgDec,
                msgDec && msgDec.ok
                  ? "no message text returned"
                  : "unknown error"
              ),
            false
          )
        );
      }
    } catch (msgErr) {
      hasMessageUi = true;
      anyFailed = true;
      messageSection.addWidget(
        statusRow_(
          "Message decrypt error: " +
            String(msgErr && msgErr.message ? msgErr.message : msgErr),
          false
        )
      );
    }
  }

  var i;
  for (i = 0; i < (scan.attachments || []).length; i++) {
    var att = scan.attachments[i];
    try {
      var fileDec = apiDecrypt_({
        email: email,
        fileCipherText: att.base64,
        token: session.token,
      });
      if (!fileDec.ok) {
        hasFileUi = true;
        anyFailed = true;
        filesSection.addWidget(
          statusRow_(
            (att.name || "attachment") +
              " — " +
              formatDecryptError_(fileDec, "decrypt failed"),
            false
          )
        );
        continue;
      }

      if (fileDec.message) {
        hasFileUi = true;
        filesSection.addWidget(
          statusRow_("Attachment included message text", true)
        );
        addDecryptedMessagePreview_(
          filesSection,
          "auto_att_msg_" + i,
          "From " + (att.name || "attachment"),
          String(fileDec.message)
        );
      }

      var fileInfo = fileDec.file || null;
      var dataB64 =
        (fileInfo &&
          (fileInfo.dataBase64 || fileInfo.base64 || fileInfo.data)) ||
        null;
      if (dataB64) {
        hasFileUi = true;
        var meta = normalizeDecryptedFileMeta_(
          att.name,
          fileInfo,
          fileDec.filename
        );
        var ready = prepareDecryptedDownload_(meta.name, meta.mime, dataB64);
        if (ready.ok && ready.downloadUrl) {
          filesSection.addWidget(
            CardService.newDecoratedText()
              .setTopLabel("File ready")
              .setText(meta.name)
              .setBottomLabel("From " + (att.name || "secure file"))
              .setWrapText(true)
          );
          filesSection.addWidget(
            CardService.newButtonSet().addButton(
              CardService.newTextButton()
                .setText("⬇ Download")
                .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
                .setOpenLink(
                  CardService.newOpenLink()
                    .setUrl(ready.downloadUrl)
                    .setOpenAs(CardService.OpenAs.FULL_SIZE)
                    .setOnClose(CardService.OnClose.NOTHING)
                )
            )
          );
        } else {
          anyFailed = true;
          filesSection.addWidget(
            statusRow_(
              meta.name + ": " + (ready.error || "download not ready"),
              false
            )
          );
        }
      } else if (!fileDec.message) {
        hasFileUi = true;
        anyFailed = true;
        filesSection.addWidget(
          statusRow_(
            (att.name || "attachment") +
              " — decrypt returned no file data.",
            false
          )
        );
      }
    } catch (fileErr) {
      hasFileUi = true;
      anyFailed = true;
      filesSection.addWidget(
        statusRow_(
          (att.name || "attachment") +
            " — " +
            String(fileErr && fileErr.message ? fileErr.message : fileErr),
          false
        )
      );
    }
  }

  if (anyFailed) {
    statusSection.addWidget(
      statusRow_(
        "One or more items could not be decrypted. See details below.",
        false
      )
    );
  }

  var builder = CardService.newCardBuilder().setHeader(
    cardHeader_(
      "SecureDocShare",
      anyFailed && !hasMessageUi && !hasFileUi
        ? "Decrypt failed"
        : anyFailed
          ? "Decrypted with errors"
          : "Decrypted"
    )
  );
  builder.addSection(statusSection);
  if (hasMessageUi) builder.addSection(messageSection);
  if (hasFileUi) builder.addSection(filesSection);
  builder.addSection(buildSignedInSection_(session, auth));
  builder.addSection(
    CardService.newCardSection().addWidget(
      CardService.newButtonSet()
        .addButton(secondaryBtn_("Refresh", "onRefreshAutoDecrypt_"))
        .addButton(secondaryBtn_("Home", "onCardBack_"))
    )
  );
  builder.addSection(buildLinksSection_());
  return builder.build();
}

function onRefreshAutoDecrypt_(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildGmailMessageCard_(e)))
    .build();
}

function buildLinksSection_() {
  return CardService.newCardSection()
    .setHeader("More")
    .addWidget(
      CardService.newTextButton()
        .setText("Open admin panel")
        .setOpenLink(
          CardService.newOpenLink()
            .setUrl(ADMIN_URL)
            .setOpenAs(CardService.OpenAs.FULL_SIZE)
            .setOnClose(CardService.OnClose.NOTHING)
        )
    );
}
