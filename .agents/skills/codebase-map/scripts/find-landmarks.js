#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const targets = process.argv.slice(2);

if (targets.length === 0) {
  console.log("Usage: node .agents/skills/codebase-map/scripts/find-landmarks.js <rel-file> [...]");
  process.exit(0);
}

const MATCHERS = {
  ".js": /^(export\s+(const|let|function|class)|function\s+\w+|class\s+\w+|server\.on\(|\/\/\s*={3,})/,
  ".css": /^(\/\*.*\*\/|@media\b|:root\b|#[a-zA-Z0-9_-]+\s*\{|\.(pvp-|menu-|mobile-|hero-|loadout-)[a-zA-Z0-9_-]*\s*\{)/,
  ".html": /(<!--.*-->|<dialog\b[^>]*>|id="(main-menu|loading-screen|pvp-[^"]+)")/,
};

for (const rel of targets) {
  const full = path.resolve(ROOT, rel);
  if (!fs.existsSync(full)) {
    console.log(`Missing: ${rel}`);
    continue;
  }
  const ext = path.extname(full).toLowerCase();
  const rx = MATCHERS[ext] || /^(export|function|class|#)/;
  const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
  console.log(`=== ${rel} (${lines.length} lines) ===`);
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed && rx.test(trimmed)) {
      console.log(`${i + 1}: ${trimmed.slice(0, 110)}`);
    }
  }
}
