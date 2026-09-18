const ADMIN_URL = "https://admin-panel-amber-nine.vercel.app";
const API_BASE = "https://server-nine-rosy.vercel.app/api";
const SESSION_KEY = "SDS_WORKSPACE_SESSION";
const WEB_APP_DEPLOYMENT_ID =
  "AKfycbzCvUVD8GnLvsGNpux6euGd2WJrYUmGXEE3qp-NK-emFZSFAvN5dPOkIumQLmgcm5RRVA";
const WEB_APP_URL =
  "https://script.google.com/macros/s/" + WEB_APP_DEPLOYMENT_ID + "/exec";

function onHomepage(e) {
  return buildMainCard_(e);
}

function onGmailHomepage(e) {
  return buildMainCard_(e);
}

function onGmailMessage(e) {
  return buildGmailMessageCard_(e);
}

function onGmailCompose(e) {
  return buildComposeDirectCard_(e);
}

function cardHeader_(title, subtitle) {
  return CardService.newCardHeader()
    .setTitle(title || "SecureDocShare")
    .setSubtitle(subtitle || "Encrypt · Decrypt · Secure mail");
}

function statusRow_(text, ok) {
  return CardService.newDecoratedText()
    .setText(String(text || ""))
    .setWrapText(true)
    .setStartIcon(
      CardService.newIconImage().setIconUrl(
        ok
          ? "https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/check_circle/default/24px.svg"
          : "https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/error/default/24px.svg"
      )
    );
}

function infoRow_(title, text) {
  return CardService.newDecoratedText()
    .setTopLabel(String(title || ""))
    .setText(String(text || ""))
    .setWrapText(true)
    .setStartIcon(
      CardService.newIconImage().setIconUrl(
        "https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/info/default/24px.svg"
      )
    );
}

function primaryBtn_(label, fnName) {
  return CardService.newTextButton()
    .setText(label)
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setOnClickAction(CardService.newAction().setFunctionName(fnName));
}

function secondaryBtn_(label, fnName) {
  return CardService.newTextButton()
    .setText(label)
    .setOnClickAction(CardService.newAction().setFunctionName(fnName));
}

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
  card.addSection(buildEncryptSection_());
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
 * Account section — same options as Chrome extension:
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

  var googleUrl = buildGoogleOAuthStartUrl_(
    isSignup ? "signup" : "login",
    true
  );
  if (googleUrl) {
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
  }

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

function buildGoogleOAuthStartUrl_(intent, acceptTerms) {
  // Deprecated for cards — use buildGoogleSsoLaunchUrl_ (popup launcher).
  return buildGoogleSsoLaunchUrl_(intent, acceptTerms);
}

