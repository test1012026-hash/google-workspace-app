function cardHeader_(title, subtitle) {
  return CardService.newCardHeader()
    .setTitle(title || "SecureDocShare")
    .setSubtitle(subtitle || "Encrypt · Decrypt · Secure mail");
}

/** Status colors for CardService text (HTML font color). */
const STATUS_COLOR = {
  success: "#188038",
  error: "#d93025",
  info: "#1a73e8",
  working: "#1a73e8",
  need_gmail: "#1a73e8",
};

function escapeCardHtml_(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>");
}

/**
 * Map status kind → success (green) | error (red) | info (blue).
 * @param {string} kind
 * @returns {"success"|"error"|"info"}
 */
function statusToneFromKind_(kind) {
  const k = String(kind || "");
  if (k === "encrypted" || k === "success") return "success";
  if (k === "error") return "error";
  return "info";
}

/**
 * Colored status title + body for TextParagraph (green / red / blue).
 * @param {string} kind
 * @param {string} message
 */
function coloredStatusParagraphText_(kind, message) {
  const tone = statusToneFromKind_(kind);
  const color = STATUS_COLOR[tone] || STATUS_COLOR.info;
  let title = "Status";
  if (tone === "success") title = "✔ SUCCESS";
  else if (tone === "error") title = "✖ ERROR";
  else if (kind === "need_gmail") title = "Connect Gmail";
  else if (kind === "working") title = "Working…";
  else title = "ℹ INFO";

  const body = escapeCardHtml_(message);
  return (
    '<font color="' +
    color +
    '"><b>' +
    title +
    "</b></font><br><font color=\"" +
    color +
    '">' +
    body +
    "</font>"
  );
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
