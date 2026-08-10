const fs = require("fs");
const FILES = [
  "js/crypto-helper.js",
  "js/audit-log.js",
  "js/history-store.js",
  "js/auth.js",
  "js/plc-simulation.js",
  "js/hmi-controller.js",
  "js/app.js",
];

function strip(code) {
  // Remove import lines
  code = code.replace(/^import\b[^\n]*\n/gm, "");
  // Remove export keywords (keep the declaration)
  code = code.replace(/^export\s+(async\s+)?(function|class|const|let|var)\s/gm, (m, a, kw) => (a || "") + kw + " ");
  code = code.replace(/^export\s+default\s+/gm, "var _default = ");
  code = code.replace(/^export\s*\{[^}]*\}[^\n]*\n/gm, "");
  return code;
}

let bundle = "/* HMI CIBER BUNDLE */\n(function(){\n";
for (const f of FILES) {
  const raw = fs.readFileSync(f, "utf8");
  bundle += "\n/* === " + f + " === */\n" + strip(raw) + "\n";
}
bundle += "\n})();";
fs.writeFileSync("bundle.js", bundle, "utf8");
console.log("OK bundle.js: " + Math.round(bundle.length/1024) + "KB");
