/**
 * Concatenate src/addon/*.js → Code.js (clasp push target).
 * Order matters: helpers before callers.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const addonDir = path.join(root, "src", "addon");

const MODULES = [
  "config.js",
  "ui.js",
  "cards.js",
  "actions.js",
  "session.js",
  "api.js",
  "contacts.js",
  "gmail-draft.js",
  "gmail-scan.js",
  "webapp.js",
];

const missing = MODULES.filter((f) => !fs.existsSync(path.join(addonDir, f)));
if (missing.length) {
  console.error("Missing addon modules:", missing.join(", "));
  process.exit(1);
}

const out =
  MODULES.map((f) =>
    fs.readFileSync(path.join(addonDir, f), "utf8").trimEnd()
  ).join("\n\n") + "\n";

fs.writeFileSync(path.join(root, "Code.js"), out);
console.log("Wrote Code.js from", MODULES.length, "modules:", MODULES.join(", "));
