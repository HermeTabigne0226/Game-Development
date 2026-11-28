// Preloads all sprite sheets, props, icons, and generated tiles/boss art

function loadImage(src) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve(val);
    };
    const t = setTimeout(() => {
      console.warn("Timed out loading asset:", src);
      finish(null);
    }, 10000);
    const img = new Image();
    img.onload = () => finish(img);
    img.onerror = () => {
      console.warn("Failed to load asset:", src);
      finish(null);
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

    ranger_idle: "assets/generated/ranger/ranger_idle.png",
    ranger_walk: "assets/generated/ranger/ranger_walk.png",
    ranger_attack: "assets/generated/ranger/ranger_attack.png",
    ranger_bow: "assets/generated/ranger/ranger_attack.png",

    mage_idle: "assets/generated/mage_hero/mage_idle.png",
    mage_walk: "assets/generated/mage_hero/mage_walk.png",
    mage_attack: "assets/generated/mage_hero/mage_attack.png",

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
    goblin_slinger: "assets/generated/enemies/goblin_slinger.png",
    clockwork_sentinel: "assets/generated/enemies/clockwork_sentinel.png",
    void_acolyte: "assets/generated/enemies/void_acolyte.png",
    void_king: "assets/generated/void_king_boss.png",
    boss_act2_idle: "assets/generated/boss_act2/idle.png",
    boss_act2_walk: "assets/generated/boss_act2/run.png",
    boss_act2_attack: "assets/generated/boss_act2/attack.png",
    boss_act2_combo: "assets/generated/boss_act2/attackcombo.png",
    boss_act2_dash: "assets/generated/boss_act2/dash.png",
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
    "assets/generated/magic staff pack/mage staff.png": "assets/generated/magic staff pack/mage staff.png",
    "assets/generated/magic staff pack/ice staff.png": "assets/generated/magic staff pack/ice staff.png",
    "assets/generated/magic staff pack/fire staff.png": "assets/generated/magic staff pack/fire staff.png",
    "assets/generated/magic staff pack/holy staff.png": "assets/generated/magic staff pack/holy staff.png",
    "assets/generated/magic staff pack/trident staff.png": "assets/generated/magic staff pack/trident staff.png",
    "assets/generated/magic books/magic book _1.png": "assets/generated/magic books/magic book _1.png",
    "assets/generated/magic books/magic book _5.png": "assets/generated/magic books/magic book _5.png",
    "assets/generated/magic books/magic book _12.png": "assets/generated/magic books/magic book _12.png",
    "assets/generated/magic books/magic book _15.png": "assets/generated/magic books/magic book _15.png",
    "assets/generated/magic books/magic book _19.png": "assets/generated/magic books/magic book _19.png",
    "assets/generated/magic books/magic book _28.png": "assets/generated/magic books/magic book _28.png",

    // Pixel-art skill VFX & aura sprites
    vfx_frost_zone: "assets/generated/vfx/vfx_frost_zone.png",
    vfx_radiant_wave: "assets/generated/vfx/vfx_radiant_wave.png",
    vfx_holy_beam: "assets/generated/vfx/vfx_holy_beam.png",
    vfx_holy_ground_impact: "assets/generated/vfx/vfx_holy_ground_impact.png",
    vfx_aegis_guard: "assets/generated/vfx/vfx_aegis_guard.png",
    vfx_skyfall_reticle: "assets/generated/vfx/vfx_skyfall_reticle.png",
    vfx_ground_slam_shockwave: "assets/generated/vfx/vfx_ground_slam_shockwave.png",
    vfx_heal_haste_aura: "assets/generated/vfx/vfx_heal_haste_aura.png",
    vfx_damage_aoe_field: "assets/generated/vfx/vfx_damage_aoe_field.png",
    vfx_spear_charge_lunge: "assets/generated/vfx/vfx_spear_charge_lunge.png",
    vfx_spear_impact_crater: "assets/generated/vfx/vfx_spear_impact_crater.png",
    charging_sword_stage1: "assets/generated/vfx/charging_sword_stage1.png",
    charging_sword_stage2: "assets/generated/vfx/charging_sword_stage2.png",
    charging_sword_max: "assets/generated/vfx/charging_sword_max.png",
    charging_ground_sigil: "assets/generated/vfx/charging_ground_sigil.png",
    shrine_magic: "assets/generated/vfx/shrine_magic.png",
    shrine_aegis: "assets/generated/vfx/shrine_aegis.png",
    shrine_blood: "assets/generated/vfx/shrine_blood.png",
    shrine_depleted: "assets/generated/vfx/shrine_depleted.png",
    vfx_frozen_crystal: "assets/generated/vfx/vfx_frozen_crystal.png",
    vfx_arrow_storm_reticle: "assets/generated/vfx/vfx_arrow_storm_reticle.png",
    vfx_arrow_storm_volley: "assets/generated/vfx/vfx_arrow_storm_volley.png",
    vfx_arrow_storm_impact: "assets/generated/vfx/vfx_arrow_storm_impact.png",
    vfx_skyfall_stage1: "assets/generated/vfx/vfx_skyfall_stage1.png",
    vfx_skyfall_stage2: "assets/generated/vfx/vfx_skyfall_stage2.png",
    vfx_skyfall_stage3: "assets/generated/vfx/vfx_skyfall_stage3.png",
    vfx_skyfall_impact: "assets/generated/vfx/vfx_skyfall_impact.png",
    spike_trap_retracted: "assets/generated/vfx/spike_trap_retracted.png",
    spike_trap_warning: "assets/generated/vfx/spike_trap_warning.png",
    spike_trap_extended: "assets/generated/vfx/spike_trap_extended.png",
    spike_trap_retracting: "assets/generated/vfx/spike_trap_retracting.png",
    melee_slash_frame1: "assets/generated/vfx/melee_slash_frame1.png",
    melee_slash_gold: "assets/generated/vfx/melee_slash_gold.png",
    melee_slash_frame3: "assets/generated/vfx/melee_slash_frame3.png",
    melee_slash_steel_cyan: "assets/generated/vfx/melee_slash_steel_cyan.png",
    vfx_arcane_beam: "assets/generated/vfx_mage/vfx_arcane_beam.png",
    vfx_arcane_orb: "assets/generated/vfx_mage/vfx_arcane_orb.png",
    vfx_blink_dash: "assets/generated/vfx_mage/vfx_blink_dash.png",
    vfx_mana_shield: "assets/generated/vfx_mage/vfx_mana_shield.png",
    vfx_fireball_impact: "assets/generated/vfx_mage/vfx_fireball_impact.png",
    vfx_meteor_strike: "assets/generated/vfx_mage/vfx_meteor_strike.png",
    vfx_chain_lightning: "assets/generated/vfx_mage/vfx_chain_lightning.png",
    vfx_fireball_flight: "assets/generated/vfx_mage/vfx_fireball_flight.png",
    vfx_ice_shard: "assets/generated/vfx_mage/vfx_ice_shard.png",
    vfx_lightning_bolt: "assets/generated/vfx_mage/vfx_lightning_bolt.png",
    vfx_holy_lance: "assets/generated/vfx_mage/vfx_holy_lance.png",
    vfx_magic_missile: "assets/generated/vfx_mage/vfx_magic_missile.png",
    vfx_arcane_burst: "assets/generated/vfx_mage/vfx_arcane_burst.png",
    vfx_fire_explosion: "assets/generated/Fire Effect 2/Explosion SpriteSheet.png",
    vfx_void_rift: "assets/generated/vfx_skills/vfx_void_rift.png",
    vfx_storm_field: "assets/generated/vfx_skills/vfx_storm_field.png",
    vfx_gravity_well: "assets/generated/vfx_skills/vfx_gravity_well.png",
    vfx_thorn_shot: "assets/generated/vfx_skills/vfx_thorn_shot.png",
    vfx_vine_snare: "assets/generated/vfx_skills/vfx_vine_snare.png",
    vfx_leaf_storm: "assets/generated/vfx_skills/vfx_leaf_storm.png",
    vfx_water_bolt: "assets/generated/vfx_skills/vfx_water_bolt.png",
    vfx_lightning_impact: "assets/generated/vfx_skills/vfx_lightning_impact.png",
    vfx_holy_impact: "assets/generated/vfx_skills/vfx_holy_impact.png",
    vfx_water_impact: "assets/generated/vfx_skills/vfx_water_impact.png",
    vfx_thorn_impact: "assets/generated/vfx_skills/vfx_thorn_impact.png",
    vfx_frost_explosion: "assets/generated/vfx_skills/vfx_frost_explosion.png",
    vfx_ground_slam: "assets/generated/vfx_skills/ground_slam.png",
    vfx_sonic_boom: "assets/generated/vfx_skills/sonic_boom.png",
    vfx_greatsword_sweep: "assets/generated/vfx_skills/greatsword_sweep.png",
    vfx_holy_sword_fall: "assets/generated/vfx_skills/holy_sword_fall.png",
    vfx_shield_bubble: "assets/generated/vfx_skills/shield_bubble.png",
    vfx_shadow_step: "assets/generated/vfx_skills/shadow_step.png",
    vfx_shadow_spikes: "assets/generated/vfx_skills/shadow_spikes.png",
    vfx_soul_drain: "assets/generated/vfx_skills/soul_drain.png",
    vfx_holy_smite: "assets/generated/vfx_skills/holy_smite.png",
    vfx_holy_heal: "assets/generated/vfx_skills/holy_heal.png",
    vfx_spin_slash: "assets/generated/vfx_skills/spin_slash.png",
    vfx_spear_thrust: "assets/generated/vfx_skills/spear_thrust.png",
    vfx_shockwave_ring: "assets/generated/vfx_skills/shockwave_ring.png",
    vfx_air_burst: "assets/generated/vfx_skills/air_burst.png",
    vfx_wind_blade: "assets/generated/vfx_skills/wind_blade.png",
    vfx_bloom_heal: "assets/generated/vfx_skills/bloom_heal.png",
    vfx_arrow_flight: "assets/generated/vfx_skills/arrow_flight.png",
    vfx_arrow_impact: "assets/generated/vfx_skills/arrow_impact.png",
    vfx_divine_beam: "assets/generated/vfx_skills/divine_beam.png",
    vfx_holy_nova: "assets/generated/vfx_skills/holy_nova.png",
    vfx_rapier_flurry: "assets/generated/vfx_skills/rapier_flurry.png",
    vfx_regen_aura: "assets/generated/vfx_skills/regen_aura.png",
    vfx_power_up_aura: "assets/generated/vfx_skills/power_up_aura.png",
    vfx_poisoned_aura: "assets/generated/vfx_skills/poisoned_aura.png",
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

export function drawSheetFrame(ctx, img, frameIdx, dx, dy, dw, dh, flipX = false, fwOverride = null) {
  if (!img) return;
  const fh = img.height;
  const fw = fwOverride || fh; // square frames across spritecook sheets, or explicit fw for rectangular sheets
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
