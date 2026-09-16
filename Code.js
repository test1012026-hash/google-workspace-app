/**
 * SecureDocShare — Gmail add-on cards (Outlook-style login / encrypt / decrypt)
 * + HtmlService Web app for full Encrypt-and-send with file upload.
 *
 * Decrypt mode (Outlook-like):
 * - If open mail contains sds. → auto-decrypt message
 * - If open mail has .securepdf / .securemsg → auto-decrypt + interactive download UI
 *
 * Homepage / message triggers must return a single built Card.
 */

var ADMIN_URL = "https://admin-panel-amber-nine.vercel.app";
var TERMS_URL = "https://admin-panel-amber-nine.vercel.app/terms";
var API_BASE = "https://server-nine-rosy.vercel.app/api";
var LOGO_URL = "https://admin-panel-amber-nine.vercel.app/securedoc/icon-128.png";
var SESSION_KEY = "SDS_WORKSPACE_SESSION";
/** Web app deployment id (Deploy → Manage deployments → Web app) */
var WEB_APP_DEPLOYMENT_ID =
  "AKfycbzCvUVD8GnLvsGNpux6euGd2WJrYUmGXEE3qp-NK-emFZSFAvN5dPOkIumQLmgcm5RRVA";
var WEB_APP_URL =
  "https://script.google.com/macros/s/" + WEB_APP_DEPLOYMENT_ID + "/exec";

function onHomepage(e) {
  return buildMainCard_(e);
}

function onGmailHomepage(e) {
  return buildMainCard_(e);
}

/** When a Gmail message is open: auto-decrypt if SecureDoc content is present. */
function onGmailMessage(e) {
  return buildGmailMessageCard_(e);
}

function onGmailCompose(e) {
  return buildComposeCard_(e);
}

function cardHeader_() {
  return CardService.newCardHeader()
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

/**
 * Contextual Gmail card:
 * - logged out + encrypted mail → login prompt
 * - logged in + sds. / secure attachment → auto decrypt results
 * - otherwise → normal tools card
 */
function buildGmailMessageCard_(e) {
  var session = getWorkspaceSession_();
  var scan = scanMessageForSecureDoc_(e);
  var hasSecure =
    Boolean(scan.cipher) || (scan.attachments && scan.attachments.length > 0);

  if (!session || !session.token) {
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
              "This mail has SecureDoc content (sds. and/or .securepdf).",
              true
            )
          )
          .addWidget(
            infoRow_("Next step", "Sign in below to auto-decrypt and download.")
          )
      );
    }
    card.addSection(buildLoginSection_());
    card.addSection(buildLinksSection_());
    return card.build();
  }

  if (hasSecure) {
    return buildAutoDecryptCard_(e, session, scan);
  }

  return buildMainCard_(e);
}

/** Outlook-like side panel: login OR tools */
function buildMainCard_(e) {
  var session = getWorkspaceSession_();
  var loggedIn = Boolean(session && session.token && session.email);

  var card = CardService.newCardBuilder().setHeader(
    cardHeader_("SecureDocShare", loggedIn ? "Ready" : "Sign in")
  );

  if (!loggedIn) {
    card.addSection(buildLoginSection_());
  } else {
    card.addSection(buildSignedInSection_(session));
    card.addSection(buildEncryptSection_());
    card.addSection(buildDecryptSection_(e));
  }

  card.addSection(buildLinksSection_());
  return card.build();
}

function buildLoginSection_() {
  return CardService.newCardSection()
    .setHeader("Account")
    .addWidget(
      infoRow_(
        "SecureDoc login",
        "Same account as Outlook / Chrome extension."
      )
    )
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
    )
    .addWidget(
      CardService.newButtonSet().addButton(
        primaryBtn_("Log in", "onCardLogin_")
      )
    )
    .addWidget(
      CardService.newTextParagraph().setText(
        "Need an account? Open Admin Panel → Sign up, then return here."
      )
    );
}

