const CACHE_NAME = "shattered-crown-v36";

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./styles/main.css",
  "./src/game.js",
  "./src/data.js",
  "./src/dungeon.js",
  "./src/assets.js",
  "./src/audio.js",
  "./assets/jan_gamedev_logo.jpg",
  "./assets/dash_icon.png",
  "./assets/joystick_base.png",
  "./assets/joystick_knob.png",
  "./assets/attack_normal.svg",
  "./assets/attack_pressed.svg",
  "./assets/door_double_closed.png",
  "./assets/door_double_open.png",
  "./assets/door_boss_locked.png",
  "./assets/minimap_frame.png",
  "./assets/bow_icon.svg",
  "./assets/wand_icon.svg",
  "./assets/crossbow_icon.svg",
  "./assets/spellbook_icon.svg",
  "./assets/audio/new audio/snes_shattered_crown_menu.wav",
  "./assets/audio/new audio/snes_shattered_crown_no_enemy.wav",
  "./assets/audio/new audio/snes_shattered_crown_combat.wav",
  "./assets/audio/new audio/snes_shattered_crown_boss.wav",
  "./assets/generated/game_logo.png",
  "./assets/generated/skill_holy_smite.jpg",
  "./assets/generated/skill_frost_lance.jpg",
  "./assets/generated/skill_sanctum_nova.jpg",
  "./assets/generated/skill_aegis_bulwark.jpg",
  "./assets/generated/skill_radiant_cleave.jpg",
  "./assets/generated/skill_sovereign_grace.jpg",
  "./assets/generated/skill_valiant_charge.jpg",
  "./assets/generated/skill_seal_retribution.jpg",
  "./assets/generated/skill_arrow_volley.jpg",
  "./assets/generated/skill_piercing_shot.jpg",
  "./assets/generated/skill_battle_rally.jpg",
  "./assets/generated/skill_siege_barrage.jpg",
  "./assets/generated/tiny-rpg/Soldier-Idle.png",
  "./assets/generated/tiny-rpg/Soldier-Walk.png",
  "./assets/generated/tiny-rpg/Soldier-Attack01.png",
  "./assets/generated/tiny-rpg/Soldier-Attack03.png",
  "./assets/generated/tiny-rpg/Soldier-Hurt.png",
  "./assets/generated/tiny-rpg/Soldier-Death.png",
  "./assets/generated/tiny-rpg/Arrow01(32x32).png",
  "./assets/generated/tiny-rpg/Orc-Idle.png",
  "./assets/generated/tiny-rpg/Orc-Walk.png",
  "./assets/generated/tiny-rpg/Orc-Attack01.png",
  "./assets/generated/tiny-rpg/Orc-Hurt.png",
  "./assets/generated/skill_rapid_slash.jpg",
  "./assets/generated/skill_tempest_cleave.jpg",
  "./assets/generated/skill_divine_cataclysm.jpg",
  "./assets/generated/dungeon_tiles.png",
  "./assets/generated/void_king_boss.png",
  "./spritecook-isometric-buildings/castle.webp",
  "./spritecook-pixel-art-characters/paladin-knight/idle_sheet.png",
  "./spritecook-pixel-art-characters/paladin-knight/walk_sheet.png",
  "./spritecook-pixel-art-characters/paladin-knight/attack_sheet.png",
  "./spritecook-pixel-art-characters/paladin-knight/hurt_sheet.png",
  "./spritecook-pixel-art-characters/paladin-knight/death_sheet.png",
  "./spritecook-pixel-art-characters/royal-goblin/idle_sheet.png",
  "./spritecook-pixel-art-characters/royal-goblin/walk_sheet.png",
  "./spritecook-pixel-art-characters/royal-goblin/attack_sheet.png",
  "./spritecook-pixel-art-characters/gilded-knight/idle_sheet.png",
  "./spritecook-pixel-art-characters/gilded-knight/walk_sheet.png",
  "./spritecook-pixel-art-characters/gilded-knight/attack_sheet.png",
  "./spritecook-pixel-art-characters/happy-monk/idle_sheet.png",
  "./spritecook-pixel-art-characters/red-cloaked-rogue/idle_sheet.png",
  "./spritecook-pixel-art-characters/clockwork-robot/idle_sheet.png",
  "./spritecook-pixel-art-characters/tiny-pirate/idle_sheet.png",
  "./spritecook-game-asset-pack/slime.png",
  "./spritecook-game-asset-pack/bat.png",
  "./spritecook-game-asset-pack/skeleton.png",
  "./spritecook-game-asset-pack/chest_closed.png",
  "./spritecook-game-asset-pack/chest_open.png",
  "./spritecook-game-asset-pack/door_closed.png",
  "./spritecook-game-asset-pack/door_open.png",
  "./spritecook-game-asset-pack/barrel.png",
  "./spritecook-game-asset-pack/crate_intact.png",
  "./spritecook-game-asset-pack/crate_damaged.png",
  "./spritecook-game-asset-pack/torch_stand.png",
  "./spritecook-game-asset-pack/stone_well.png",
  "./spritecook-game-asset-pack/urn.png",
  "./spritecook-inventory-icons/sword.png",
  "./spritecook-inventory-icons/cube.png",
  "./spritecook-inventory-icons/health_potion.png",
  "./spritecook-inventory-icons/mana_potion.png",
  "./spritecook-inventory-icons/bread.png",
  "./spritecook-inventory-icons/scroll.png",
  "./spritecook-inventory-icons/axe.png",
  "./spritecook-inventory-icons/staff.png",
  "./spritecook-inventory-icons/shield.png",
  "./spritecook-inventory-icons/armour.png",
  "./spritecook-inventory-icons/helmet.png",
  "./spritecook-inventory-icons/boot.png",
  "./spritecook-inventory-icons/ring.png",
  "./spritecook-spell-icon-set/icon_68.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isCodeOrDoc =
    event.request.mode === "navigate" ||
    /\.(html|js|css|svg|webmanifest)$/i.test(url.pathname) ||
    url.pathname === "/";

  if (isCodeOrDoc) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});
