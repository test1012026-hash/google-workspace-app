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
