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
  "assets/generated/skill_skyfall_judgment.jpg",
  "assets/generated/skill_arcane_beam.jpg",
  "assets/generated/skill_chain_lightning.png",
  "assets/generated/skill_meteor_strike.png",
  "assets/generated/skill_mana_shield.png",
  "assets/generated/skill_void_rift.png",
  "assets/generated/skill_tempest_field.png",
  "assets/generated/skill_gravity_singularity.png",
  "assets/generated/skill_thorn_salvo.png",
  "assets/generated/skill_briar_snare.png",
  "assets/generated/skill_leaf_tempest.png",
  "assets/generated/skill_battle_rally.jpg",
  "assets/generated/vfx",
  "assets/generated/vfx_skills",
  "assets/generated/boss_act2",
  "assets/generated/hero_icons",
  "assets/generated/maps",
  "assets/generated/vfx_mage",
  "assets/generated/mage_hero",
  "assets/generated/magic staff pack",
  "assets/generated/magic books",
  "assets/generated/Fire Effect 2",
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
