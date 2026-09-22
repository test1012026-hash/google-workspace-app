/**
 * Build Apps Script HTML includes from web/ sources.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const web = path.join(root, "web");

const COMMON_MODULES = [
  "common/api.js",
  "common/auth.js",
  "common/crypto-client.js",
  "common/expose.js",
];

function wrapJs(name, code) {
  fs.writeFileSync(
    path.join(root, `${name}.html`),
    `<script>\n${code}\n</script>\n`
  );
  console.log("Wrote", name + ".html");
}

function wrapCss(name, srcFile) {
  const css = fs.readFileSync(path.join(web, srcFile), "utf8");
  fs.writeFileSync(
    path.join(root, `${name}.html`),
    `<style>\n${css}\n</style>\n`
  );
  console.log("Wrote", name + ".html");
}

function readWeb(rel) {
  return fs.readFileSync(path.join(web, rel), "utf8");
}

function bundleCommonJs() {
  return COMMON_MODULES.map(readWeb).join("\n;\n") + "\n";
}

wrapCss("Stylesheet", "styles.css");
wrapJs("Config", readWeb("config.js"));
wrapJs("Common", bundleCommonJs());
wrapJs("GmailSend", readWeb("gmail-send.js"));
wrapJs("App", readWeb("app.js"));

fs.writeFileSync(path.join(web, "common.js"), bundleCommonJs());
console.log("Wrote web/common.js (bundled)");

let html = fs.readFileSync(path.join(web, "index.html"), "utf8");
html = html.replace(
  /<link\s+rel="stylesheet"\s+href="(?:taskpane|styles)\.css"\s*\/?>/i,
  "<?!= include('Stylesheet'); ?>"
);
html = html.replace(
  /<script\s+src="config\.js"><\/script>\s*<script\s+src="common\.js"><\/script>\s*(?:<script\s+src="compose-ui\.js"><\/script>\s*)?<script\s+src="gmail-send\.js"><\/script>\s*<script\s+src="app\.js"><\/script>/i,
  "<?!= include('Config'); ?>\n    <?!= include('Common'); ?>\n    <?!= include('GmailSend'); ?>\n    <?!= include('App'); ?>"
);
if (html.indexOf('<base target="_top">') < 0) {
  html = html.replace("<head>", '<head>\n    <base target="_top">');
}

fs.writeFileSync(path.join(root, "Index.html"), html);
console.log("Wrote Index.html");
