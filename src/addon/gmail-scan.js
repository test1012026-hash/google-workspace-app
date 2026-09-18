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
