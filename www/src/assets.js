// Preloads all sprite sheets, props, icons, and generated tiles/boss art

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn("Failed to load asset:", src);
      resolve(null);
    };
    img.src = src;
  });
}

export async function loadAllAssets(onProgress = null) {
  const manifest = {
    // Animated sprite sheets (horizontal strips; frameCount = width / height)
    paladin_idle: "spritecook-pixel-art-characters/paladin-knight/idle_sheet.png",
    paladin_walk: "spritecook-pixel-art-characters/paladin-knight/walk_sheet.png",
    paladin_attack: "spritecook-pixel-art-characters/paladin-knight/attack_sheet.png",
    paladin_hurt: "spritecook-pixel-art-characters/paladin-knight/hurt_sheet.png",
    paladin_death: "spritecook-pixel-art-characters/paladin-knight/death_sheet.png",

    goblin_idle: "spritecook-pixel-art-characters/royal-goblin/idle_sheet.png",
    goblin_attack: "spritecook-pixel-art-characters/royal-goblin/attack_sheet.png",
    goblin_walk: "spritecook-pixel-art-characters/royal-goblin/walk_sheet.png",

    gilded_idle: "spritecook-pixel-art-characters/gilded-knight/idle_sheet.png",
    gilded_attack: "spritecook-pixel-art-characters/gilded-knight/attack_sheet.png",
    gilded_walk: "spritecook-pixel-art-characters/gilded-knight/walk_sheet.png",

    soldier_idle: "assets/generated/tiny-rpg/Soldier-Idle.png",
    soldier_walk: "assets/generated/tiny-rpg/Soldier-Walk.png",
    soldier_attack: "assets/generated/tiny-rpg/Soldier-Attack01.png",
    soldier_bow: "assets/generated/tiny-rpg/Soldier-Attack03.png",
    soldier_hurt: "assets/generated/tiny-rpg/Soldier-Hurt.png",
    soldier_death: "assets/generated/tiny-rpg/Soldier-Death.png",
    arrow_proj: "assets/generated/tiny-rpg/Arrow01(32x32).png",

    orc_idle: "assets/generated/tiny-rpg/Orc-Idle.png",
    orc_walk: "assets/generated/tiny-rpg/Orc-Walk.png",
    orc_attack: "assets/generated/tiny-rpg/Orc-Attack01.png",
    orc_hurt: "assets/generated/tiny-rpg/Orc-Hurt.png",

    monk_idle: "spritecook-pixel-art-characters/happy-monk/idle_sheet.png",
    rogue_idle: "spritecook-pixel-art-characters/red-cloaked-rogue/idle_sheet.png",
    robot_idle: "spritecook-pixel-art-characters/clockwork-robot/idle_sheet.png",
    pirate_idle: "spritecook-pixel-art-characters/tiny-pirate/idle_sheet.png",

    // Static enemy & prop sprites (256x256)
    slime: "spritecook-game-asset-pack/slime.png",
    bat: "spritecook-game-asset-pack/bat.png",
    skeleton: "spritecook-game-asset-pack/skeleton.png",
    void_king: "assets/generated/void_king_boss.png",
    dungeon_tiles: "assets/generated/dungeon_tiles.png",

    chest_closed: "spritecook-game-asset-pack/chest_closed.png",
    chest_open: "spritecook-game-asset-pack/chest_open.png",
    door_closed: "assets/door_double_closed.png",
    door_open: "assets/door_double_open.png",
    door_locked: "assets/door_boss_locked.png",
    barrel: "spritecook-game-asset-pack/barrel.png",
    crate_intact: "spritecook-game-asset-pack/crate_intact.png",
    crate_damaged: "spritecook-game-asset-pack/crate_damaged.png",
    torch_stand: "spritecook-game-asset-pack/torch_stand.png",
    stone_well: "spritecook-game-asset-pack/stone_well.png",
    urn: "spritecook-game-asset-pack/urn.png",

    // Inventory & ground drop icons
    "spritecook-inventory-icons/armour.png": "spritecook-inventory-icons/armour.png",
    "spritecook-inventory-icons/arrows.png": "spritecook-inventory-icons/arrows.png",
    "spritecook-inventory-icons/axe.png": "spritecook-inventory-icons/axe.png",
    "spritecook-inventory-icons/boot.png": "spritecook-inventory-icons/boot.png",
    "spritecook-inventory-icons/bread.png": "spritecook-inventory-icons/bread.png",
    "spritecook-inventory-icons/health_potion.png": "spritecook-inventory-icons/health_potion.png",
    "spritecook-inventory-icons/helmet.png": "spritecook-inventory-icons/helmet.png",
    "spritecook-inventory-icons/mana_potion.png": "spritecook-inventory-icons/mana_potion.png",
    "spritecook-inventory-icons/ring.png": "spritecook-inventory-icons/ring.png",
    "spritecook-inventory-icons/scroll.png": "spritecook-inventory-icons/scroll.png",
    "spritecook-inventory-icons/shield.png": "spritecook-inventory-icons/shield.png",
    "spritecook-inventory-icons/staff.png": "spritecook-inventory-icons/staff.png",
    "spritecook-inventory-icons/sword.png": "spritecook-inventory-icons/sword.png",
    "assets/bow_icon.svg": "assets/bow_icon.svg",
    "assets/wand_icon.svg": "assets/wand_icon.svg",
    "assets/crossbow_icon.svg": "assets/crossbow_icon.svg",
    "assets/spellbook_icon.svg": "assets/spellbook_icon.svg",
  };

  const list = Object.entries(manifest);
  let loaded = 0;
  const total = list.length;
  const entries = await Promise.all(
    list.map(async ([key, src]) => {
      const img = await loadImage(src);
      loaded += 1;
      if (onProgress) onProgress(loaded, total);
      return [key, img];
    })
  );
  return Object.fromEntries(entries);
}

export function drawSheetFrame(ctx, img, frameIdx, dx, dy, dw, dh, flipX = false) {
  if (!img) return;
  const fh = img.height;
  const fw = fh; // square frames across all spritecook sheets
  const count = Math.max(1, Math.floor(img.width / fw));
  const sx = (frameIdx % count) * fw;

  ctx.save();
  if (flipX) {
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(img, sx, 0, fw, fh, 0, 0, dw, dh);
  } else {
    ctx.drawImage(img, sx, 0, fw, fh, dx, dy, dw, dh);
  }
  ctx.restore();
}