function buildSignedInSection_(session) {
  var subLine = "Checking subscription…";
  var check = apiGetSubscription_(session.token);
  var ok = false;
  if (check.ok) {
    ok = Boolean(check.subscriptionActive);
    subLine = ok
      ? "Subscription active"
      : "Subscription inactive";
  }

  return CardService.newCardSection()
    .setHeader("Signed in")
    .addWidget(
      CardService.newDecoratedText()
        .setTopLabel("Account")
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
        .addButton(secondaryBtn_("Refresh status", "onCardBack_"))
        .addButton(secondaryBtn_("Sign out", "onCardLogout_"))
    );
}


function onOpenFullPanel_(e) {
  var url = getWebAppUrl_();
  if (!url) {
    return notify_("Web app not deployed yet.");
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

function buildEncryptSection_() {
  return CardService.newCardSection()
    .setHeader("Encrypt")
    .setCollapsible(true)
    .setNumUncollapsibleWidgets(1)
    .addWidget(
      infoRow_(
        "Message encrypt",
        "Checks login + subscription, then inserts ciphertext into your draft."
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
    )
    .addWidget(
      CardService.newButtonSet().addButton(
        primaryBtn_("Encrypt message", "onCardEncrypt_")
      )
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

  // PDF download on home Decrypt section (below Decrypt message)
  addHomePdfDownloadWidgets_(section, e, scan);

  return section;
}

/**
 * If the open mail has .securepdf / SDSB attachments, decrypt and show
 * Download PDF button(s) under "Decrypt message" on the home tools card.
 */
function addHomePdfDownloadWidgets_(section, e, scan) {
  var atts = (scan && scan.attachments) || [];
  if (!atts.length) {
    // Still offer a one-tap action that re-scans + decrypts attachments.
    section.addWidget(
      CardService.newButtonSet().addButton(
        CardService.newTextButton()
          .setText("Download decrypted PDF")
          .setOnClickAction(
            CardService.newAction().setFunctionName("onHomeDownloadPdf_")
          )
      )
    );
    return;
  }

  var session = getWorkspaceSession_();
  if (!session || !session.token) {
    section.addWidget(
      infoRow_("PDF download", "Sign in to decrypt and download .securepdf files.")
    );
    return;
  }

  var auth = apiGetSubscription_(session.token);
  if (!auth.ok) {
    section.addWidget(
      statusRow_(auth.error || "Session expired — sign in again.", false)
    );
    return;
  }

  var email = auth.email || session.email || "";
  var added = 0;
  var i;
  for (i = 0; i < atts.length; i++) {
    var att = atts[i];
    var fileDec = apiDecrypt_({
      email: email,
      fileCipherText: att.base64,
      token: session.token,
    });
    if (!fileDec.ok) {
      section.addWidget(
        statusRow_(
          (att.name || "PDF") + ": " + (fileDec.error || "decrypt failed"),
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

    var meta = normalizeDecryptedPdfMeta_(
      att.name,
      fileInfo,
      fileDec.filename
    );
    var ready = prepareDecryptedDownload_(meta.name, meta.mime, dataB64);
    if (ready.ok && ready.downloadUrl) {
      added += 1;
      section.addWidget(
        CardService.newDecoratedText()
          .setTopLabel("PDF ready")
          .setText(meta.name)
          .setBottomLabel("Decrypted from " + (att.name || "securepdf"))
          .setWrapText(true)
          .setStartIcon(
            CardService.newIconImage().setIconUrl(
              "https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/picture_as_pdf/default/24px.svg"
            )
          )
      );
      section.addWidget(
        CardService.newButtonSet().addButton(
          CardService.newTextButton()
            .setText("⬇ Download PDF")
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

  if (!added) {
    section.addWidget(
      CardService.newButtonSet().addButton(
        CardService.newTextButton()
          .setText("Download decrypted PDF")
          .setOnClickAction(
            CardService.newAction().setFunctionName("onHomeDownloadPdf_")
          )
      )
    );
  }
}

/** Refresh home card after preparing PDF download from attachments. */
function onHomeDownloadPdf_(e) {
  var session = getWorkspaceSession_();
  if (!session || !session.token) {
    return notify_("Sign in first to download the PDF.");
  }
  var scan = scanMessageForSecureDoc_(e);
  if (!scan.attachments || !scan.attachments.length) {
    return notify_("No .securepdf attachment found on this mail.");
  }
  // Rebuild main card so Decrypt section shows the Download PDF button(s).
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildMainCard_(e)))
    .setNotification(
      CardService.newNotification().setText(
        "Preparing decrypted PDF on the home Decrypt section…"
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
      .addSection(buildLoginSection_())
      .addSection(buildLinksSection_())
      .build();
  }

  var email = auth.email || session.email || "";
  var statusSection = CardService.newCardSection().setHeader("Status");
  var messageSection = CardService.newCardSection().setHeader("Message");
  var filesSection = CardService.newCardSection().setHeader("Files");
  var hasMessageUi = false;
  var hasFileUi = false;
  var primaryDownloadUrl = "";
  var primaryDownloadName = "";

  var foundBits = [];
  if (scan.cipher) foundBits.push("encrypted message");
  if (scan.attachments && scan.attachments.length) {
    foundBits.push(scan.attachments.length + " secure attachment(s)");
  }
  statusSection.addWidget(
    statusRow_("Detected: " + foundBits.join(" + "), true)
  );

  // 1) Message ciphertext
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

  // 2) Attachments (.securepdf / .securemsg)
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
    var meta = normalizeDecryptedPdfMeta_(
      att.name,
      fileInfo,
      fileDec.filename
    );

    if (dataB64) {
      hasFileUi = true;
      var ready = prepareDecryptedDownload_(meta.name, meta.mime, dataB64);
      if (ready.ok && ready.downloadUrl) {
        if (!primaryDownloadUrl) {
          primaryDownloadUrl = ready.downloadUrl;
          primaryDownloadName = meta.name;
        }
        filesSection.addWidget(
          CardService.newDecoratedText()
            .setTopLabel("Ready to download")
            .setText(meta.name)
            .setWrapText(true)
            .setStartIcon(
              CardService.newIconImage().setIconUrl(
                "https://fonts.gstatic.com/s/i/short-term/release/googlesymbols/picture_as_pdf/default/24px.svg"
              )
            )
            .setButton(
              CardService.newTextButton()
                .setText("Download")
                .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
                .setOpenLink(
                  CardService.newOpenLink()
                    .setUrl(ready.downloadUrl)
                    .setOpenAs(CardService.OpenAs.FULL_SIZE)
                    .setOnClose(CardService.OnClose.NOTHING)
                )
            )
        );
        // filesSection.addWidget(
        //   CardService.newButtonSet().addButton(
        //     CardService.newTextButton()
        //       .setText("⬇ Save " + meta.name)
        //       .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        //       .setOpenLink(
        //         CardService.newOpenLink()
        //           .setUrl(ready.downloadUrl)
        //           .setOpenAs(CardService.OpenAs.FULL_SIZE)
        //           .setOnClose(CardService.OnClose.NOTHING)
        //       )
        //   )
        // );
      } else {
        filesSection.addWidget(
          statusRow_(
            "Decrypted " +
              meta.name +
              " but download not ready: " +
              (ready.error || "unknown"),
            false
          )
        );
      }
    } else if (!fileDec.message) {
      hasFileUi = true;
      filesSection.addWidget(
        statusRow_(
          (att.name || "attachment") +
            " decrypted but no file bytes returned.",
          false
        )
      );
    }
  }

  var actions = CardService.newCardSection()
    .setHeader("Actions")
    .addWidget(
      CardService.newButtonSet()
        .addButton(primaryBtn_("Refresh decrypt", "onRefreshAutoDecrypt_"))
        .addButton(secondaryBtn_("Home", "onCardBack_"))
    );

  // No extra CardHeader under Gmail's chrome — Signed in is the top section.
  var builder = CardService.newCardBuilder();
  builder.addSection(buildSignedInSection_(session));
  builder.addSection(statusSection);
  if (hasMessageUi) builder.addSection(messageSection);
  if (hasFileUi) builder.addSection(filesSection);
  builder.addSection(actions);
  builder.addSection(buildLinksSection_());

  return builder.build();
}

function onRefreshAutoDecrypt_(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildGmailMessageCard_(e)))
    .build();
}

function buildLinksSection_() {
  var section = CardService.newCardSection();

  section.addWidget(
    CardService.newTextButton()
      .setText("Admin Panel")
      .setOpenLink(CardService.newOpenLink().setUrl(ADMIN_URL))
  );

  return section;
}

/* ── Card actions ── */

function onCardLogin_(e) {
  var form = (e && e.formInput) || {};
  var email = String(form.login_email || "").trim();
  var password = String(form.login_password || "");

  if (!email || !password) {
    return notify_("Email and password are required.");
  }

  var result = apiLogin_(email, password);
  if (!result.ok) {
    return notify_(result.error || "Login failed.");
  }

  saveWorkspaceSession({
    token: result.token,
    email: result.email || email,
    expiresAt: result.expiresAt || null,
  });

  // After login, if this is an open mail context, jump straight into auto-decrypt.
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
  if (!gate.ok) return notify_(gate.error || "Login / subscription required.");

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

  var session = getWorkspaceSession_();
  if (!session || !session.token) {
    return notify_("Sign in first, then decrypt.");
  }

  var auth = apiGetSubscription_(session.token);
  if (!auth.ok) {
    return notify_(auth.error || "Login expired. Sign in again.");
  }

  var email = auth.email || session.email || "";
  var dec = apiDecrypt_({
    email: email,
    messageCipherText: cipher,
    token: session.token,
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

/* ── Compose (draft) ── */

function buildComposeCard_(e) {
  var toDefault = "";
  try {
    var draft = e && e.gmail && e.gmail.toRecipients;
    if (draft && draft.length) toDefault = String(draft[0] || "");
  } catch (err) {}

  var session = getWorkspaceSession_();
  if (!session || !session.token) {
    return CardService.newCardBuilder()
      .setHeader(cardHeader_("SecureDoc — Compose", "Login required"))
      .addSection(
        CardService.newCardSection().addWidget(
          CardService.newTextParagraph().setText(
            "Open SecureDoc from the side panel, log in, then use Encrypt here."
          )
        )
      )
      .build();
  }

  var section = CardService.newCardSection()
    .addWidget(
      CardService.newTextParagraph().setText(
        "Encrypt & insert into this draft, then click Gmail Send."
      )
    )
    .addWidget(
      CardService.newTextInput()
        .setFieldName("encrypt_to")
        .setTitle("Recipient")
        .setValue(toDefault)
    )
    .addWidget(
      CardService.newTextInput()
        .setFieldName("encrypt_subject")
        .setTitle("Subject")
    )
    .addWidget(
      CardService.newTextInput()
        .setFieldName("encrypt_message")
        .setTitle("Message to encrypt")
        .setMultiline(true)
    )
    .addWidget(
      CardService.newTextButton()
        .setText("Encrypt & insert into draft")
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setOnClickAction(
          CardService.newAction().setFunctionName("onComposeEncrypt_")
        )
    );

  return CardService.newCardBuilder()
    .setHeader(cardHeader_("SecureDoc — Compose", "Encrypt before Send"))
    .addSection(section)
    .build();
}

function onComposeEncrypt_(e) {
  var form = (e && e.formInput) || {};
  var to = String(form.encrypt_to || "").trim();
  var subject = String(form.encrypt_subject || "").trim();
  var message = String(form.encrypt_message || "");

  if (!to) return notify_("Recipient email is required.");
  if (!String(message || "").trim()) {
    return notify_("Message is required for compose encrypt.");
  }

  var gate = verifyLoginAndSubscription_();
  if (!gate.ok) return notify_(gate.error || "Login / subscription required.");

  var enc = apiEncrypt_(to, subject, message, gate.token);
  if (!enc.ok) return notify_(enc.error || "Encrypt failed.");

  var cipher = enc.messageCipherText || "";
  var meta = enc.mailMetadata || null;
  // Always simple mail style (line + list). Never use server table htmlBlock.
  var metaHtml = "";
  if (meta && (meta.token || meta.emailEnc || meta.uuidEnc)) {
    metaHtml =
      '<div style="margin:16px 0 0 0;padding:12px 0 0 0;border-top:2px solid #0F766E">' +
      '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#0F766E;margin:0 0 8px 0">Metadata</div>' +
      (meta.token
        ? '<div style="font-family:Consolas,\'Courier New\',monospace;font-size:12px;line-height:1.5;margin:0 0 4px 0;word-break:break-all">' +
          escapeHtml_(meta.token) +
          "</div>"
        : "") +
      (meta.emailEnc
        ? '<div style="font-family:Consolas,\'Courier New\',monospace;font-size:12px;line-height:1.5;margin:0 0 4px 0;word-break:break-all">email: ' +
          escapeHtml_(meta.emailEnc) +
          "</div>"
        : "") +
      (meta.uuidEnc
        ? '<div style="font-family:Consolas,\'Courier New\',monospace;font-size:12px;line-height:1.5;margin:0;word-break:break-all">uuid: ' +
          escapeHtml_(meta.uuidEnc) +
          "</div>"
        : "") +
      "</div>";
  }
  var bodyHtml =
    '<div style="font-family:Consolas,\'Courier New\',monospace;font-size:12px;line-height:1.5;word-break:break-all;white-space:pre-wrap;">' +
    escapeHtml_(cipher) +
    "</div>" +
    (metaHtml ? "<br><br>" + metaHtml : "");

  var update = CardService.newUpdateDraftActionResponseBuilder()
    .setUpdateDraftBodyAction(
      CardService.newUpdateDraftBodyAction()
        .addUpdateContent(bodyHtml, CardService.ContentType.MUTABLE_HTML)
        .setUpdateType(CardService.UpdateDraftBodyType.IN_PLACE_INSERT)
    )
    .build();

  return CardService.newActionResponseBuilder()
    .setUpdateDraftActionResponse(update)
    .setNotification(
      CardService.newNotification().setText(
        "Encrypted. Ciphertext + Metadata inserted — review draft, then Send."
      )
    )
    .build();
}

/* ── Session ── */

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
    var raw = PropertiesService.getUserProperties().getProperty(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function verifyLoginAndSubscription_() {
  var session = getWorkspaceSession_();
  if (!session || !session.token) {
    return {
      ok: false,
      error: "Sign in first (login required).",
    };
  }
  var sub = apiGetSubscription_(session.token);
  if (!sub.ok) {
    return { ok: false, error: sub.error || "Login token invalid." };
  }
  if (sub.subscriptionActive === false) {
    return {
      ok: false,
      error: "Subscription inactive. Renew to encrypt.",
    };
  }
  var pub = apiSubscriptionCheck_(sub.email || session.email);
  if (pub && pub.subscriptionActive === false) {
    return {
      ok: false,
      error: pub.error || "Subscription expired or inactive.",
    };
  }
  return {
    ok: true,
    token: session.token,
    email: sub.email || session.email,
  };
}

/* ── API ── */

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

function apiSubscriptionCheck_(email) {
  if (!email) return { ok: true, subscriptionActive: true };
  try {
    var res = UrlFetchApp.fetch(
      API_BASE +
        "/public/subscription-check?email=" +
        encodeURIComponent(String(email).trim().toLowerCase()),
      { method: "get", muteHttpExceptions: true }
    );
    var data = {};
    try {
      data = JSON.parse(res.getContentText() || "{}");
    } catch (e) {}
    return {
      ok: res.getResponseCode() >= 200 && res.getResponseCode() < 300,
      subscriptionActive: Boolean(data.subscriptionActive),
      error: data.error || null,
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

/* ── Gmail scan helpers ── */

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
  var s = String(text || "");
  // Prefer longest sds. token (base64 may include = padding).
  var re = /\bsds\.[A-Za-z0-9+/_=-]{40,}/g;
  var m;
  var best = "";
  while ((m = re.exec(s))) {
    if (m[0].length > best.length) best = m[0];
  }
  return best;
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
function normalizeDecryptedPdfMeta_(attName, fileInfo, fallbackName) {
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

/** Web app: ?download=file | ?message=full text | Index panel */
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
  var messageKey = params.message || "";
  if (!messageKey && e.parameters && e.parameters.message) {
    messageKey = e.parameters.message[0] || "";
  }
  if (messageKey) {
    return serveCachedMessage_(String(messageKey));
  }
  return HtmlService.createHtmlOutputFromFile("Index")
    .setTitle("SecureDocShare Workspace")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function serveCachedMessage_(key) {
  var metaRaw = getDownloadCache_("sdm_" + key);
  if (!metaRaw) {
    return HtmlService.createHtmlOutput(
      "<!DOCTYPE html><html><body style='font-family:Arial;padding:24px'>" +
        "<p><b>Message expired.</b> Open the mail in SecureDocShare again, then click Show full message.</p>" +
        "</body></html>"
    ).setTitle("Message expired");
  }
  var meta = {};
  try {
    meta = JSON.parse(metaRaw);
  } catch (err) {
    return HtmlService.createHtmlOutput("<p>Invalid message token.</p>");
  }
  var chunks = Number(meta.c || 0);
  var b64 = "";
  if (chunks > 0) {
    var parts = [];
    var i;
    for (i = 0; i < chunks; i++) {
      var part = getDownloadCache_("sdm_" + key + "_" + i);
      if (part == null) {
        return HtmlService.createHtmlOutput(
          "<p>Message data incomplete. Decrypt again.</p>"
        ).setTitle("Message failed");
      }
      parts.push(part);
    }
    b64 = parts.join("");
  }
  if (!b64) {
    return HtmlService.createHtmlOutput("<p>No message data.</p>");
  }
  var text = "";
  try {
    text = Utilities.newBlob(Utilities.base64Decode(b64, Utilities.Charset.UTF_8))
      .getDataAsString("UTF-8");
  } catch (decodeErr) {
    try {
      text = Utilities.newBlob(Utilities.base64Decode(b64)).getDataAsString();
    } catch (e2) {
      return HtmlService.createHtmlOutput("<p>Could not decode message.</p>");
    }
  }

  var looksHtml = /<\/?[a-z][\s\S]*>/i.test(text);
  var display = text;
  if (looksHtml) {
    // Keep readable text; avoid injecting raw HTML into the page.
    display = String(text)
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
  var bodyInner = "<pre class='msg'>" + escapeHtml_(display) + "</pre>";

  var html =
    "<!DOCTYPE html><html><head><meta charset='utf-8'>" +
    "<meta name='viewport' content='width=device-width, initial-scale=1'>" +
    "<title>Decrypted message</title>" +
    "<style>" +
    "body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#f4f7f6;color:#1f2937;}" +
    ".wrap{max-width:720px;margin:0 auto;padding:24px 20px 48px;}" +
    ".badge{display:inline-block;background:#0f766e;color:#fff;font-size:12px;font-weight:700;" +
    "padding:6px 10px;border-radius:999px;margin-bottom:12px;}" +
    "h1{font-size:20px;margin:0 0 16px;}" +
    ".card{background:#fff;border:1px solid #d1e7e3;border-radius:12px;padding:20px;" +
    "box-shadow:0 8px 24px rgba(15,118,110,.08);}" +
    ".msg{margin:0;white-space:pre-wrap;word-break:break-word;line-height:1.55;font-size:15px;}" +
    "div.msg{white-space:normal;}" +
    "</style></head><body><div class='wrap'>" +
    "<div class='badge'>SecureDocShare</div>" +
    "<h1>Full decrypted message</h1>" +
    "<div class='card'>" +
    bodyInner +
    "</div></div></body></html>";

  return HtmlService.createHtmlOutput(html)
    .setTitle("Decrypted message")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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
