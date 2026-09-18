/**
 * SecureDoc Workspace — Encrypt / decrypt client (slim; no Outlook thread helpers).
 * Concatenated into Common.html by the Apps Script HTML build.
 */

function looksLikeBase64String(value) {
  var s = String(value || "").replace(/\s+/g, "");
  if (s.length < 80) return false;
  if (s.indexOf("base64,") !== -1) return true;
  return /^[A-Za-z0-9+/=_-]+$/.test(s);
}

function cleanBase64Payload(value) {
  var s = String(value || "");
  var idx = s.indexOf("base64,");
  if (idx !== -1) s = s.slice(idx + 7);
  return s.replace(/\s+/g, "");
}

/**
 * Pull decrypted file bytes from any SecureDoc decrypt response shape.
 */
function extractDecryptedFileBase64(res, fallbackName) {
  if (!res) return null;

  var fileName =
    res.filename || res.fileName || fallbackName || "decrypted.bin";
  var mimeType = res.mimeType || "application/octet-stream";

  var direct =
    res.decryptedBase64 ||
    res.fileBase64 ||
    res.decryptedFileBase64 ||
    null;
  if (direct && looksLikeBase64String(direct)) {
    return {
      base64: cleanBase64Payload(direct),
      fileName: fileName,
      mimeType: mimeType,
    };
  }

  var file = res.file || res.attachment;
  if (typeof file === "string" && looksLikeBase64String(file)) {
    return {
      base64: cleanBase64Payload(file),
      fileName: fileName,
      mimeType: mimeType,
    };
  }

  if (file && typeof file === "object") {
    var keys = [
      "decryptedBase64",
      "fileBase64",
      "attachmentBase64",
      "base64",
      "content",
      "data",
      "binary",
      "buffer",
      "bytes",
      "fileContent",
      "decryptedContent",
      "payload",
      "body",
    ];
    var i;
    for (i = 0; i < keys.length; i++) {
      var val = file[keys[i]];
      if (val && looksLikeBase64String(val)) {
        return {
          base64: cleanBase64Payload(val),
          fileName:
            file.fileName ||
            file.name ||
            file.filename ||
            fileName,
          mimeType: file.mimeType || file.contentType || mimeType,
        };
      }
    }
    for (var k in file) {
      if (!Object.prototype.hasOwnProperty.call(file, k)) continue;
      if (keys.indexOf(k) !== -1) continue;
      var v = file[k];
      if (v && looksLikeBase64String(v)) {
        return {
          base64: cleanBase64Payload(v),
          fileName:
            file.fileName ||
            file.name ||
            file.filename ||
            fileName,
          mimeType: file.mimeType || file.contentType || mimeType,
        };
      }
    }
  }

  if (res.data && res.data !== res) {
    return extractDecryptedFileBase64(res.data, fallbackName);
  }

  return null;
}

function guessDecryptedFileName(name, mimeType) {
  var n = String(name || "decrypted.bin");
  if (/\.secure[a-z0-9]+$/i.test(n)) {
    n = n.replace(/\.secure[a-z0-9]+$/i, "");
  }
  if (/\.[a-z0-9]+$/i.test(n)) return n;
  var mime = String(mimeType || "").toLowerCase();
  if (mime === "application/pdf" || mime.indexOf("pdf") !== -1) return n + ".pdf";
  if (mime.indexOf("image/png") === 0) return n + ".png";
  if (mime.indexOf("image/jpeg") === 0) return n + ".jpg";
  if (mime.indexOf("image/gif") === 0) return n + ".gif";
  if (mime.indexOf("image/webp") === 0) return n + ".webp";
  if (mime.indexOf("image/") === 0) return n + ".img";
  if (mime.indexOf("text/") === 0) return n + ".txt";
  return n + ".bin";
}

/**
 * Decrypt message and/or file cipher text for recipient.
 * POST /public/decrypt
 */
function decryptOnly(options) {
  options = options || {};
  var baseUrl = normalizeBaseUrl(options.apiBaseUrl);
  var recipient =
    options.email || options.to || options.receiverEmail || null;

  if (!recipient) {
    return Promise.resolve(
      failure(400, {
        error: "Recipient email is required",
        code: "EMAIL_REQUIRED",
      })
    );
  }

  var msgCipher =
    options.messageCipherText ||
    options.packageText ||
    options.encryptedMessage ||
    null;
  var fileCipher =
    options.fileCipherText ||
    options.packageBase64 ||
    options.encryptedFile ||
    options.encryptedPdf ||
    null;

  if (!msgCipher && !fileCipher) {
    return Promise.resolve(
      failure(400, {
        error: "Provide messageCipherText and/or fileCipherText",
        code: "CIPHERTEXT_REQUIRED",
      })
    );
  }

  var body = { email: recipient };
  if (msgCipher) body.messageCipherText = msgCipher;
  if (fileCipher) body.fileCipherText = fileCipher;

  return apiRequest(baseUrl, "/public/decrypt", {
    method: "POST",
    body: body,
  }).then(function (out) {
    var res = out.res;
    var data = out.data || {};

    if (!res.ok || data.ok === false) {
      return failure(
        res.status || 500,
        data,
        data.error || "Decrypt failed"
      );
    }

    return success(res.status, {
      decrypted: true,
      recipientUuid: data.recipientUuid || null,
      recipientEmail: data.recipientEmail || null,
      recipientClaimed: Boolean(data.recipientClaimed),
      messageDecrypted: Boolean(data.messageDecrypted),
      fileDecrypted: Boolean(data.fileDecrypted),
      message: data.message || null,
      file: data.file || data.attachment || null,
      kind: data.kind || null,
      filename: data.filename || data.fileName || null,
      decryptedBase64:
        data.decryptedBase64 ||
        data.fileBase64 ||
        data.decryptedFileBase64 ||
        null,
      mimeType: data.mimeType || null,
    });
  });
}
