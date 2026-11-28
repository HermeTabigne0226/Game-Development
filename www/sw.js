const CACHE_NAME = "shattered-crown-v108";

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./styles/main.css",
  "./styles/pvp.css",
  "./src/game.js",
  "./src/data.js",
  "./src/dungeon.js",
  "./src/assets.js",
  "./src/audio.js",
  "./src/state.js",
  "./src/combat.js",
  "./src/pvp.js",
  "./src/pvpLobby.js",
  "./src/enemyAI.js",
  "./src/world.js",
  "./src/renderer.js",
  "./src/ui.js",
  "./src/dialogs.js",
  "./assets/knob_sword.svg",
  "./assets/knob_wand.svg",
  "./assets/knob_arrow.svg",
  "./assets/generated/vfx/vfx_frost_zone.png",
  "./assets/generated/vfx/vfx_radiant_wave.png",
  "./assets/generated/vfx/vfx_holy_beam.png",
  "./assets/generated/vfx/vfx_holy_ground_impact.png",
  "./assets/generated/vfx/vfx_aegis_guard.png",
  "./assets/generated/vfx/vfx_skyfall_reticle.png",
  "./assets/generated/vfx/vfx_ground_slam_shockwave.png",
  "./assets/generated/vfx/vfx_heal_haste_aura.png",
  "./assets/generated/vfx/vfx_damage_aoe_field.png",
  "./assets/generated/vfx/vfx_spear_charge_lunge.png",
  "./assets/generated/vfx/vfx_spear_impact_crater.png",
  "./assets/generated/vfx/charging_sword_stage1.png",
  "./assets/generated/vfx/charging_sword_stage2.png",
  "./assets/generated/vfx/charging_sword_max.png",
  "./assets/generated/vfx/charging_ground_sigil.png",
  "./assets/generated/vfx/shrine_magic.png",
  "./assets/generated/vfx/shrine_aegis.png",
  "./assets/generated/vfx/shrine_blood.png",
  "./assets/generated/vfx/shrine_depleted.png",
  "./assets/generated/vfx/vfx_frozen_crystal.png",
  "./assets/generated/vfx/vfx_arrow_storm_reticle.png",
  "./assets/generated/vfx/vfx_arrow_storm_volley.png",
  "./assets/generated/vfx/vfx_arrow_storm_impact.png",
  "./assets/generated/vfx/vfx_skyfall_stage1.png",
  "./assets/generated/vfx/vfx_skyfall_stage2.png",
  "./assets/generated/vfx/vfx_skyfall_stage3.png",
  "./assets/generated/vfx/vfx_skyfall_impact.png",
  "./assets/generated/vfx/spike_trap_retracted.png",
  "./assets/generated/vfx/spike_trap_warning.png",
  "./assets/generated/vfx/spike_trap_extended.png",
  "./assets/generated/vfx/spike_trap_retracting.png",
  "./assets/generated/vfx/melee_slash_frame1.png",
  "./assets/generated/vfx/melee_slash_gold.png",
  "./assets/generated/vfx/melee_slash_frame3.png",
  "./assets/generated/vfx/melee_slash_steel_cyan.png",
  "./assets/generated/ranger/ranger_idle.png",
  "./assets/generated/ranger/ranger_walk.png",
  "./assets/generated/ranger/ranger_attack.png",
  "./assets/generated/mage_hero/mage_idle.png",
  "./assets/generated/mage_hero/mage_walk.png",
  "./assets/generated/mage_hero/mage_attack.png",
  "./assets/generated/vfx_mage/vfx_arcane_beam.png",
  "./assets/generated/vfx_mage/vfx_arcane_orb.png",
  "./assets/generated/vfx_mage/vfx_blink_dash.png",
  "./assets/generated/vfx_mage/vfx_mana_shield.png",
  "./assets/generated/vfx_mage/vfx_fireball_impact.png",
  "./assets/generated/vfx_mage/vfx_meteor_strike.png",
  "./assets/generated/vfx_mage/vfx_chain_lightning.png",
  "./assets/generated/vfx_mage/vfx_fireball_flight.png",
  "./assets/generated/vfx_mage/vfx_ice_shard.png",
  "./assets/generated/vfx_mage/vfx_lightning_bolt.png",
  "./assets/generated/vfx_mage/vfx_holy_lance.png",
  "./assets/generated/vfx_mage/vfx_magic_missile.png",
  "./assets/generated/vfx_mage/vfx_arcane_burst.png",
  "./assets/generated/Fire Effect 2/Explosion SpriteSheet.png",
  "./assets/generated/magic staff pack/mage staff.png",
  "./assets/generated/magic staff pack/ice staff.png",
  "./assets/generated/magic staff pack/fire staff.png",
  "./assets/generated/magic staff pack/holy staff.png",
  "./assets/generated/magic staff pack/trident staff.png",
  "./assets/generated/magic books/magic book _1.png",
  "./assets/generated/magic books/magic book _5.png",
  "./assets/generated/magic books/magic book _12.png",
  "./assets/generated/magic books/magic book _15.png",
  "./assets/generated/magic books/magic book _19.png",
  "./assets/generated/magic books/magic book _28.png",
  "./assets/generated/skill_arcane_beam.jpg",
  "./assets/generated/skill_chain_lightning.png",
  "./assets/generated/skill_meteor_strike.png",
  "./assets/generated/skill_mana_shield.png",
  "./assets/generated/enemies/goblin_slinger.png",
  "./assets/generated/enemies/clockwork_sentinel.png",
  "./assets/generated/enemies/void_acolyte.png",
  "./assets/generated/maps/goblin_catacombs_pit_1795795312387.jpg",
  "./assets/generated/maps/sunken_foundry_crucible_1795795321692.jpg",
  "./assets/generated/maps/abyssal_sanctum_arena_1795795331171.jpg",
  "./assets/generated/maps/crimson_courtyard_1795795340338.jpg",
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
  "./assets/generated/skill_skyfall_judgment.jpg",
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
