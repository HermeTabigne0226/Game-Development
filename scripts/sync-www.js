const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const WWW = path.join(ROOT, "www");

const ITEMS_TO_COPY = [
  "index.html",
  "manifest.webmanifest",
  "sw.js",
  "styles",
  "src",
  "assets/knob_sword.svg",
  "assets/knob_wand.svg",
  "assets/knob_arrow.svg",
  "assets/generated/ranger/ranger_idle.png",
  "assets/generated/ranger/ranger_walk.png",
  "assets/generated/ranger/ranger_attack.png",
  "assets/generated/enemies/goblin_slinger.png",
  "assets/generated/enemies/clockwork_sentinel.png",
  "assets/generated/enemies/void_acolyte.png",
];

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

fs.mkdirSync(WWW, { recursive: true });
for (const rel of ITEMS_TO_COPY) {
  const srcPath = path.join(ROOT, rel);
  const destPath = path.join(WWW, rel);
  if (fs.existsSync(srcPath)) {
    copyRecursive(srcPath, destPath);
  }
}

console.log("Synced web source and new runtime assets to www/");
