const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const web = path.join(root, "web");

function wrapJs(name, srcFile) {
  const code = fs.readFileSync(path.join(web, srcFile), "utf8");
  fs.writeFileSync(
    path.join(root, `${name}.html`),
    `<script>\n${code}\n</script>\n`,
  );
  console.log("Wrote", name + ".html");
}

function wrapCss(name, srcFile) {
  const css = fs.readFileSync(path.join(web, srcFile), "utf8");
  fs.writeFileSync(
    path.join(root, `${name}.html`),
    `<style>\n${css}\n</style>\n`,
  );
  console.log("Wrote", name + ".html");
}

wrapCss("Stylesheet", "taskpane.css");
wrapJs("Config", "config.js");
wrapJs("Common", "common.js");
wrapJs("GmailSend", "gmail-send.js");
wrapJs("App", "app.js");

// Convert web/index.html → Apps Script Index.html with includes
var html = fs.readFileSync(path.join(web, "index.html"), "utf8");
html = html.replace(
  /<link\s+rel="stylesheet"\s+href="taskpane\.css"\s*\/?>/i,
  "<?!= include('Stylesheet'); ?>",
);
html = html.replace(
  /<script\s+src="config\.js"><\/script>\s*<script\s+src="common\.js"><\/script>\s*<script\s+src="gmail-send\.js"><\/script>\s*<script\s+src="app\.js"><\/script>/i,
  "<?!= include('Config'); ?>\n    <?!= include('Common'); ?>\n    <?!= include('GmailSend'); ?>\n    <?!= include('App'); ?>",
);
// Fallback if gmail-send script tag missing in source
if (html.indexOf("include('GmailSend')") < 0) {
  html = html.replace(
    /<script\s+src="config\.js"><\/script>\s*<script\s+src="common\.js"><\/script>\s*<script\s+src="app\.js"><\/script>/i,
    "<?!= include('Config'); ?>\n    <?!= include('Common'); ?>\n    <?!= include('GmailSend'); ?>\n    <?!= include('App'); ?>",
  );
}
if (html.indexOf('<base target="_top">') < 0) {
  html = html.replace("<head>", '<head>\n    <base target="_top">');
}

fs.writeFileSync(path.join(root, "Index.html"), html);
console.log("Wrote Index.html");