/** Opens Workspace web app which starts Google SSO in a popup (not full-page). */
function buildGoogleSsoLaunchUrl_(intent, acceptTerms) {
  var web = getWebAppUrl_();
  if (!web || String(web).indexOf("http") !== 0) return "";
  var qs =
    "sso=google" +
    "&intent=" +
    encodeURIComponent(intent === "signup" ? "signup" : "login");
  if (intent === "signup") {
    qs += "&acceptTerms=" + (acceptTerms ? "1" : "0");
  }
  return String(web).split("?")[0] + "?" + qs;
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

function buildEncryptSection_() {
  var web = buildComposeMailboxUrl_();
  var section = CardService.newCardSection()
    .setHeader("Encrypt")
    .setCollapsible(true)
    .setNumUncollapsibleWidgets(1)
    .addWidget(
      infoRow_(
        "Encrypt message",
        "Enter recipient, subject, and message. To attach a file, use Attach file (Gmail cards cannot pick files directly)."
      )
    )
    .addWidget(
      CardService.newTextInput()
        .setFieldName("encrypt_to")
        .setTitle("Recipient email")
        .setHint("recipient@email.com")
    )
    .addWidget(
      CardService.newTextInput().setFieldName("encrypt_subject").setTitle("Subject")
    )
    .addWidget(
      CardService.newTextInput()
        .setFieldName("encrypt_message")
        .setTitle("Message")
        .setMultiline(true)
    );

  // File pick is only possible in HtmlService compose (not Card widgets).
  if (web) {
    section.addWidget(
      CardService.newButtonSet().addButton(
        CardService.newTextButton()
          .setText("Attach file…")
          .setTextButtonStyle(CardService.TextButtonStyle.OUTLINED)
          .setOpenLink(openComposeInAppLink_(web))
      )
    );
  }

  section.addWidget(
    CardService.newButtonSet().addButton(
      primaryBtn_("Encrypt message", "onCardEncrypt_")
    )
  );

  return section;
}

/** Open HtmlService compose as in-Gmail overlay (contacts chips UI). */
function openComposeInAppLink_(url) {
  return CardService.newOpenLink()
    .setUrl(String(url))
    .setOpenAs(CardService.OpenAs.OVERLAY)
    .setOnClose(CardService.OnClose.RELOAD_ADD_ON);
}

/** Compose modal URL with one-time session ticket. */
function buildComposeMailboxUrl_() {
  var web = getWebAppUrl_();
  if (!web || String(web).indexOf("http") !== 0) return "";
  var base = String(web).split("?")[0] + "?view=compose&embed=1";
  var session = getWorkspaceSession_();
  if (!session || !session.token) return base;
  try {
    var ticket = Utilities.getUuid();
    CacheService.getScriptCache().put(
      "sds_compose_" + ticket,
      JSON.stringify({
        token: String(session.token),
        email: String(session.email || ""),
        expiresAt: session.expiresAt || null,
      }),
      300
    );
    return base + "&compose_ticket=" + encodeURIComponent(ticket);
  } catch (eTicket) {
    return base;
  }
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

/** Decrypt secure attachments on demand and show download links. */
function onHomeDownloadPdf_(e) {
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
    return notify_("No secure attachment found on this mail.");
  }

  var email = auth.email || session.email || "";
  var section = CardService.newCardSection().setHeader("Downloads");
  var readyCount = 0;
  var i;
  for (i = 0; i < scan.attachments.length; i++) {
    var att = scan.attachments[i];
    var fileDec = apiDecrypt_({
      email: email,
      fileCipherText: att.base64,
      token: session.token,
    });
    if (!fileDec.ok) {
      section.addWidget(
        statusRow_(
          (att.name || "file") + ": " + (fileDec.error || "decrypt failed"),
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
    if (!dataB64) continue;

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
      section.addWidget(
        statusRow_(
          meta.name + ": " + (ready.error || "download not ready"),
          false
        )
      );
    }
  }

  var card = CardService.newCardBuilder()
    .setHeader(cardHeader_("SecureDocShare", "Downloads"))
    .addSection(section)
    .addSection(
      CardService.newCardSection().addWidget(
        CardService.newButtonSet().addButton(
          secondaryBtn_("Back", "onCardBack_")
        )
      )
    )
    .build();

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(card))
    .setNotification(
      CardService.newNotification().setText(
        readyCount
          ? readyCount + " file(s) ready to download."
          : "Could not prepare downloads."
      )
    )
    .build();
}

/**
 * Auto-decrypt mode for an open Gmail message (message body + attachments).
 */
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

  var foundBits = [];
  if (scan.cipher) foundBits.push("encrypted message");
  if (scan.attachments && scan.attachments.length) {
    foundBits.push(scan.attachments.length + " secure attachment(s)");
  }
  statusSection.addWidget(
    statusRow_("Detected: " + foundBits.join(" + "), true)
  );

  if (scan.cipher) {
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
      messageSection.addWidget(
        statusRow_(
          "Message decrypt failed: " + (msgDec.error || "unknown error"),
          false
        )
      );
    }
  }

  var i;
  for (i = 0; i < (scan.attachments || []).length; i++) {
    var att = scan.attachments[i];
    var fileDec = apiDecrypt_({
      email: email,
      fileCipherText: att.base64,
      token: session.token,
    });
    if (!fileDec.ok) {
      hasFileUi = true;
      filesSection.addWidget(
        statusRow_(
          (att.name || "attachment") +
            " — " +
            (fileDec.error || "decrypt failed"),
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
        filesSection.addWidget(
          statusRow_(
            meta.name + ": " + (ready.error || "download not ready"),
            false
          )
        );
      }
    }
  }

  var builder = CardService.newCardBuilder().setHeader(
    cardHeader_("SecureDocShare", "Decrypted")
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
    email: sub.email || session.email,
    subscriptionActive: true,
  };
}

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

/** Exposed to HtmlService: return current user's OAuth token for People API. */
function getWorkspaceOAuthToken() {
  return ScriptApp.getOAuthToken();
}

/**
 * Search Contacts + Other contacts (same endpoints as Chrome extension).
 * @param {string} query
 * @returns {{ok:boolean, results:Array<{email:string,name:string}>, error?:string, code?:string}}
 */
function searchWorkspaceContacts(query) {
  try {
    return searchWorkspaceContacts_(String(query || ""));
  } catch (err) {
    return {
      ok: false,
      results: [],
      error: String(err && err.message ? err.message : err),
      code: "CONTACTS_SEARCH_FAILED",
    };
  }
}

function searchWorkspaceContacts_(query) {
  var q = String(query || "").trim();
  if (q.length < 2) {
    return { ok: true, results: [] };
  }

  var token = ScriptApp.getOAuthToken();
  var mask = "names,emailAddresses";
  var encoded = encodeURIComponent(q);
  var maskEnc = encodeURIComponent(mask);

  // Warmup (Google requires empty query once per session for freshness).
  try {
    UrlFetchApp.fetch(
      "https://people.googleapis.com/v1/people:searchContacts?query=&readMask=" +
        maskEnc +
        "&pageSize=1",
      {
        method: "get",
        headers: { Authorization: "Bearer " + token },
        muteHttpExceptions: true,
      }
    );
    UrlFetchApp.fetch(
      "https://people.googleapis.com/v1/otherContacts:search?query=&readMask=" +
        maskEnc +
        "&pageSize=1",
      {
        method: "get",
        headers: { Authorization: "Bearer " + token },
        muteHttpExceptions: true,
      }
    );
  } catch (eWarm) {}

  var urls = [
    "https://people.googleapis.com/v1/people:searchContacts?query=" +
      encoded +
      "&readMask=" +
      maskEnc +
      "&pageSize=30",
    "https://people.googleapis.com/v1/otherContacts:search?query=" +
      encoded +
      "&readMask=" +
      maskEnc +
      "&pageSize=30",
  ];

  var results = [];
  var lastError = null;
  var scopeError = false;
  var disabledError = false;

  for (var i = 0; i < urls.length; i++) {
    var res = UrlFetchApp.fetch(urls[i], {
      method: "get",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json",
      },
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    var text = res.getContentText() || "";
    var data = {};
    try {
      data = JSON.parse(text || "{}");
    } catch (eParse) {}

    if (code < 200 || code >= 300) {
      var msg = String(
        (data.error && data.error.message) || text || "HTTP " + code
      );
      lastError = msg;
      if (
        /has not been used|is disabled|API has not been|SERVICE_DISABLED/i.test(
          msg
        )
      ) {
        disabledError = true;
      }
      if (
        code === 401 ||
        code === 403 ||
        /insufficient|ACCESS_TOKEN_SCOPE|authentication scopes/i.test(msg)
      ) {
        scopeError = true;
      }
      continue;
    }

    var rows = data.results || [];
    for (var r = 0; r < rows.length; r++) {
      var person = rows[r].person || rows[r] || {};
      var name =
        (person.names &&
          person.names[0] &&
          (person.names[0].displayName ||
            person.names[0].unstructuredName)) ||
        "";
      var emails = person.emailAddresses || [];
      for (var e = 0; e < emails.length; e++) {
        var email = String(emails[e].value || "")
          .trim()
          .toLowerCase();
        if (email.indexOf("@") < 0) continue;
        results.push({
          email: email,
          name: name || email.split("@")[0],
        });
      }
    }
  }

  var deduped = [];
  var seen = {};
  for (var d = 0; d < results.length; d++) {
    var key = results[d].email;
    if (seen[key]) continue;
    seen[key] = true;
    deduped.push(results[d]);
  }

  if (!deduped.length && lastError) {
    if (disabledError) {
      return {
        ok: false,
        results: [],
        error:
          "People API is disabled. Enable “People API” in Google Cloud Console, then try again.",
        code: "PEOPLE_API_DISABLED",
      };
    }
    if (scopeError) {
      return {
        ok: false,
        results: [],
        error:
          "Google Contacts permission missing. Re-authorize the Workspace app and allow Contacts access.",
        code: "CONTACTS_SCOPE_REQUIRED",
      };
    }
    return {
      ok: false,
      results: [],
      error: lastError,
      code: "PEOPLE_API_ERROR",
    };
  }

  return { ok: true, results: deduped };
}

function gmailApiRequest_(method, path, body, accessToken) {
  try {
    const token = accessToken || "";
    if (!token) {
      return {
        ok: false,
        code: 401,
        error: "Gmail access token missing. Allow Gmail in the Chrome extension.",
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
      ? " Re-Allow Gmail in the Chrome extension (needs mail read + send)."
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
      continue;
    } else {
      score += 1;
    }

    if (subjectWant && String(subj || "").trim().toLowerCase() === subjectWant) {
      score += 5;
    }

    const candidate = {
      ok: true,
      draftId: draftObj.id || id,
      messageId: msg.id || "",
      toHeader: toHdr,
      toEmails: draftTos.length ? draftTos : targets,
      subject: subj || "",
      body: extractMessagePlainBody_(payload),
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

function buildSecureComposeBodyText_(cipher, meta) {
  const lines = [String(cipher || "").replace(/\s+/g, "")];
  if (meta && (meta.token || meta.emailEnc || meta.uuidEnc)) {
    lines.push("");
    if (meta.token) lines.push(String(meta.token).replace(/\s+/g, ""));
    if (meta.emailEnc) lines.push("email: " + meta.emailEnc);
    if (meta.uuidEnc) lines.push("uuid: " + meta.uuidEnc);
  }
  return lines.join("\n");
}

function getGmailMessage_(e) {
  if (!e || !e.gmail) return null;
  var accessToken = e.gmail.accessToken;
  var messageId = e.gmail.messageId;
  if (!accessToken || !messageId) return null;
  GmailApp.setCurrentMessageAccessToken(accessToken);
  return GmailApp.getMessageById(messageId);
}

function scanMessageForSecureDoc_(e) {
  var out = { cipher: "", attachments: [] };
  try {
    var msg = getGmailMessage_(e);
    if (!msg) return out;
    var body = msg.getPlainBody() || msg.getBody() || "";
    out.cipher = extractSdsCipher_(body) || "";

    var atts = [];
    try {
      atts =
        msg.getAttachments({
          includeInlineImages: false,
          includeAttachments: true,
        }) || [];
    } catch (attErr) {
      atts = msg.getAttachments() || [];
    }
    var i;
    for (i = 0; i < atts.length; i++) {
      var name = String(atts[i].getName() || "");
      var lower = name.toLowerCase();
      var bytes = atts[i].getBytes();
      var isSecureName = /\.secure[a-z0-9]+$/i.test(lower);
      var b0 = bytes && bytes.length >= 4 ? bytes[0] & 0xff : 0;
      var b1 = bytes && bytes.length >= 4 ? bytes[1] & 0xff : 0;
      var b2 = bytes && bytes.length >= 4 ? bytes[2] & 0xff : 0;
      var b3 = bytes && bytes.length >= 4 ? bytes[3] & 0xff : 0;
      var isSdsb = b0 === 0x53 && b1 === 0x44 && b2 === 0x53 && b3 === 0x42;
      if (isSecureName || isSdsb) {
        out.attachments.push({
          name: name || "encrypted.securefile",
          base64: Utilities.base64Encode(bytes),
        });
      }
    }
  } catch (err) {
    console.error("scanMessageForSecureDoc_", err);
  }
  return out;
}

function extractCipherFromMessage_(e) {
  return scanMessageForSecureDoc_(e).cipher || "";
}

function extractSdsCipher_(text) {
  var raw = String(text || "");
  var match = /sds\./i.exec(raw);
  if (!match) return "";

  var i = match.index + 4;
  var b64 = "";
  while (i < raw.length) {
    var ch = raw.charAt(i);
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[A-Za-z0-9+/_\-]/.test(ch)) {
      b64 += ch;
      i += 1;
      continue;
    }
    if (ch === "=") {
      b64 += "=";
      i += 1;
      while (i < raw.length && /\s/.test(raw.charAt(i))) i += 1;
      if (raw.charAt(i) === "=") b64 += "=";
      break;
    }
    break;
  }

  if (b64.length < 8) return "";
  return "sds." + b64;
}

/**
 * Show ~4 lines in the card. "Show full message" downloads a .txt file
 * with the complete decrypted message (same download flow as PDF).
 */
function addDecryptedMessagePreview_(section, fieldName, title, fullText) {
  var preview = previewFourLines_(fullText);
  section.addWidget(
    CardService.newTextInput()
      .setFieldName(fieldName)
      .setTitle(title + " (first 4 lines)")
      .setMultiline(true)
      .setValue(preview)
  );

  var ready = prepareFullMessageTxtDownload_(fullText);
  if (ready.ok && ready.downloadUrl) {
    section.addWidget(
      CardService.newButtonSet().addButton(
        CardService.newTextButton()
          .setText("Show full message (.txt)")
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
    section.addWidget(
      infoRow_(
        "Full message",
        ready.error || "Could not prepare message download."
      )
    );
  }
}

function previewFourLines_(text) {
  var s = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  var lines = s.split("\n");
  if (lines.length <= 4) {
    if (s.length <= 280) return s;
    return s.substring(0, 280) + "…";
  }
  return lines.slice(0, 4).join("\n") + "\n…";
}

/**
 * Build a .txt file from the full decrypted message and stage it for download.
 */
function prepareFullMessageTxtDownload_(fullText) {
  var text = String(fullText || "");
  if (!text) {
    return { ok: false, error: "Empty message", downloadUrl: "" };
  }

  // Strip HTML to plain text for the .txt file.
  if (/<\/?[a-z][\s\S]*>/i.test(text)) {
    text = text
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/\s*p\s*>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  var stamp = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone() || "UTC",
    "yyyyMMdd-HHmmss"
  );
  var filename = "securedoc-message-" + stamp + ".txt";
  var b64 = Utilities.base64Encode(text);
  return prepareDecryptedDownload_(filename, "text/plain;charset=utf-8", b64);
}

/**
 * Restore decrypted file to original name/mime (do not force .pdf).
 */

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
