import { sfx } from "./audio.js";
import { combatHooks, damageEnemy, hurtPlayer, performMeleeAttack, stunPlayer, unlockCodex } from "./combat.js";
import { DEFAULT_LOADOUT, ELITE_AFFIXES, HERO_CLASSES, ITEMS, NPC_ENCOUNTERS, RELICS, SHRINE_ENCOUNTERS, SPELLS, rollEquipmentByFloor } from "./data.js";
import { MAP_H, MAP_W, TILE, computeFOV, createScaledEnemy, generateFloor } from "./dungeon.js";
import { checkBossSpotted, revealBossRoom, startBossMatch, updateEnemiesAndBosses } from "./enemyAI.js";
import { broadcastPvpAction, notifyLocalPvpTimeout, syncPvpIntroTimer, updatePvpFrame } from "./pvp.js";
import {
  addFloat,
  addLog,
  canOccupy,
  clearLog,
  clearSavedRun,
  getActiveSpells,
  getPlayerStats,
  getRarityInfo,
  getWeaponCategory,
  giveOrDropItem,
  grantRandomRelic,
  isBlockedAt,
  distPointToSegment,
  moveWithSlide,
  runtime,
  saveMeta,
  saveRun,
  showFloorBanner,
  spawnBurst,
  spawnGroundDecal,
  spawnRing,
  spawnVfxAnim,
  TILE_SIZE,
  touchAim,
  touchMove,
  keys,
  mouse,
} from "./state.js";

export const worldHooks = {
  openStairsDialog: null,
  openShopDialog: null,
  openStoryDialog: null,
  openShrineDialog: null,
  openForgeDialog: null,
  updateRoomAndBossHUD: null,
  buildSpellButtons: null,
  updateUI: null,
};

export function updateFOVIfNeeded(force = false) {
  const s = runtime.state;
  if (!s) return;
  const tx = Math.floor(s.player.x);
  const ty = Math.floor(s.player.y);
  if (force || tx !== s.lastFovTile.x || ty !== s.lastFovTile.y) {
    s.lastFovTile.x = tx;
    s.lastFovTile.y = ty;
    computeFOV(s.level, tx, ty, 6);
    if (s.level.isBossFloor && (s.bossFightStarted || isBossRoomUnlocked(s.level))) {
      revealBossRoom(s.level, true);
    }
    checkBossSpotted();
  }
}

export function isBossRoomUnlocked(lvl) {
  if (!lvl?.isBossFloor) return false;
  const door = lvl.props?.find((pr) => pr.isBossDoor);
  return Boolean(door && !door.locked);
}

export function createNewRun(heroName, difficultyId, loadout = DEFAULT_LOADOUT, heroClass = "gilded", skipSave = false) {
  clearSavedRun();
  const normalizedClass = heroClass === "soldier" ? "ranger" : heroClass === "paladin" ? "gilded" : heroClass;
  const cls = HERO_CLASSES[normalizedClass] || HERO_CLASSES.gilded;

  const vit = runtime.meta.upgrades.vitality || 0;
  const might = runtime.meta.upgrades.might || 0;
  const arc = runtime.meta.upgrades.arcane || 0;
  const prov = runtime.meta.upgrades.provisions || 0;

  const sfGold = (runtime.meta.soulForge?.gold_reserve || 0) * 35;
  const sfRelic = runtime.meta.soulForge?.relic_pouch || 0;
  const sfScholar = runtime.meta.soulForge?.scholar_tome || 0;

  const level = generateFloor(1, difficultyId);
  const maxHp = 42 + vit * 8 + cls.bonusHp;
  const maxMp = 20 + arc * 6 + cls.bonusMp;

  const inventory = [
    { ...ITEMS.health_potion, qty: 1 + prov },
    { ...ITEMS.mana_potion, qty: 1 },
  ];

  const startWeapon = ITEMS[cls.startWeapon] ? { ...ITEMS[cls.startWeapon] } : { ...ITEMS.iron_sword };
  const startSubweapon = cls.startSubweapon && ITEMS[cls.startSubweapon] ? { ...ITEMS[cls.startSubweapon] } : null;

  const player = {
    name: heroName,
    heroClass: cls.id,
    x: level.playerStart.x + 0.5,
    y: level.playerStart.y + 0.5,
    z: 0,
    leap: null,
    ultCharge: null,
    rapidSlash: null,
    stunTimer: 0,
    tempDef: 0,
    tempDefTimer: 0,
    tempAtk: 0,
    tempAtkTimer: 0,
    hasteTimer: 0,
    aegisHeartCd: 0,
    basicShotCount: 0,
    hitCounter: 0,
    loadout: Array.isArray(loadout) && loadout.length === 4 ? [...loadout] : [...DEFAULT_LOADOUT],
    relics: [],
    vx: 0,
    vy: 0,
    kbX: 0,
    kbY: 0,
    facingLeft: false,
    aimAngle: 0,
    anim: "idle",
    animTimer: 0,
    attackCd: 0,
    dashCd: 0,
    dashTimer: 0,
    dashDirX: 1,
    dashDirY: 0,
    iFrames: 0,
    stepTimer: 0,
    dustTimer: 0,
    level: 1,
    xp: 0,
    xpNext: 20,
    skillPoints: 1 + (sfScholar >= 2 ? 1 : 0),
    skillRanks: Object.fromEntries(SPELLS.map((s) => [s.id, 0])),
    shortcuts: ["health_potion", "mana_potion", null, null],
    hp: maxHp,
    maxHp,
    mp: maxMp,
    maxMp,
    baseAtk: 6 + might + cls.bonusAtk,
    baseDef: 2 + cls.bonusDef,
    baseCrit: 6 + cls.bonusCrit,
    gold: 15 + sfGold,
    equipment: {
      weapon: startWeapon,
      subweapon: startSubweapon,
      armor: null,
      helmet: null,
      boots: null,
      ring: null,
      earrings: null,
    },
    maxInventory: 15,
    inventory,
  };

  if (sfRelic > 0) {
    grantRandomRelic(player);
  }

  document.body.classList.remove("pvp-active");
  runtime.state = {
    floor: 1,
    difficulty: difficultyId,
    isEndless: false,
    level,
    elapsed: 0,
    kills: 0,
    startedByUser: !skipSave,
    runEnded: false,
    dyingTimer: 0,
    pendingVictory: false,
    bossFightStarted: false,
    hasBossKey: false,
    bossKeyDrop: null,
    camReveal: null,
    bossIntroTimer: 0,
    hitstop: 0,
    shake: 0,
    mpRegenTimer: 0,
    saveTimer: 0,
    npcCooldown: 0,
    shopCooldown: 0,
    forgeCooldown: 0,
    shrineCooldown: 0,
    stairsCooldown: 0,
    invFullMsgCd: 0,
    lastFovTile: { x: -1, y: -1 },
    seenBosses: new Set(),
    shardsCollected: [false, false, false, false],
    spellCooldowns: Object.fromEntries(SPELLS.map((s) => [s.id, 0])),
    player,
    projectiles: [],
    slashes: [],
    rings: [],
    groundDecals: [],
    vfxAnims: [],
    pendingMeteors: [],
    beams: [],
    arrowStorms: [],
    gravityWells: [],
    frostZones: [],
    fallingArrows: [],
    enemyHazards: [],
    afterimages: [],
    floatingTexts: [],
    particles: [],
  };

  updateFOVIfNeeded(true);
  clearLog();
  addLog(`${heroName} (${cls.name}) descends into the Goblin Catacombs!`, "story");
  if (player.relics.length > 0) {
    addLog(`Reliquary Pouch granted [${RELICS[player.relics[0]].name}]!`, "loot");
  }
  showFloorBanner(`Floor 1 — ${runtime.state.level.act.name}`);
  if (worldHooks.buildSpellButtons) worldHooks.buildSpellButtons();
  if (worldHooks.updateUI) worldHooks.updateUI();
  if (!skipSave) saveRun();
}

export function repairSavedFloorIfDisconnected(lvl, player) {
  if (!lvl?.grid || !player) return false;
  const startX = Math.max(0, Math.min(MAP_W - 1, Math.floor(player.x)));
  const startY = Math.max(0, Math.min(MAP_H - 1, Math.floor(player.y)));
  const bossDoor = lvl.props?.find((pr) => pr.isBossDoor);
  const br = lvl.isBossFloor && lvl.rooms?.length ? lvl.rooms[lvl.rooms.length - 1] : null;
  const isBossPerimeterOrInside = br
    ? (tx, ty) => tx >= br.x - 1 && tx <= br.x + br.w && ty >= br.y - 1 && ty <= br.y + br.h
    : () => false;

  const getReachable = () => {
    const vis = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(false));
    const q = [[startX, startY]];
    vis[startY][startX] = true;
    while (q.length > 0) {
      const [x, y] = q.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H || vis[ny][nx]) continue;
        if (lvl.grid[ny][nx] === TILE.WALL) continue;
        if (bossDoor && bossDoor.locked && nx === bossDoor.x && ny === bossDoor.y) {
          vis[ny][nx] = true;
          continue;
        }
        vis[ny][nx] = true;
        q.push([nx, ny]);
      }
    }
    return vis;
  };

  let repaired = false;
  const targets = [];
  for (const e of lvl.enemies || []) {
    if (!e.isBoss) targets.push({ x: Math.floor(e.x), y: Math.floor(e.y) });
  }
  if (bossDoor) targets.push({ x: bossDoor.x, y: bossDoor.y, isDoor: true });
  else if (lvl.stairsPos) targets.push({ x: lvl.stairsPos.x, y: lvl.stairsPos.y });

  for (const t of targets) {
    const vis = getReachable();
    if (vis[t.y]?.[t.x]) continue;
    const q = [[startX, startY]];
    const parent = new Map([[`${startX},${startY}`, null]]);
    let found = false;
    while (q.length > 0) {
      const [x, y] = q.shift();
      if (x === t.x && y === t.y) { found = true; break; }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        const key = `${nx},${ny}`;
        if (nx < 1 || ny < 1 || nx >= MAP_W - 1 || ny >= MAP_H - 1 || parent.has(key)) continue;
        const isTargetDoor = t.isDoor && nx === t.x && ny === t.y;
        if (!isTargetDoor && isBossPerimeterOrInside(nx, ny)) continue;
        parent.set(key, `${x},${y}`);
        q.push([nx, ny]);
      }
    }
    if (found) {
      let cur = `${t.x},${t.y}`;
      while (cur) {
        const [px, py] = cur.split(",").map(Number);
        lvl.grid[py][px] = TILE.FLOOR;
        cur = parent.get(cur);
      }
      repaired = true;
    }
  }
  return repaired;
}

export function restoreRun(saved) {
  if (saved.level?.props) {
    for (const pr of saved.level.props) {
      if (pr.kind === "torch") pr.solid = false;
    }
  }
  if (saved.player.heroClass === "soldier") {
    saved.player.heroClass = "ranger";
  } else if (saved.player.heroClass === "paladin") {
    saved.player.heroClass = "gilded";
  }
  if (!Array.isArray(saved.player.relics)) {
    saved.player.relics = [];
  }
  if (!saved.player.skillRanks) {
    saved.player.skillRanks = Object.fromEntries(SPELLS.map((s) => [s.id, 0]));
  } else {
    for (const s of SPELLS) {
      if (saved.player.skillRanks[s.id] === undefined) saved.player.skillRanks[s.id] = 0;
    }
  }
  if (!saved.spellCooldowns) {
    saved.spellCooldowns = Object.fromEntries(SPELLS.map((s) => [s.id, 0]));
  } else {
    for (const s of SPELLS) {
      if (saved.spellCooldowns[s.id] === undefined) saved.spellCooldowns[s.id] = 0;
    }
  }
  if (!Array.isArray(saved.player.loadout) || saved.player.loadout.length !== 4) {
    saved.player.loadout = [...DEFAULT_LOADOUT];
  }
  if (saved.player.skillPoints === undefined) {
    saved.player.skillPoints = Math.max(0, (saved.player.level || 1) - 1);
  }
  if (!Array.isArray(saved.player.shortcuts)) {
    saved.player.shortcuts = ["health_potion", "mana_potion", null, null];
  }
  if (typeof saved.player.maxInventory !== "number" || saved.player.maxInventory < 1) {
    saved.player.maxInventory = 15;
  }
  if (!Array.isArray(saved.level.groundItems)) saved.level.groundItems = [];
  if (!Array.isArray(saved.level.shops)) saved.level.shops = [];
  if (!Array.isArray(saved.level.traps)) saved.level.traps = [];

  const migrateEquipItem = (it) => {
    if (!it) return it;
    if (it.slot === "shield") {
      it.slot = "subweapon";
      if (!it.subType) it.subType = "shield";
    }
    return it;
  };
  if (saved.player.equipment) {
    if (saved.player.equipment.shield !== undefined) {
      saved.player.equipment.subweapon = saved.player.equipment.shield;
      delete saved.player.equipment.shield;
    }
    if (saved.player.equipment.subweapon === undefined) saved.player.equipment.subweapon = null;
    if (saved.player.equipment.earrings === undefined) saved.player.equipment.earrings = null;
    for (const k of Object.keys(saved.player.equipment)) {
      saved.player.equipment[k] = migrateEquipItem(saved.player.equipment[k]);
    }
  }
  if (Array.isArray(saved.player.inventory)) saved.player.inventory.forEach(migrateEquipItem);
  if (Array.isArray(saved.level.groundItems)) saved.level.groundItems.forEach((g) => migrateEquipItem(g.item));

  if (Array.isArray(saved.level.props)) {
    saved.level.props = saved.level.props.filter((pr) => !((pr.kind === "shrine" || pr.kind === "anvil") && pr.used));
    for (const pr of saved.level.props) {
      if (["shrine", "anvil", "well"].includes(pr.kind)) pr.solid = false;
    }
  }
  const repairedCorridor = repairSavedFloorIfDisconnected(saved.level, saved.player);
  saved.player.z = 0;
  saved.player.leap = null;
  saved.player.ultCharge = null;
  saved.player.rapidSlash = null;
  saved.player.stunTimer = 0;
  saved.player.tempDef = 0;
  saved.player.tempDefTimer = 0;
  document.body.classList.remove("pvp-active");
  runtime.state = {
    floor: saved.floor,
    difficulty: saved.difficulty || "normal",
    isEndless: Boolean(saved.isEndless),
    level: saved.level,
    elapsed: saved.elapsed || 0,
    kills: saved.kills || 0,
    startedByUser: true,
    runEnded: false,
    dyingTimer: 0,
    pendingVictory: false,
    bossFightStarted: Boolean(saved.bossFightStarted),
    hasBossKey: Boolean(saved.hasBossKey),
    bossKeyDrop: saved.bossKeyDrop || null,
    camReveal: null,
    bossIntroTimer: 0,
    hitstop: 0,
    shake: 0,
    mpRegenTimer: 0,
    saveTimer: 0,
    npcCooldown: 0,
    shopCooldown: 0,
    forgeCooldown: 0,
    shrineCooldown: 0,
    stairsCooldown: 0,
    invFullMsgCd: 0,
    lastFovTile: { x: -1, y: -1 },
    seenBosses: new Set(saved.seenBosses || []),
    shardsCollected: (() => { const sc = [...(saved.shardsCollected || [])]; while (sc.length < 4) sc.push(false); return sc; })(),
    spellCooldowns: saved.spellCooldowns || Object.fromEntries(SPELLS.map((s) => [s.id, 0])),
    player: saved.player,
    projectiles: [],
    slashes: [],
    rings: [],
    groundDecals: [],
    vfxAnims: [],
    pendingMeteors: [],
    beams: [],
    arrowStorms: [],
    gravityWells: [],
    frostZones: [],
    fallingArrows: [],
    enemyHazards: [],
    afterimages: [],
    floatingTexts: [],
    particles: [],
  };

  updateFOVIfNeeded(true);
  clearLog();
  addLog(`Welcome back, ${runtime.state.player.name || "Sir Aldric"}! Resumed Floor ${runtime.state.floor}.`, "story");
  if (repairedCorridor) {
    addLog("A sealed passage on this floor has been reopened!", "story");
    saveRun();
  }
  showFloorBanner(`Resumed Floor ${runtime.state.floor} — ${runtime.state.level.act.name}`);
  if (worldHooks.buildSpellButtons) worldHooks.buildSpellButtons();
  if (worldHooks.updateUI) worldHooks.updateUI();
}

export function descendFloor() {
  const s = runtime.state;
  s.floor += 1;
  if (s.floor > runtime.meta.bestFloor) {
    runtime.meta.bestFloor = s.floor;
    saveMeta();
  }
  if (s.isEndless && s.floor > (runtime.meta.endlessBestFloor || 0)) {
    runtime.meta.endlessBestFloor = s.floor;
    saveMeta();
  }
  s.level = generateFloor(s.floor, s.difficulty || "normal");
  s.bossFightStarted = false;
  s.hasBossKey = false;
  s.bossKeyDrop = null;
  s.invFullMsgCd = 0;
  s.shopCooldown = 0;
  s.forgeCooldown = 0;
  s.shrineCooldown = 0;
  s.camReveal = null;
  s.bossIntroTimer = 0;
  const bossBar = document.getElementById("boss-hud-bar");
  if (bossBar) bossBar.hidden = true;
  const introEl = document.getElementById("boss-intro-overlay");
  if (introEl) introEl.hidden = true;
  s.player.x = s.level.playerStart.x + 0.5;
  s.player.y = s.level.playerStart.y + 0.5;
  s.player.z = 0;
  s.player.leap = null;
  s.player.valiantCharge = null;
  s.player.radiantCharge = null;
  s.player.ultCharge = null;
  s.player.rapidSlash = null;
  s.player.stunTimer = 0;
  s.player.tempDef = 0;
  s.player.tempDefTimer = 0;
  s.projectiles = [];
  s.slashes = [];
  s.rings = [];
  s.groundDecals = [];
  s.vfxAnims = [];
  s.beams = [];
  s.arrowStorms = [];
  s.gravityWells = [];
  s.frostZones = [];
  s.fallingArrows = [];
  s.enemyHazards = [];
  s.afterimages = [];
  const stats = getPlayerStats();
  s.player.mp = Math.min(stats.maxMp, s.player.mp + 4);
  updateFOVIfNeeded(true);
  sfx.stairs();
  showFloorBanner(`Floor ${s.floor} — ${s.level.act.name}`);
  addLog(`Descended to Floor ${s.floor} (${s.level.act.name}).`, "story");
  checkBossSpotted();
  runtime.uiDirty = true;
  saveRun();
}

export function enterEndlessMode() {
  const s = runtime.state;
  if (!s) return;
  s.runEnded = false;
  s.isEndless = true;
  const stats = getPlayerStats();
  s.player.hp = stats.maxHp;
  s.player.mp = stats.maxMp;
  descendFloor();
}

export function triggerNearbyInteract() {
  const s = runtime.state;
  const ni = runtime.nearbyInteractable;
  if (!s || s.runEnded || !ni || !ni.target) return false;
  if (ni.kind === "shop" && worldHooks.openShopDialog) {
    worldHooks.openShopDialog(ni.target);
    return true;
  }
  if (ni.kind === "npc" && worldHooks.openStoryDialog) {
    worldHooks.openStoryDialog(ni.target);
    return true;
  }
  if (["anvil", "shrine", "well"].includes(ni.kind)) {
    interactProp(ni.target);
    return true;
  }
  return false;
}

export function interactProp(prop) {
  const s = runtime.state;
  const p = s.player;
  if (prop.kind === "chest" && !prop.opened) {
    prop.opened = true;
    prop.solid = false;
    sfx.loot();
    const gold = 12 + s.floor * 5;
    p.gold += gold;
    const drop = Math.random() < 0.14
      ? (Math.random() < 0.45 ? ITEMS.scroll_smite : Math.random() < 0.5 ? ITEMS.health_potion : ITEMS.mana_potion)
      : rollEquipmentByFloor(s.floor, "chest");
    const rInfo = getRarityInfo(drop);
    spawnBurst(prop.x + 0.5, prop.y + 0.5, rInfo.color, 14);
    if (giveOrDropItem(drop, prop.x + 0.5, prop.y + 0.5)) {
      addFloat(prop.x + 0.5, prop.y + 0.5, `+${drop.name}`, rInfo.color);
      addLog(`Opened chest: found ${gold} Gold and [${rInfo.label}] ${drop.name}!`, "loot");
    } else {
      addFloat(prop.x + 0.5, prop.y + 0.5, "Inventory is full!", "#f87171");
      addLog(`Opened chest: found ${gold} Gold and [${rInfo.label}] ${drop.name}, left on ground.`, "info");
    }
    runtime.uiDirty = true;
  } else if (prop.kind === "trial_chest" && !prop.opened) {
    prop.opened = true;
    prop.solid = false;
    sfx.ultSlam();
    s.shake = Math.max(s.shake, 7);
    spawnRing(prop.x + 0.5, prop.y + 0.5, 58, "#a855f7", 0.45);
    addFloat(prop.x + 0.5, prop.y + 0.2, "MIMIC AMBUSH!", "#c084fc");
    addLog("It was a Mimic Chest! Defeat the ambush guardians for your reward!", "story");

    // Grant immediate Relic or Rare+ gear reward, and summon 2 guardians (1 Elite)
    const relic = grantRandomRelic(p);
    if (relic) {
      addFloat(prop.x + 0.5, prop.y - 0.3, `Relic: ${relic.name}!`, relic.color);
      addLog(`Claimed Relic [${relic.name}]: ${relic.desc}`, "loot");
    } else {
      const highPool = Object.values(ITEMS).filter((it) => it.slot && ["rare", "unique", "legendary"].includes(it.rarity));
      const drop = highPool[Math.floor(Math.random() * highPool.length)];
      giveOrDropItem(drop, prop.x + 0.5, prop.y + 0.5);
      addLog(`Trial Chest rewarded [${drop.name}]!`, "loot");
    }

    const eliteKeys = Object.keys(ELITE_AFFIXES);
    const guardPool = s.floor <= 4 ? ["skeleton", "goblin_slinger"] : s.floor <= 8 ? ["orc", "clockwork_sentinel"] : ["clockwork_sentinel", "void_acolyte"];
    for (let k = 0; k < 2; k++) {
      const ang = k * Math.PI + 0.6;
      const gx = prop.x + 0.5 + Math.cos(ang) * 1.4;
      const gy = prop.y + 0.5 + Math.sin(ang) * 1.4;
      const sx = canOccupy(gx, gy, 0.28) ? gx : prop.x + 0.5;
      const sy = canOccupy(gx, gy, 0.28) ? gy : prop.y + 0.5;
      const affix = k === 0 ? eliteKeys[Math.floor(Math.random() * eliteKeys.length)] : null;
      const tplId = guardPool[Math.floor(Math.random() * guardPool.length)];
      s.level.enemies.push(createScaledEnemy(tplId, s.floor, s.difficulty, 1, sx, sy, { affix }));
      spawnBurst(sx, sy, "#a855f7", 14, 1.2);
    }
    runtime.uiDirty = true;
  } else if (prop.kind === "shrine" && !prop.used && (s.shrineCooldown || 0) <= 0) {
    if (worldHooks.openShrineDialog) worldHooks.openShrineDialog(prop);
  } else if (prop.kind === "anvil" && !prop.used && (s.forgeCooldown || 0) <= 0) {
    if (worldHooks.openForgeDialog) worldHooks.openForgeDialog(prop);
  } else if (["crate", "barrel", "urn"].includes(prop.kind) && !prop.broken) {
    prop.broken = true;
    prop.solid = false;
    sfx.hit();
    spawnBurst(prop.x + 0.5, prop.y + 0.5, "#b45309", 10);
    if (Math.random() < 0.5) {
      const gold = 4 + Math.floor(Math.random() * 7);
      p.gold += gold;
      addFloat(prop.x + 0.5, prop.y + 0.5, `+${gold}g`, "#fde047");
      addLog(`Smashed ${prop.kind}: found ${gold} Gold.`, "loot");
    } else if (Math.random() < 0.45) {
      if (giveOrDropItem(ITEMS.bread, prop.x + 0.5, prop.y + 0.5)) {
        addFloat(prop.x + 0.5, prop.y + 0.5, "+Hearth Loaf", "#86efac");
        addLog(`Smashed ${prop.kind}: found a Hearth Loaf.`, "loot");
      } else {
        addFloat(prop.x + 0.5, prop.y + 0.5, "Inventory is full!", "#f87171");
      }
    } else {
      addLog(`Smashed ${prop.kind}—empty.`, "info");
    }
    runtime.uiDirty = true;
  } else if (prop.kind === "well") {
    if (!prop.used) {
      prop.used = true;
      const stats = getPlayerStats();
      const hpGain = Math.round(stats.maxHp * 0.5);
      const mpGain = Math.round(stats.maxMp * 0.5);
      p.hp = Math.min(stats.maxHp, p.hp + hpGain);
      p.mp = Math.min(stats.maxMp, p.mp + mpGain);
      sfx.heal();
      addFloat(prop.x + 0.5, prop.y + 0.5, `+${hpGain} HP`, "#4ade80");
      spawnBurst(prop.x + 0.5, prop.y + 0.5, "#38bdf8", 14);
      addLog(`You drink from the Sanctum Well (+${hpGain} HP, +${mpGain} MP).`, "heal");
      runtime.uiDirty = true;
    }
  } else if (prop.kind === "door") {
    if (prop.locked) {
      if (prop.isBossDoor && s.bossFightStarted) {
        if ((s.doorMsgCd || 0) <= 0) {
          s.doorMsgCd = 1.4;
          addFloat(prop.x + 0.5, prop.y + 0.5, "Arena Sealed!", "#fca5a5");
        }
        return;
      }
      if (prop.isBossDoor && s.hasBossKey) {
        prop.locked = true;
        prop.opened = false;
        prop.solid = true;
        sfx.loot();
        addFloat(prop.x + 0.5, prop.y + 0.5, "ARENA SEALED!", "#facc15");
        spawnBurst(prop.x + 0.5, prop.y + 0.5, "#facc15", 14);
        addLog("Entered the Boss Chamber — the door slams shut behind you!", "story");

        const rooms = s.level.rooms || [];
        const bossRoom = rooms[rooms.length - 1];
        if (bossRoom) {
          let inX = prop.x + 0.5;
          let inY = prop.y + 0.5;
          if (prop.x < bossRoom.x) inX = bossRoom.x + 0.9;
          else if (prop.x >= bossRoom.x + bossRoom.w) inX = bossRoom.x + bossRoom.w - 0.9;
          else if (prop.y < bossRoom.y) inY = bossRoom.y + 0.9;
          else if (prop.y >= bossRoom.y + bossRoom.h) inY = bossRoom.y + bossRoom.h - 0.9;
          p.x = inX;
          p.y = inY;
        }

        revealBossRoom(s.level, true);
        updateFOVIfNeeded(true);
        checkBossSpotted();
        const boss = s.level.enemies.find((e) => e.isBoss);
        if (boss && !s.bossFightStarted) startBossMatch(boss, true);
      } else if ((s.doorMsgCd || 0) <= 0) {
        s.doorMsgCd = 1.4;
        addFloat(prop.x + 0.5, prop.y + 0.5, "Need Boss Key!", "#fca5a5");
        addLog("Locked! Defeat all enemies on this floor to get the Boss Key.", "info");
      }
      return;
    }
    if (!prop.opened) {
      prop.opened = true;
      prop.solid = false;
      sfx.step();
    }
  }
}

combatHooks.interactProp = interactProp;

export function updateSimulation(dt) {
  const s = runtime.state;
  if (!s || s.runEnded) return;

  if (s.hitstop > 0) {
    s.hitstop = Math.max(0, s.hitstop - dt);
    return;
  }

  s.elapsed += dt;
  s.shake = Math.max(0, s.shake - dt * 18);
  s.npcCooldown = Math.max(0, s.npcCooldown - dt);
  s.shopCooldown = Math.max(0, (s.shopCooldown || 0) - dt);
  s.forgeCooldown = Math.max(0, (s.forgeCooldown || 0) - dt);
  s.shrineCooldown = Math.max(0, (s.shrineCooldown || 0) - dt);
  s.stairsCooldown = Math.max(0, (s.stairsCooldown || 0) - dt);
  s.doorMsgCd = Math.max(0, (s.doorMsgCd || 0) - dt);
  s.saveTimer = (s.saveTimer || 0) + dt;
  if (s.saveTimer >= 5.0) {
    s.saveTimer = 0;
    if (!s.isPvp) saveRun();
  }

  if (s.isPvp) updatePvpFrame(dt);
  if (worldHooks.updateRoomAndBossHUD) worldHooks.updateRoomAndBossHUD();

  if (s.camReveal) {
    s.camReveal.timer -= dt;
    if (s.camReveal.timer <= 0) s.camReveal = null;
    return;
  }

  if (s.bossIntroTimer > 0) {
    s.bossIntroTimer -= dt;
    if (s.bossIntroTimer <= 0) {
      const introEl = document.getElementById("boss-intro-overlay");
      if (introEl) introEl.hidden = true;
    }
    return;
  }

  if (s.isPvp && (s.pvpIntroTimer || 0) > 0) {
    if (syncPvpIntroTimer(s) > 0) return;
  }

  const p = s.player;
  const stats = getPlayerStats();

  if (s.isPvp && s.pvpRoundEnded) {
    if (p.animTimer > 0) p.animTimer = Math.max(0, p.animTimer - dt);
    for (let i = s.particles.length - 1; i >= 0; i--) {
      const pt = s.particles[i];
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.life -= dt;
      if (pt.life <= 0) s.particles.splice(i, 1);
    }
    for (let i = s.floatingTexts.length - 1; i >= 0; i--) {
      const ft = s.floatingTexts[i];
      ft.y += ft.vy * dt;
      ft.life -= dt;
      if (ft.life <= 0) s.floatingTexts.splice(i, 1);
    }
    for (let i = s.vfxAnims.length - 1; i >= 0; i--) {
      s.vfxAnims[i].life -= dt;
      if (s.vfxAnims[i].life <= 0) s.vfxAnims.splice(i, 1);
    }
    return;
  }

  if (s.isPvp && !s.pvpRoundEnded) {
    s.pvpRoundTimer = Math.max(0, (s.pvpRoundTimer ?? 99) - dt);
    if (s.pvpRoundTimer <= 0 && !s.pvpTimeoutSent) {
      s.pvpTimeoutSent = true;
      notifyLocalPvpTimeout();
    }
  }

  if (!s.isPvp && p.hp <= 0 && s.dyingTimer <= 0) {
    p.hp = 0;
    p.anim = "death";
    s.dyingTimer = 0.05;
  }

  if (s.dyingTimer > 0) {
    s.dyingTimer -= dt;
    if (s.dyingTimer <= 0 && combatHooks.endRun) {
      combatHooks.endRun(false);
    }
    return;
  }

  p.attackCd = Math.max(0, p.attackCd - dt);
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.iFrames = Math.max(0, p.iFrames - dt);
  p.stunTimer = Math.max(0, (p.stunTimer || 0) - dt);
  p.frozenTimer = Math.max(0, (p.frozenTimer || 0) - dt);
  p.sunderTimer = Math.max(0, (p.sunderTimer || 0) - dt);
  p.aegisHeartCd = Math.max(0, (p.aegisHeartCd || 0) - dt);

  if (p.tempDefTimer > 0) {
    p.tempDefTimer = Math.max(0, p.tempDefTimer - dt);
    if (p.tempDefTimer <= 0) { p.tempDef = 0; runtime.uiDirty = true; }
  }
  if (p.tempAtkTimer > 0) {
    p.tempAtkTimer = Math.max(0, p.tempAtkTimer - dt);
    if (p.tempAtkTimer <= 0) { p.tempAtk = 0; runtime.uiDirty = true; }
  }
  if (p.hasteTimer > 0) {
    p.hasteTimer = Math.max(0, p.hasteTimer - dt);
    if (p.hasteTimer <= 0) p.hasteBonus = 0;
  }
  if ((p.pvpDmgTimer || 0) > 0) {
    p.pvpDmgTimer = Math.max(0, p.pvpDmgTimer - dt);
    if (p.pvpDmgTimer <= 0) p.pvpDmgMult = 1;
  }
  if ((p.regenTimer || 0) > 0) {
    p.regenTimer = Math.max(0, p.regenTimer - dt);
    p.regenTickTimer = (p.regenTickTimer ?? 0.5) - dt;
    if (p.regenTickTimer <= 0) {
      p.regenTickTimer += 0.5;
      const heal = Math.max(1, Math.round(stats.maxHp * (p.regenPctPerSec || 0.025) * 0.5));
      p.hp = Math.min(stats.maxHp, p.hp + heal);
      addFloat(p.x, p.y - 0.35, `+${heal}`, "#4ade80");
      runtime.uiDirty = true;
    }
  }
  if ((p.manaShieldTimer || 0) > 0) p.manaShieldTimer = Math.max(0, p.manaShieldTimer - dt);

  if (p.aegisBlast) {
    p.aegisBlast.timer -= dt;
    if (p.aegisBlast.timer <= 0) {
      const ab = p.aegisBlast;
      p.aegisBlast = null;
      sfx.nova();
      s.shake = Math.max(s.shake, 7);
      spawnBurst(p.x, p.y, "#38bdf8", 22, 1.35);
      spawnRing(p.x, p.y, ab.radius * TILE_SIZE, "#facc15", 0.38);
      spawnVfxAnim(p.x, p.y, "vfx_shockwave_ring", ab.radius * TILE_SIZE * 2.0, 0.5);
      spawnGroundDecal(p.x, p.y, "vfx_aegis_guard", ab.radius * TILE_SIZE * 2.0, 0.38, { scaleStart: 0.55, scaleEnd: 1.15, spin: 1.0 });
      if (s.isPvp) {
        broadcastPvpAction({ kind: "ring", x: p.x, y: p.y, radPx: ab.radius * TILE_SIZE, color: "#facc15", dur: 0.38 });
        broadcastPvpAction({ kind: "decal", x: p.x, y: p.y, sheetKey: "vfx_aegis_guard", sizePx: ab.radius * TILE_SIZE * 2.0, duration: 0.38, opts: { scaleStart: 0.55, scaleEnd: 1.15, spin: 1.0 } });
      }
      for (const e of [...s.level.enemies]) {
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= ab.radius + 0.35) {
          e.stunTimer = Math.max(e.stunTimer || 0, ab.stun);
          e.windupTimer = 0;
          const nx = dist > 0.01 ? dx / dist : 0;
          const ny = dist > 0.01 ? dy / dist : 0;
          damageEnemy(e, Math.round(stats.atk * 0.9), false, ab.spell.name, nx * 5.8, ny * 5.8, { isSkill: true, isAoe: true, stunDur: ab.stun });
          addFloat(e.x, e.y - 0.4, "STUNNED!", "#38bdf8");
        }
      }
    }
  }

  if (p.retributionTimer > 0) {
    p.retributionTimer = Math.max(0, p.retributionTimer - dt);
    p.retributionTick = (p.retributionTick || 0) - dt;
    if (p.retributionTick <= 0) {
      p.retributionTick = 1.0;
      const rad = p.retributionRadius || 2.1;
      for (const e of [...s.level.enemies]) {
        if (Math.hypot(e.x - p.x, e.y - p.y) <= rad + 0.3) {
          damageEnemy(e, p.retributionBurn || 5, false, "Seal of Retribution", 0, 0, { isSkill: true, isAoe: true });
        }
      }
    }
  }

  if (p.rapidSlash) {
    p.rapidSlash.timer -= dt;
    if (p.rapidSlash.timer <= 0) {
      const rs = p.rapidSlash;
      const sp = rs.spell;
      const rIdx = rs.rankIdx;
      const dmg = Math.round(stats.atk * sp.mults[rIdx]) + sp.flats[rIdx];
      const flipY = rs.remaining % 2 === 0;
      const ang = rs.angle + (flipY ? -0.18 : 0.18);
      sfx.slash();
      p.anim = "attack";
      p.animTimer = 0.14;
      spawnVfxAnim(p.x, p.y, "vfx_rapier_flurry", 88, 0.28, {
        angle: ang,
        anchorX: 0.12,
        anchorY: 0.5,
      });
      if (s.isPvp) {
        broadcastPvpAction({
          kind: "vfx_anim",
          x: p.x,
          y: p.y,
          sheetKey: "vfx_rapier_flurry",
          sizePx: 88,
          duration: 0.28,
          opts: { angle: ang, anchorX: 0.12, anchorY: 0.5 },
        });
      }
      const dirX = Math.cos(rs.angle);
      const dirY = Math.sin(rs.angle);
      for (const e of [...s.level.enemies]) {
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= sp.range) {
          const dot = dist < 0.01 ? 1 : (dx / dist) * dirX + (dy / dist) * dirY;
          if (dot >= 0.05 || dist < 0.85) {
            e.chilled = Math.max(e.chilled || 0, 1.2);
            damageEnemy(e, dmg, false, sp.name, dirX * 1.4, dirY * 1.4, { isSkill: true });
          }
        }
      }
      rs.remaining -= 1;
      rs.timer = rs.interval;
      if (rs.remaining <= 0) p.rapidSlash = null;
    }
  }

  for (const sp of getActiveSpells(p)) {
    s.spellCooldowns[sp.id] = Math.max(0, s.spellCooldowns[sp.id] - dt);
  }

  s.mpRegenTimer += dt;
  if (s.mpRegenTimer >= 2.4) {
    s.mpRegenTimer -= 2.4;
    if (p.mp < stats.maxMp) {
      p.mp = Math.min(stats.maxMp, p.mp + 1);
      runtime.uiDirty = true;
    }
  }

  if (Math.abs(p.kbX) > 0.05 || Math.abs(p.kbY) > 0.05) {
    moveWithSlide(p, p.kbX * dt, p.kbY * dt, 0.28);
    const decay = Math.exp(-12 * dt);
    p.kbX *= decay;
    p.kbY *= decay;
  }

  if (p.ultCharge) {
    p.ultCharge.timer -= dt;
    p.anim = "attack";
    p.animTimer = 0.2;
    if (Math.random() < 0.55) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 10 + Math.random() * 24;
      s.particles.push({
        x: p.x * TILE_SIZE + Math.cos(ang) * rad,
        y: p.y * TILE_SIZE + Math.sin(ang) * rad - 10,
        vx: -Math.cos(ang) * 18,
        vy: -24 - Math.random() * 18,
        color: Math.random() < 0.5 ? "#fde047" : "#f59e0b",
        size: 3,
        life: 0.28,
        maxLife: 0.28,
      });
    }
    if (p.ultCharge.timer <= 0) {
      const { rankIdx, spell } = p.ultCharge;
      p.ultCharge = null;
      s.shake = 14;
      s.hitstop = 0.055;
      sfx.ultSlam();
      const radius = spell.radii[rankIdx];
      const dmg = Math.round(stats.atk * spell.mults[rankIdx]) + spell.flats[rankIdx];
      const stunDur = spell.stuns[rankIdx];
      const radPx = radius * TILE_SIZE;
      spawnRing(p.x, p.y, radPx * 0.95, "#ffffff", 0.34, { delay: 0, lineWidth: 2.2 });
      spawnRing(p.x, p.y, radPx * 1.12, "#fde047", 0.44, { delay: 0.08, lineWidth: 1.8 });
      spawnVfxAnim(p.x, p.y, "vfx_divine_beam", radPx * 1.45, 0.72, { anchorX: 0.5, anchorY: 0.92 });
      spawnVfxAnim(p.x, p.y, "vfx_holy_nova", radPx * 1.75, 0.62, { alpha: 0.9 });
      spawnVfxAnim(p.x, p.y, "vfx_shockwave_ring", radPx * 2.0, 0.48, { alpha: 0.75 });
      spawnBurst(p.x, p.y, "#fde047", 18, 1.35);
      if (s.isPvp) broadcastPvpAction({ kind: "ult_slam", x: p.x, y: p.y, radius });

      for (const e of [...s.level.enemies]) {
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= radius + 0.35) {
          e.stunTimer = Math.max(e.stunTimer || 0, stunDur);
          e.windupTimer = 0;
          const nx = dist > 0.01 ? dx / dist : 0;
          const ny = dist > 0.01 ? dy / dist : 0;
          damageEnemy(e, dmg, true, spell.name, nx * 4.5, ny * 4.5, { isSkill: true, isAoe: true, canInterrupt: true, stunDur });
          addFloat(e.x, e.y - 0.45, "STUNNED!", "#fde047");
        }
      }
    }
  } else if (p.radiantCharge) {
    const rc = p.radiantCharge;
    rc.timer -= dt;
    p.anim = "attack";
    p.animTimer = 0.18;
    let liveAng = null;
    if (touchAim.active && (Math.abs(touchAim.x) > 0.1 || Math.abs(touchAim.y) > 0.1)) {
      liveAng = Math.atan2(touchAim.y, touchAim.x);
    } else if (touchMove.active && (Math.abs(touchMove.x) > 0.1 || Math.abs(touchMove.y) > 0.1)) {
      liveAng = Math.atan2(touchMove.y, touchMove.x);
    } else {
      let kx = 0;
      let ky = 0;
      if (keys.has("w") || keys.has("arrowup")) ky -= 1;
      if (keys.has("s") || keys.has("arrowdown")) ky += 1;
      if (keys.has("a") || keys.has("arrowleft")) kx -= 1;
      if (keys.has("d") || keys.has("arrowright")) kx += 1;
      if (kx !== 0 || ky !== 0) liveAng = Math.atan2(ky, kx);
      else if (mouse.inside && mouse.x !== null) liveAng = Math.atan2(mouse.y - p.y, mouse.x - p.x);
    }
    if (liveAng !== null) {
      rc.angle = liveAng;
      p.aimAngle = liveAng;
      p.facingLeft = Math.cos(liveAng) < 0;
    }
    if (Math.random() < 0.7) {
      const ang = rc.angle + (Math.random() - 0.5) * 1.4;
      const distPx = 18 + Math.random() * 20;
      s.particles.push({
        x: p.x * TILE_SIZE + Math.cos(ang) * distPx,
        y: p.y * TILE_SIZE + Math.sin(ang) * distPx,
        vx: -Math.cos(ang) * 26,
        vy: -Math.sin(ang) * 26,
        color: Math.random() < 0.55 ? "#fb923c" : "#fde047",
        size: 3,
        life: 0.22,
        maxLife: 0.22,
      });
    }
    if (rc.timer <= 0) {
      p.radiantCharge = null;
      const dirX = Math.cos(rc.angle);
      const dirY = Math.sin(rc.angle);
      const waveSpeed = 10.8;
      const waveRange = rc.spell.range || 6.5;
      sfx.slash();
      sfx.nova();
      s.shake = Math.max(s.shake, 5.5);
      s.slashes.push({
        x: (p.x + dirX * 0.45) * TILE_SIZE,
        y: (p.y + dirY * 0.45) * TILE_SIZE,
        angle: rc.angle,
        radius: 44,
        variant: "gold",
        color: rc.spell.color || "#fb923c",
        life: 0.24,
        maxLife: 0.24,
      });
      spawnBurst(p.x + dirX * 0.5, p.y + dirY * 0.5, "#fb923c", 16, 1.2);
      spawnRing(p.x, p.y, 38, "#fde047", 0.28);
      spawnVfxAnim(p.x + dirX * 0.45, p.y + dirY * 0.45, "vfx_greatsword_sweep", 104, 0.38, { angle: rc.angle });
      s.projectiles.push({
        x: p.x + dirX * 0.65, y: p.y + dirY * 0.65, vx: dirX * waveSpeed, vy: dirY * waveSpeed,
        dmg: rc.dmg, color: rc.spell.color || "#fb923c", radius: 0.95, life: waveRange / waveSpeed, maxLife: waveRange / waveSpeed,
        isEnemy: false, isSlashWave: true, isSkill: true, pierce: true, hitIds: new Set(), sunderDur: rc.spell.sunderDur || 5.0, label: rc.spell.name,
      });
      if (s.isPvp) {
        broadcastPvpAction({ kind: "radiant_release", x: p.x, y: p.y, slashX: p.x + dirX * 0.45, slashY: p.y + dirY * 0.45, angle: rc.angle, color: rc.spell.color || "#fb923c" });
        broadcastPvpAction({
          kind: "projectile",
          x: p.x + dirX * 0.65,
          y: p.y + dirY * 0.65,
          vx: dirX * waveSpeed,
          vy: dirY * waveSpeed,
          radius: 0.95,
          color: rc.spell.color || "#fb923c",
          isSlashWave: true,
          pierce: true,
          life: waveRange / waveSpeed,
        });
      }
    }
  } else if (p.valiantCharge) {
    const vc = p.valiantCharge;
    vc.timer -= dt;
    if (vc.phase === "windup") {
      p.anim = "attack";
      let liveAng = null;
      if (touchAim.active && (Math.abs(touchAim.x) > 0.1 || Math.abs(touchAim.y) > 0.1)) {
        liveAng = Math.atan2(touchAim.y, touchAim.x);
      } else if (touchMove.active && (Math.abs(touchMove.x) > 0.1 || Math.abs(touchMove.y) > 0.1)) {
        liveAng = Math.atan2(touchMove.y, touchMove.x);
      } else {
        let kx = 0;
        let ky = 0;
        if (keys.has("w") || keys.has("arrowup")) ky -= 1;
        if (keys.has("s") || keys.has("arrowdown")) ky += 1;
        if (keys.has("a") || keys.has("arrowleft")) kx -= 1;
        if (keys.has("d") || keys.has("arrowright")) kx += 1;
        if (kx !== 0 || ky !== 0) liveAng = Math.atan2(ky, kx);
        else if (mouse.inside && mouse.x !== null) liveAng = Math.atan2(mouse.y - p.y, mouse.x - p.x);
      }
      if (liveAng !== null) {
        vc.dirX = Math.cos(liveAng);
        vc.dirY = Math.sin(liveAng);
        p.aimAngle = liveAng;
        p.facingLeft = vc.dirX < 0;
        let endX = vc.startX;
        let endY = vc.startY;
        const maxDist = vc.spell.dist || 5.5;
        const step = 0.25;
        for (let d = step; d <= maxDist; d += step) {
          const nx = vc.startX + vc.dirX * d;
          const ny = vc.startY + vc.dirY * d;
          if (
            Math.hypot(nx - vc.startX, ny - vc.startY) <= maxDist &&
            !s.level.props.some((pr) => pr.solid && pr.x === Math.floor(nx) && pr.y === Math.floor(ny)) &&
            s.level.grid[Math.floor(ny)]?.[Math.floor(nx)] !== TILE.WALL
          ) {
            endX = nx;
            endY = ny;
          } else {
            break;
          }
        }
        vc.targetX = endX;
        vc.targetY = endY;
        vc.travelDist = Math.hypot(endX - vc.startX, endY - vc.startY);
        vc.spearDistMax = Math.max(1.65, vc.travelDist);
        vc.speed = vc.travelDist > 0.05 ? vc.travelDist / vc.dashDur : 0;
      }
      const prog = Math.min(1, 1 - vc.timer / vc.windupDur);
      const eased = 1 - Math.pow(1 - prog, 2.2);
      const spearDist = 0.55 + (vc.spearDistMax - 0.55) * eased;
      const tipX = vc.startX + vc.dirX * spearDist;
      const tipY = vc.startY + vc.dirY * spearDist;
      const thrustDmg = Math.max(1, Math.round(vc.baseDmg * 0.4));
      for (const e of [...s.level.enemies]) {
        if (!vc.piercedIds.has(e.uid) && distPointToSegment(e.x, e.y, vc.startX, vc.startY, tipX, tipY) <= 0.92) {
          vc.piercedIds.add(e.uid);
          damageEnemy(e, thrustDmg, false, `${vc.spell.name} Thrust`, vc.dirX * 1.4, vc.dirY * 1.4, { isSkill: true, pierce: true });
          spawnBurst(e.x, e.y, "#38bdf8", 10, 1.15);
          spawnRing(e.x, e.y, 26, "#fde047", 0.25);
        }
      }
      if (vc.timer <= 0) {
        vc.phase = "dash";
        vc.timer = vc.dashDur;
        sfx.dash();
        s.shake = Math.max(s.shake, 7);
        spawnBurst(p.x, p.y, "#38bdf8", 14, 1.25);
        spawnRing(p.x, p.y, 34, "#facc15", 0.25);
        if (s.isPvp) broadcastPvpAction({ kind: "valiant_dash", x: p.x, y: p.y, dashDur: vc.dashDur });
      }
    } else {
      const prevHeroX = p.x;
      const prevHeroY = p.y;
      const remDist = Math.max(0, vc.travelDist - vc.traveled);
      const stepDist = vc.travelDist > 0.05 ? Math.min(remDist, vc.speed * dt) : 0;
      if (stepDist > 0) moveWithSlide(p, vc.dirX * stepDist, vc.dirY * stepDist, 0.28);
      const stepMoved = Math.hypot(p.x - prevHeroX, p.y - prevHeroY);
      vc.traveled += stepMoved;

      s.afterimages.push({ x: p.x, y: p.y, facingLeft: p.facingLeft, frame: runtime.animFrame, life: 0.2, maxLife: 0.2 });
      if (s.afterimages.length > 10) s.afterimages.shift();
      for (let k = 0; k < 2; k++) {
        s.particles.push({
          x: p.x * TILE_SIZE + (Math.random() - 0.5) * 12,
          y: p.y * TILE_SIZE + (Math.random() - 0.5) * 12,
          vx: -vc.dirX * 55 + (Math.random() - 0.5) * 28,
          vy: -vc.dirY * 55 + (Math.random() - 0.5) * 28,
          color: Math.random() < 0.55 ? "#38bdf8" : "#facc15",
          size: 3.5,
          life: 0.24,
          maxLife: 0.24,
        });
      }

      const headTipX = p.x + vc.dirX * 1.15;
      const headTipY = p.y + vc.dirY * 1.15;
      for (const e of [...s.level.enemies]) {
        if (!vc.hitIds.has(e.uid) && distPointToSegment(e.x, e.y, prevHeroX, prevHeroY, headTipX, headTipY) <= 0.95) {
          vc.hitIds.add(e.uid);
          const prevX = e.x;
          const prevY = e.y;
          moveWithSlide(e, vc.dirX * 1.15, vc.dirY * 1.15, e.isBoss ? 0.38 : 0.28);
          const wallPinned = Math.hypot(e.x - prevX, e.y - prevY) < 0.45;
          const finalDmg = wallPinned ? Math.round(vc.baseDmg * (1 + vc.wallBonus)) : vc.baseDmg;
          damageEnemy(e, finalDmg, wallPinned, vc.spell.name, vc.dirX * 4.0, vc.dirY * 4.0, { isSkill: true, pierce: true });
          spawnBurst(e.x, e.y, "#38bdf8", 14, 1.3);
          spawnRing(e.x, e.y, wallPinned ? 44 : 32, "#facc15", 0.32);
          if (wallPinned) addFloat(e.x, e.y - 0.45, "WALL SLAM!", "#facc15");
        }
      }

      const blocked = stepDist > 0.02 && stepMoved < stepDist * 0.15;
      const reached = vc.travelDist <= 0.05 || vc.traveled >= vc.travelDist - 0.05;
      if (blocked || reached || vc.timer <= 0) {
        const finDmg = Math.max(2, Math.round(vc.baseDmg * 0.35));
        const ang = Math.atan2(vc.dirY, vc.dirX);
        const impactX = p.x + vc.dirX * 0.75;
        const impactY = p.y + vc.dirY * 0.75;
        p.valiantCharge = null;
        sfx.smite();
        sfx.heavyImpact();
        s.shake = Math.max(s.shake, 10);
        spawnBurst(impactX, impactY, "#facc15", 16, 1.35);
        spawnBurst(impactX, impactY, "#38bdf8", 12, 1.2);
        spawnRing(impactX, impactY, 1.65 * TILE_SIZE, "#38bdf8", 0.3, { delay: 0, lineWidth: 2.2 });
        spawnRing(impactX, impactY, 1.95 * TILE_SIZE, "#fde047", 0.38, { delay: 0.06, lineWidth: 1.8 });
        spawnVfxAnim(impactX, impactY, "vfx_spear_thrust", 112, 0.42, { angle: ang, anchorX: 0.25 });
        spawnVfxAnim(impactX, impactY, "vfx_shockwave_ring", 128, 0.48, { alpha: 0.85 });
        if (s.isPvp) broadcastPvpAction({ kind: "valiant_slam", x: impactX, y: impactY, angle: ang });
        for (const e of [...s.level.enemies]) {
          if (Math.hypot(e.x - impactX, e.y - impactY) <= 1.75 || Math.hypot(e.x - p.x, e.y - p.y) <= 1.35) {
            damageEnemy(e, finDmg, false, `${vc.spell.name} Burst`, vc.dirX * 3.5, vc.dirY * 3.5, { isSkill: true, isAoe: true });
          }
        }
        for (const pr of s.level.props) {
          if (pr.solid && ["crate", "barrel", "urn"].includes(pr.kind) && (Math.hypot(pr.x + 0.5 - impactX, pr.y + 0.5 - impactY) <= 1.6 || Math.hypot(pr.x + 0.5 - p.x, pr.y + 0.5 - p.y) <= 1.35)) {
            interactProp(pr);
          }
        }
      }
    }
  } else if (p.leap) {
    const { rankIdx, spell } = p.leap;
    p.leap.progress += dt / p.leap.duration;
    const t = Math.min(1, p.leap.progress);
    p.z = Math.sin(t * Math.PI) * p.leap.maxHeight;

    let mx = touchMove.active ? touchMove.x : 0;
    let my = touchMove.active ? touchMove.y : 0;
    if (keys.has("w") || keys.has("arrowup")) my -= 1;
    if (keys.has("s") || keys.has("arrowdown")) my += 1;
    if (keys.has("a") || keys.has("arrowleft")) mx -= 1;
    if (keys.has("d") || keys.has("arrowright")) mx += 1;
    if (mx !== 0 || my !== 0) {
      const len = Math.hypot(mx, my);
      mx /= len;
      my /= len;
      p.aimAngle = Math.atan2(my, mx);
      if (mx < -0.1) p.facingLeft = true;
      if (mx > 0.1) p.facingLeft = false;
      const airSpeed = stats.moveSpeed * 1.3;
      moveWithSlide(p, mx * airSpeed * dt, my * airSpeed * dt, 0.28);
    } else {
      moveWithSlide(p, p.leap.dirX * 2.2 * dt, p.leap.dirY * 2.2 * dt, 0.28);
    }

    if (Math.random() < 0.6) {
      s.particles.push({
        x: p.x * TILE_SIZE + (Math.random() - 0.5) * 14,
        y: p.y * TILE_SIZE - p.z * 0.65,
        vx: (Math.random() - 0.5) * 24,
        vy: 18 + Math.random() * 24,
        color: Math.random() < 0.5 ? "#fde047" : "#f97316",
        size: 3,
        life: 0.24,
        maxLife: 0.24,
      });
    }

    if (t >= 1) {
      p.z = 0;
      p.leap = null;
      s.shake = 18;
      s.hitstop = 0.065;
      sfx.ultSlam();
      sfx.heavyImpact();
      sfx.nova();
      const radius = spell.radii[rankIdx];
      const dmg = Math.round(stats.atk * spell.mults[rankIdx]) + spell.flats[rankIdx];
      const radPx = radius * TILE_SIZE;
      spawnRing(p.x, p.y, radPx * 0.95, "#ffffff", 0.34, { delay: 0, lineWidth: 2.2 });
      spawnRing(p.x, p.y, radPx * 1.12, "#fde047", 0.44, { delay: 0.08, lineWidth: 1.8 });
      spawnVfxAnim(p.x, p.y, "vfx_divine_beam", radPx * 1.45, 0.72, { anchorX: 0.5, anchorY: 0.92 });
      spawnVfxAnim(p.x, p.y, "vfx_holy_nova", radPx * 1.65, 0.62, { alpha: 0.85 });
      spawnVfxAnim(p.x, p.y, "vfx_shockwave_ring", radPx * 2.0, 0.48, { alpha: 0.75 });
      spawnBurst(p.x, p.y, "#fde047", 18, 1.35);
      if (s.isPvp) broadcastPvpAction({ kind: "leap_land", x: p.x, y: p.y, radius });

      for (const e of [...s.level.enemies]) {
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= radius + 0.45) {
          const nx = dist > 0.01 ? dx / dist : 0;
          const ny = dist > 0.01 ? dy / dist : 0;
          damageEnemy(e, dmg, true, spell.name, nx * 6.8, ny * 6.8, { isSkill: true, isAoe: true, canInterrupt: true });
        }
      }
      for (const pr of s.level.props) {
        if (pr.solid && ["crate", "barrel", "urn"].includes(pr.kind) && Math.hypot(pr.x + 0.5 - p.x, pr.y + 0.5 - p.y) <= radius) {
          interactProp(pr);
        }
      }
    }
  } else if (p.dashTimer > 0) {
    p.dashTimer -= dt;
    const dashSpeed = p.shieldDashHitIds ? 14.2 : 13.5;
    moveWithSlide(p, p.dashDirX * dashSpeed * dt, p.dashDirY * dashSpeed * dt, 0.28);
    s.afterimages.push({ x: p.x, y: p.y, facingLeft: p.facingLeft, frame: runtime.animFrame, life: 0.18, maxLife: 0.18 });
    if (p.shieldDashHitIds) {
      const bashDmg = Math.max(3, Math.round(stats.atk * 0.8 + stats.def * 0.5));
      for (const e of [...s.level.enemies]) {
        if (!p.shieldDashHitIds.has(e.uid) && Math.hypot(e.x - p.x, e.y - p.y) <= 1.35) {
          p.shieldDashHitIds.add(e.uid);
          damageEnemy(e, bashDmg, false, "Shield Bash", p.dashDirX * 4.6, p.dashDirY * 4.6, { pierce: true, canInterrupt: true, stunDur: 0.55 });
          spawnRing(e.x, e.y, 34, "#38bdf8", 0.26);
          if (s.isPvp) broadcastPvpAction({ kind: "ring", x: e.x, y: e.y, radPx: 34, color: "#38bdf8", dur: 0.26 });
        }
      }
      for (const pr of s.level.props) {
        if (pr.solid && ["crate", "barrel", "urn"].includes(pr.kind) && Math.hypot(pr.x + 0.5 - p.x, pr.y + 0.5 - p.y) <= 1.25) {
          interactProp(pr);
        }
      }
    } else if (p.heroClass === "gilded" && p.gildedDashHitIds) {
      const dmg = Math.max(2, Math.round(stats.atk * 0.75));
      for (const e of [...s.level.enemies]) {
        if (!p.gildedDashHitIds.has(e.uid) && Math.hypot(e.x - p.x, e.y - p.y) <= 1.25) {
          p.gildedDashHitIds.add(e.uid);
          damageEnemy(e, dmg, false, "Golden Afterimage", p.dashDirX * 2.5, p.dashDirY * 2.5, { pierce: true });
        }
      }
    }
  } else if ((p.stunTimer || 0) > 0 || (p.frozenTimer || 0) > 0) {
    p.vx = 0;
    p.vy = 0;
    if (p.animTimer <= 0) p.anim = "idle";
  } else {
    let mx = touchMove.active ? touchMove.x : 0;
    let my = touchMove.active ? touchMove.y : 0;
    if (keys.has("w") || keys.has("arrowup")) my -= 1;
    if (keys.has("s") || keys.has("arrowdown")) my += 1;
    if (keys.has("a") || keys.has("arrowleft")) mx -= 1;
    if (keys.has("d") || keys.has("arrowright")) mx += 1;

    if (mx !== 0 || my !== 0) {
      const len = Math.hypot(mx, my);
      mx /= len;
      my /= len;
      p.aimAngle = touchAim.active ? touchAim.angle : Math.atan2(my, mx);
      p.facingLeft = touchAim.active ? Math.cos(touchAim.angle) < 0 : (mx < -0.1 ? true : mx > 0.1 ? false : p.facingLeft);
      p.vx = mx * stats.moveSpeed;
      p.vy = my * stats.moveSpeed;
      moveWithSlide(p, p.vx * dt, p.vy * dt, 0.28);
      if (p.animTimer <= 0) p.anim = "walk";
      p.stepTimer += dt;
      if (p.stepTimer >= 0.24) { p.stepTimer = 0; sfx.step(); }
      p.dustTimer += dt;
      if (p.dustTimer >= 0.12) {
        p.dustTimer = 0;
        s.particles.push({
          x: p.x * TILE_SIZE + (Math.random() - 0.5) * 8,
          y: p.y * TILE_SIZE + 10,
          vx: (Math.random() - 0.5) * 14,
          vy: -8 - Math.random() * 10,
          color: "rgba(148, 163, 184, 0.7)",
          size: 3,
          life: 0.25,
          maxLife: 0.25,
        });
      }
    } else {
      p.vx = 0;
      p.vy = 0;
      if (p.animTimer <= 0) p.anim = "idle";
    }
  }

  if (p.animTimer > 0) {
    p.animTimer -= dt;
    if (p.animTimer <= 0) p.anim = "idle";
  }

  // Mobile Twin-Stick Attack Wheel: keep facing aimed angle and attack on cooldown while dragging/holding
  if (touchAim.active && !s.runEnded && s.dyingTimer <= 0) {
    p.aimAngle = touchAim.angle;
    p.facingLeft = Math.cos(touchAim.angle) < 0;
    if (p.attackCd <= 0) {
      performMeleeAttack();
    }
  } else if ((mouse.down || keys.has("j")) && !s.runEnded && s.dyingTimer <= 0 && !document.querySelector("dialog[open]")) {
    if (p.attackCd <= 0) {
      performMeleeAttack();
    }
  }

  updateFOVIfNeeded(false);

  // Floor Traps (hidden until stepped on; deals direct damage + 1.5s stun, then plays up/down spike animation)
  if (Array.isArray(s.level.traps)) {
    for (const tr of s.level.traps) {
      tr.hitCd = Math.max(0, (tr.hitCd || 0) - dt);
      tr.animTimer = Math.max(0, (tr.animTimer || 0) - dt);
      if (tr.hitCd <= 0) {
        const tx = tr.x + 0.5;
        const ty = tr.y + 0.5;
        const trapLabel = tr.kind === "void_vent" ? "Void Vent" : "Spike Trap";
        const trapColor = tr.kind === "void_vent" ? "#c084fc" : "#ef4444";
        let triggered = false;
        if (Math.hypot(p.x - tx, p.y - ty) <= 0.52 && (p.z || 0) <= 2) {
          triggered = true;
          const trapDmg = Math.round(5 + s.floor * 1.6);
          hurtPlayer(trapDmg, trapLabel, 0, 0);
          stunPlayer(1.5, trapLabel, trapColor);
        } else {
          for (const e of [...s.level.enemies]) {
            if (!e.isBoss && Math.hypot(e.x - tx, e.y - ty) <= 0.55) {
              triggered = true;
              damageEnemy(e, Math.round(6 + s.floor * 1.8), false, trapLabel, 0, 0, { noOnHit: true, isAoe: true });
              break;
            }
          }
        }
        if (triggered) {
          tr.hitCd = 2.6;
          tr.animDur = 1.15;
          tr.animTimer = 1.15;
          tr.bloodied = true;
          sfx.hit();
        }
      }
    }
  }

  const ptx = Math.floor(p.x);
  const pty = Math.floor(p.y);
  if (s.level.grid[pty]?.[ptx] === TILE.STAIRS && (s.stairsCooldown || 0) <= 0 && worldHooks.openStairsDialog) {
    worldHooks.openStairsDialog();
    return;
  }

  if (s.bossKeyDrop && Math.hypot(s.bossKeyDrop.x - p.x, s.bossKeyDrop.y - p.y) < 0.9) {
    s.hasBossKey = true;
    s.bossKeyDrop = null;
    sfx.loot();
    addFloat(p.x, p.y - 0.3, "+BOSS KEY!", "#facc15");
    spawnBurst(p.x, p.y, "#facc15", 16);
    addLog("Collected the Boss Key! Proceed to the Boss Chamber door.", "loot");
    saveRun();
  }

  s.invFullMsgCd = Math.max(0, (s.invFullMsgCd || 0) - dt);
  if (Array.isArray(s.level.groundItems) && s.level.groundItems.length > 0) {
    const remaining = [];
    let pickedAny = false;
    for (const gItem of s.level.groundItems) {
      gItem.fullMsgCd = Math.max(0, (gItem.fullMsgCd || 0) - dt);
      const dist = Math.hypot(gItem.x - p.x, gItem.y - p.y);
      if (gItem.requireLeave) {
        if (dist >= 0.75) gItem.requireLeave = false;
        remaining.push(gItem);
        continue;
      }
      if (dist < 0.72) {
        const qty = gItem.item.qty || 1;
        const maxInv = p.maxInventory || 15;
        const existing = gItem.item.type === "consumable" ? p.inventory.find((i) => i.id === gItem.item.id) : null;
        if (existing) {
          existing.qty += qty;
          sfx.loot();
          addFloat(gItem.x, gItem.y - 0.3, `+${gItem.item.name} x${qty}`, "#86efac");
          spawnBurst(gItem.x, gItem.y, "#86efac", 10);
          pickedAny = true;
          continue;
        } else if (p.inventory.length < maxInv) {
          p.inventory.push({ ...gItem.item, qty });
          sfx.loot();
          addFloat(gItem.x, gItem.y - 0.3, qty > 1 ? `+${gItem.item.name} x${qty}` : `+${gItem.item.name}`, "#86efac");
          spawnBurst(gItem.x, gItem.y, "#86efac", 10);
          pickedAny = true;
          continue;
        } else if ((gItem.fullMsgCd || 0) <= 0 && (s.invFullMsgCd || 0) <= 0) {
          gItem.fullMsgCd = 1.8;
          s.invFullMsgCd = 1.2;
          addFloat(p.x, p.y - 0.45, "Inventory is full!", "#f87171");
        }
      }
      remaining.push(gItem);
    }
    s.level.groundItems = remaining;
    if (pickedAny) {
      runtime.uiDirty = true;
      saveRun();
    }
  }

  runtime.nearbyInteractable = null;

  for (const pr of s.level.props) {
    if (pr.used || pr.opened || pr.broken) continue;
    const dist = Math.hypot(pr.x + 0.5 - p.x, pr.y + 0.5 - p.y);
    const autoKinds = s.isPvp
      ? ["door", "chest", "trial_chest", "crate", "barrel", "urn", "well"]
      : ["door", "chest", "trial_chest", "crate", "barrel", "urn"];
    if (pr.solid && dist < 1.0 && autoKinds.includes(pr.kind)) {
      interactProp(pr);
    }
  }

  // Find closest manual interactable (Forge, Shrine, Well, Shop, NPC) without forcing popups on walk-by
  let bestInteract = null;
  let bestDist = 1.25;
  const considerInteract = (dist, candidate) => {
    if (dist < bestDist) {
      bestDist = dist;
      bestInteract = candidate;
    }
  };

  for (const pr of s.level.props) {
    if (pr.used || pr.opened || pr.broken) continue;
    const dist = Math.hypot(pr.x + 0.5 - p.x, pr.y + 0.5 - p.y);
    if (dist >= 1.25) continue;
    if (pr.kind === "anvil") {
      considerInteract(dist, { kind: "anvil", target: pr, x: pr.x + 0.5, y: pr.y + 0.5, label: "Open Foundry Forge", color: "#fb923c" });
    } else if (pr.kind === "shrine") {
      const sTpl = SHRINE_ENCOUNTERS[pr.shrineId] || SHRINE_ENCOUNTERS.sanctum;
      const col = pr.shrineId === "blood" ? "#ef4444" : pr.shrineId === "aegis" ? "#facc15" : "#38bdf8";
      considerInteract(dist, { kind: "shrine", target: pr, x: pr.x + 0.5, y: pr.y + 0.5, label: `Use ${sTpl.title}`, color: col });
    } else if (pr.kind === "well" && !s.isPvp) {
      considerInteract(dist, { kind: "well", target: pr, x: pr.x + 0.5, y: pr.y + 0.5, label: "Drink Sanctum Well", color: "#38bdf8" });
    }
  }

  for (const npc of s.level.npcs || []) {
    if (npc.talked) continue;
    const dist = Math.hypot(npc.x + 0.5 - p.x, npc.y + 0.5 - p.y);
    const tpl = NPC_ENCOUNTERS[npc.id];
    considerInteract(dist, { kind: "npc", target: npc, x: npc.x + 0.5, y: npc.y + 0.5, label: `Talk to ${tpl?.speaker || "Traveler"}`, color: "#7dd3fc" });
  }

  if (!s.bossFightStarted && Array.isArray(s.level.shops)) {
    for (const shop of s.level.shops) {
      const dist = Math.hypot(shop.x + 0.5 - p.x, shop.y + 0.5 - p.y);
      considerInteract(dist, { kind: "shop", target: shop, x: shop.x + 0.5, y: shop.y + 0.5, label: `Open ${shop.name || "Shop"}`, color: "#fde047" });
    }
  }
  runtime.nearbyInteractable = bestInteract;

  if (s.level.isBossFloor && s.bossFightStarted) {
    for (const pr of s.level.props) {
      if (pr.kind === "door" && pr.isBossDoor) {
        pr.locked = true;
        pr.opened = false;
        pr.solid = true;
      }
    }
    const rooms = s.level.rooms || [];
    const bossRoom = rooms[rooms.length - 1];
    if (bossRoom) {
      p.x = Math.max(bossRoom.x + 0.35, Math.min(bossRoom.x + bossRoom.w - 0.35, p.x));
      p.y = Math.max(bossRoom.y + 0.35, Math.min(bossRoom.y + bossRoom.h - 0.35, p.y));
    }
  }

  updateEnemiesAndBosses(dt);

  // Projectiles
  for (let i = s.projectiles.length - 1; i >= 0; i--) {
    const pr = s.projectiles[i];
    const prevX = pr.x;
    const prevY = pr.y;
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;
    pr.life -= dt;
    if (pr.rehitCd > 0) pr.rehitCd = Math.max(0, pr.rehitCd - dt);

    if (Math.random() < 0.65) {
      s.particles.push({
        x: pr.x * TILE_SIZE, y: pr.y * TILE_SIZE,
        vx: (Math.random() - 0.5) * 18, vy: (Math.random() - 0.5) * 18,
        color: pr.color, size: 3, life: 0.2, maxLife: 0.2,
      });
    }

    const tx = Math.floor(pr.x);
    const ty = Math.floor(pr.y);
    const hitProp = !pr.isEnemy
      ? s.level.props.find((prop) => prop.solid && ["crate", "barrel", "urn"].includes(prop.kind) && prop.x === tx && prop.y === ty)
      : null;
    if (hitProp) interactProp(hitProp);

    const spawnFrostZone = (zx, zy) => {
      if (!s.frostZones) s.frostZones = [];
      sfx.frost();
      const rad = pr.frostRadius || 2.0;
      const dur = pr.frostDuration || 4.0;
      spawnRing(zx, zy, rad * TILE_SIZE, "#38bdf8", 0.38);
      spawnBurst(zx, zy, "#bae6fd", 16, 1.15);
      s.frostZones.push({
        x: zx, y: zy, radius: rad, timer: dur, maxTimer: dur,
        chillDur: typeof pr.chill === "number" ? pr.chill : 2.5, freezeDur: pr.frostFreezeDur || 1.5,
        shatterDmg: pr.frostShatterDmg || 3, isVisualOnly: Boolean(pr.isPvpVisual), dwell: new Map(), frozenIds: new Set(), particleCd: 0,
      });
      if (s.isPvp && !pr.isPvpVisual) {
        broadcastPvpAction({ kind: "frost_zone", x: zx, y: zy, radius: rad, duration: dur });
      }
    };

    const blocked = isBlockedAt(tx, ty);
    if (blocked && (pr.bouncesLeft || 0) > 0 && pr.life > 0) {
      const hitX = isBlockedAt(Math.floor(pr.x), Math.floor(prevY));
      const hitY = isBlockedAt(Math.floor(prevX), Math.floor(pr.y));
      if (hitX) pr.vx = -pr.vx;
      if (hitY) pr.vy = -pr.vy;
      if (!hitX && !hitY) {
        pr.vx = -pr.vx;
        pr.vy = -pr.vy;
      }
      pr.x = prevX;
      pr.y = prevY;
      pr.bouncesLeft -= 1;
      pr.lastHitUid = null;
      sfx.arrow();
      spawnBurst(pr.x, pr.y, pr.color || "#4ade80", 6, 0.85);
      continue;
    }

    if (pr.life <= 0 || blocked) {
      if (pr.isFrostLance) {
        const fx = blocked ? pr.x - pr.vx * dt * 0.6 : pr.x;
        const fy = blocked ? pr.y - pr.vy * dt * 0.6 : pr.y;
        spawnFrostZone(fx, fy);
        spawnVfxAnim(fx, fy, "vfx_frost_explosion", 84, 0.42);
      }
      else if (pr.projKind === "fireball") spawnVfxAnim(pr.x, pr.y, "vfx_fireball_impact", 72, 0.36);
      else if (pr.projKind === "arcane_orb" || pr.projKind === "void_orb") spawnVfxAnim(pr.x, pr.y, "vfx_arcane_burst", 68, 0.32);
      else if (pr.projKind === "lightning_bolt") spawnVfxAnim(pr.x, pr.y, "vfx_lightning_impact", 64, 0.34);
      else if (pr.projKind === "holy_lance" || pr.projKind === "sun_orb") spawnVfxAnim(pr.x, pr.y, "vfx_holy_impact", 68, 0.36);
      else if (pr.projKind === "water_bolt") spawnVfxAnim(pr.x, pr.y, "vfx_water_impact", 64, 0.34);
      else if (pr.projKind === "thorn_shot") spawnVfxAnim(pr.x, pr.y, "vfx_thorn_impact", 60, 0.32);
      else spawnBurst(pr.x, pr.y, pr.color, 6, 0.7);
      s.projectiles.splice(i, 1);
      continue;
    }

    if (pr.isEnemy) {
      if (!pr.isPvpVisual && Math.hypot(pr.x - p.x, pr.y - p.y) <= pr.radius + 0.3) {
        hurtPlayer(pr.dmg, pr.sourceName || "Void Orb", pr.vx * 0.4, pr.vy * 0.4);
        s.projectiles.splice(i, 1);
      } else if (pr.isPvpVisual && Math.hypot(pr.x - p.x, pr.y - p.y) <= pr.radius + 0.3) {
        spawnBurst(pr.x, pr.y, pr.color || "#ef4444", 6, 0.8);
        if ((pr.bouncesLeft || 0) > 0) {
          pr.bouncesLeft -= 1;
          pr.vx = -pr.vx;
          pr.vy = -pr.vy;
          pr.x = prevX;
          pr.y = prevY;
        } else {
          s.projectiles.splice(i, 1);
        }
      }
    } else {
      let hit = false;
      for (const e of [...s.level.enemies]) {
        if (pr.pierce && pr.hitIds?.has(e.uid)) continue;
        if ((pr.bouncesLeft || 0) > 0 && pr.lastHitUid === e.uid && pr.rehitCd > 0) continue;
        if (Math.hypot(pr.x - e.x, pr.y - e.y) <= pr.radius + (e.isBoss ? 0.45 : 0.35)) {
          if (pr.chill) e.chilled = typeof pr.chill === "number" ? pr.chill : 3.0;
          if (pr.sunderDur) {
            e.sunderTimer = Math.max(e.sunderTimer || 0, pr.sunderDur);
            addFloat(e.x, e.y - 0.4, "SUNDERED", "#fb923c");
          }
          const kb = pr.kbMult || 0.25;
          damageEnemy(e, pr.dmg, Boolean(pr.isCrit), pr.label || "Spell", pr.vx * kb, pr.vy * kb, {
            isSkill: Boolean(pr.isSkill),
            pierce: Boolean(pr.pierce),
            canInterrupt: Boolean(pr.isSkill),
            sunderDur: pr.sunderDur || 0,
            freezeDur: pr.chill ? (typeof pr.chill === "number" ? pr.chill * 0.5 : 1.2) : 0,
          });
          if (pr.isSlashWave) spawnBurst(e.x, e.y, "#fb923c", 8, 1.0);
          if (pr.projKind === "fireball") {
            spawnVfxAnim(pr.x, pr.y, "vfx_fireball_impact", 72, 0.36);
            const splashDmg = Math.max(1, Math.round(pr.dmg * 0.35));
            for (const other of [...s.level.enemies]) {
              if (other !== e && Math.hypot(other.x - pr.x, other.y - pr.y) <= 1.2) {
                damageEnemy(other, splashDmg, false, "Fireball Blast", 0, 0, { isAoe: true });
              }
            }
          } else if (pr.projKind === "arcane_orb" || pr.projKind === "void_orb") {
            spawnVfxAnim(e.x, e.y, "vfx_arcane_burst", 64, 0.3);
          } else if (pr.projKind === "lightning_bolt") {
            spawnVfxAnim(e.x, e.y, "vfx_lightning_impact", 64, 0.34);
          } else if (pr.projKind === "holy_lance" || pr.projKind === "sun_orb") {
            spawnVfxAnim(e.x, e.y, "vfx_holy_impact", 68, 0.36);
          } else if (pr.projKind === "water_bolt") {
            spawnVfxAnim(e.x, e.y, "vfx_water_impact", 64, 0.34);
          } else if (pr.projKind === "thorn_shot") {
            spawnVfxAnim(pr.x, pr.y, "vfx_thorn_impact", 60, 0.32);
            e.poisonTimer = Math.max(e.poisonTimer || 0, 2.5);
            e.poisonDmg = Math.max(e.poisonDmg || 0, Math.max(2, Math.round(pr.dmg * 0.28)));
            e.poisonTick = e.poisonTick ?? 0.65;
          } else if (pr.projKind === "piercing_shot") {
            spawnVfxAnim(e.x, e.y, "vfx_holy_impact", 62, 0.34);
          } else if (pr.isArrow && pr.isSkill) {
            spawnVfxAnim(e.x, e.y, "vfx_arrow_impact", 44, 0.32, { angle: Math.atan2(pr.vy, pr.vx), anchorX: 0.78, anchorY: 0.53 });
          }
          if (pr.isFrostLance) {
            spawnFrostZone(pr.x, pr.y);
            spawnVfxAnim(pr.x, pr.y, "vfx_frost_explosion", 84, 0.42);
          }
          if ((pr.bouncesLeft || 0) > 0) {
            pr.bouncesLeft -= 1;
            pr.lastHitUid = e.uid;
            pr.rehitCd = 0.14;
            const spd = Math.hypot(pr.vx, pr.vy) || 13.5;
            let nextTarget = null;
            let bestDist = 6.5;
            for (const other of s.level.enemies) {
              if (other.uid === e.uid || other.hp <= 0) continue;
              const d = Math.hypot(other.x - pr.x, other.y - pr.y);
              if (d < bestDist) {
                bestDist = d;
                nextTarget = other;
              }
            }
            if (nextTarget) {
              const ang = Math.atan2(nextTarget.y - pr.y, nextTarget.x - pr.x);
              pr.vx = Math.cos(ang) * spd;
              pr.vy = Math.sin(ang) * spd;
            } else {
              const nx = e.x - prevX;
              const ny = e.y - prevY;
              const nLen = Math.hypot(nx, ny);
              if (nLen > 0.01) {
                const unx = nx / nLen;
                const uny = ny / nLen;
                const dot = pr.vx * unx + pr.vy * uny;
                pr.vx -= 2 * dot * unx;
                pr.vy -= 2 * dot * uny;
              } else {
                pr.vx = -pr.vx;
                pr.vy = -pr.vy;
              }
            }
            sfx.arrow();
            spawnBurst(pr.x, pr.y, pr.color || "#4ade80", 6, 0.85);
            break;
          } else if (pr.pierce) {
            pr.hitIds?.add(e.uid);
          } else {
            hit = true;
            break;
          }
        }
      }
      if (hit) s.projectiles.splice(i, 1);
    }
  }

  // Frost Zones
  if (s.frostZones?.length) {
    for (let i = s.frostZones.length - 1; i >= 0; i--) {
      const z = s.frostZones[i];
      z.timer -= dt;
      z.particleCd -= dt;
      if (z.particleCd <= 0) {
        z.particleCd = 0.08;
        const ang = Math.random() * Math.PI * 2;
        const dist = Math.sqrt(Math.random()) * z.radius * TILE_SIZE;
        s.particles.push({
          x: z.x * TILE_SIZE + Math.cos(ang) * dist, y: z.y * TILE_SIZE + Math.sin(ang) * dist,
          vx: (Math.random() - 0.5) * 14, vy: -14 - Math.random() * 14,
          color: Math.random() < 0.5 ? "#bae6fd" : "#38bdf8", size: 2.8, life: 0.38, maxLife: 0.38,
        });
      }
      if (!z.isVisualOnly) {
        for (const e of [...s.level.enemies]) {
          const inside = Math.hypot(e.x - z.x, e.y - z.y) <= z.radius + (e.isBoss ? 0.35 : 0.25);
          if (inside) {
            e.chilled = Math.max(e.chilled || 0, Math.min(z.chillDur, 1.2));
            const dwell = (z.dwell.get(e.uid) || 0) + dt;
            z.dwell.set(e.uid, dwell);
            if (dwell > 1.0 && !z.frozenIds.has(e.uid)) {
              z.frozenIds.add(e.uid);
              e.frozenTimer = Math.max(e.frozenTimer || 0, z.freezeDur);
              e.chilled = Math.max(e.chilled || 0, z.chillDur);
              e.windupTimer = 0;
              sfx.frost();
              spawnBurst(e.x, e.y, "#e0f2fe", 14, 1.15);
              spawnRing(e.x, e.y, 28, "#7dd3fc", 0.3);
              addFloat(e.x, e.y - 0.5, "FROZEN!", "#bae6fd");
              damageEnemy(e, z.shatterDmg, false, "Frost Lance (Freeze)", 0, 0, { isSkill: true, isAoe: true, freezeDur: z.freezeDur });
            }
          } else {
            z.dwell.delete(e.uid);
          }
        }
      }
      if (z.timer <= 0) s.frostZones.splice(i, 1);
    }
  }

  // Siege Barrage Arrow Storms
  if (p.stormField) {
    const sf = p.stormField;
    sf.timer -= dt;
    sf.tickTimer -= dt;
    if (sf.tickTimer <= 0) {
      sf.tickTimer = sf.tickInterval;
      sfx.zap?.() || sfx.slash();
      spawnVfxAnim(p.x, p.y, "vfx_storm_field", sf.radius * TILE_SIZE * 1.85, 0.62);
      spawnRing(p.x, p.y, sf.radius * TILE_SIZE, "rgba(56, 189, 248, 0.7)", 0.25);
      if (s.isPvp) broadcastPvpAction({ kind: "vfx_anim", x: p.x, y: p.y, sheetKey: "vfx_storm_field", sizePx: sf.radius * TILE_SIZE * 1.85, duration: 0.62 });
      for (const e of [...s.level.enemies]) {
        if (Math.hypot(e.x - p.x, e.y - p.y) <= sf.radius + 0.35) {
          damageEnemy(e, sf.dmg, false, sf.spell.name, 0, 0, { isSkill: true, isAoe: true });
        }
      }
    }
    if (sf.timer <= 0) p.stormField = null;
  }

  if (p.leafTempest) {
    const lt = p.leafTempest;
    lt.timer -= dt;
    lt.tickTimer -= dt;
    if (lt.tickTimer <= 0) {
      lt.tickTimer = lt.tickInterval;
      sfx.slash();
      spawnVfxAnim(p.x, p.y, "vfx_leaf_storm", lt.radius * TILE_SIZE * 1.9, 0.42);
      spawnRing(p.x, p.y, lt.radius * TILE_SIZE, "rgba(52, 211, 153, 0.7)", 0.25);
      if (s.isPvp) broadcastPvpAction({ kind: "vfx_anim", x: p.x, y: p.y, sheetKey: "vfx_leaf_storm", sizePx: lt.radius * TILE_SIZE * 1.9, duration: 0.42 });
      for (const e of [...s.level.enemies]) {
        if (Math.hypot(e.x - p.x, e.y - p.y) <= lt.radius + 0.35) {
          damageEnemy(e, lt.dmg, false, lt.spell.name, 0, 0, { isSkill: true, isAoe: true });
        }
      }
    }
    if (lt.timer <= 0) p.leafTempest = null;
  }

  if (s.gravityWells?.length) {
    for (let i = s.gravityWells.length - 1; i >= 0; i--) {
      const gw = s.gravityWells[i];
      gw.timer -= dt;
      gw.pulseCd = (gw.pulseCd || 0) - dt;
      if (gw.pulseCd <= 0) {
        gw.pulseCd = 0.45;
        sfx.gravityPull();
        spawnRing(gw.x, gw.y, gw.radius * TILE_SIZE * 0.9, "rgba(192, 132, 252, 0.55)", 0.35);
      }
      if (gw.isVisualOnly) {
        const d = Math.hypot(p.x - gw.x, p.y - gw.y);
        if (d > 0.25 && d <= gw.radius + 0.7) {
          const ang = Math.atan2(gw.y - p.y, gw.x - p.x);
          const pull = (gw.pullSpeed || 2.35) * dt;
          moveWithSlide(p, Math.cos(ang) * pull, Math.sin(ang) * pull, 0.28);
        }
      } else {
        for (const e of s.level.enemies) {
          if (e.isPvpPlayer || e.hp <= 0) continue;
          const d = Math.hypot(e.x - gw.x, e.y - gw.y);
          if (d > 0.2 && d <= gw.radius + 0.8) {
            const ang = Math.atan2(gw.y - e.y, gw.x - e.x);
            const pull = (gw.pullSpeed || 2.35) * dt * (e.isBoss ? 0.55 : 1);
            moveWithSlide(e, Math.cos(ang) * pull, Math.sin(ang) * pull, 0.25);
          }
        }
      }
      if (gw.timer <= 0) {
        if (gw.detonate && !gw.isVisualOnly) {
          sfx.ultSlam();
          sfx.nova();
          s.shake = Math.max(s.shake, 10);
          spawnVfxAnim(gw.x, gw.y, "vfx_arcane_burst", gw.radius * TILE_SIZE * 1.85, 0.58);
          spawnRing(gw.x, gw.y, gw.radius * TILE_SIZE, "#a855f7", 0.5);
          spawnBurst(gw.x, gw.y, "#e9d5ff", 28, 1.6);
          if (s.isPvp) {
            broadcastPvpAction({ kind: "vfx_anim", x: gw.x, y: gw.y, sheetKey: "vfx_arcane_burst", sizePx: gw.radius * TILE_SIZE * 1.85, duration: 0.58 });
            broadcastPvpAction({ kind: "ring", x: gw.x, y: gw.y, radPx: gw.radius * TILE_SIZE, color: "#a855f7", dur: 0.5 });
          }
          for (const e of [...s.level.enemies]) {
            const d = Math.hypot(e.x - gw.x, e.y - gw.y);
            if (d <= gw.radius + 0.35) {
              const centerFactor = 1 - Math.min(1, Math.max(0, (d - 0.5) / Math.max(0.5, gw.radius - 0.5))) * 0.5;
              const finalDmg = Math.max(1, Math.round(gw.maxDmg * centerFactor));
              e.stunTimer = Math.max(e.stunTimer || 0, gw.stunDur);
              damageEnemy(e, finalDmg, centerFactor >= 0.9, gw.spell.name, 0, 0, { isSkill: true, isAoe: true, stunDur: gw.stunDur });
            }
          }
          addFloat(gw.x, gw.y - 0.5, "SINGULARITY!", "#e9d5ff");
        }
        s.gravityWells.splice(i, 1);
      }
    }
  }

  if (s.arrowStorms?.length) {
    for (let i = s.arrowStorms.length - 1; i >= 0; i--) {
      const st = s.arrowStorms[i];
      st.timer -= dt;
      st.tickTimer -= dt;
      st.spawnTimer -= dt;
      if (st.spawnTimer <= 0) {
        st.spawnTimer = 0.055;
        if (s.fallingArrows.length < 16) {
          const r = Math.sqrt(Math.random()) * st.radius * TILE_SIZE * 0.85;
          const theta = Math.random() * Math.PI * 2;
          const landX = st.x * TILE_SIZE + Math.cos(theta) * r;
          const landY = st.y * TILE_SIZE + Math.sin(theta) * r;
          s.fallingArrows.push({
            x: landX - 34,
            y: landY - 135,
            targetX: landX,
            targetY: landY,
            sizePx: 24,
            life: 0.22,
            maxLife: 0.22,
          });
        }
      }
      if (st.tickTimer <= 0) {
        st.tickTimer = st.tickInterval;
        sfx.slash();
        s.shake = Math.max(s.shake, 2.5);
        spawnRing(st.x, st.y, st.radius * TILE_SIZE, "rgba(250, 204, 21, 0.28)", 0.28, { lineWidth: 1.5 });
        if (!st.isVisualOnly) {
          for (const e of [...s.level.enemies]) {
            if (Math.hypot(e.x - st.x, e.y - st.y) <= st.radius + 0.35) {
              e.chilled = Math.max(e.chilled || 0, st.chillDur);
              damageEnemy(e, st.dmg, false, st.spell.name, 0, 0, { isSkill: true, isAoe: true });
            }
          }
        }
      }
      if (st.timer <= 0) s.arrowStorms.splice(i, 1);
    }
  }
  if (s.fallingArrows?.length) {
    for (let i = s.fallingArrows.length - 1; i >= 0; i--) {
      const fa = s.fallingArrows[i];
      fa.life -= dt;
      if (fa.life <= 0) {
        const ang = Math.atan2(fa.targetY - fa.y, fa.targetX - fa.x);
        spawnVfxAnim(fa.targetX / TILE_SIZE, fa.targetY / TILE_SIZE, "vfx_arrow_impact", 40, 0.34, {
          angle: ang,
          anchorX: 0.78,
          anchorY: 0.53,
        });
        s.particles.push({ x: fa.targetX, y: fa.targetY, vx: (Math.random() - 0.5) * 28, vy: (Math.random() - 0.5) * 28, color: "#fde047", size: 2.5, life: 0.18, maxLife: 0.18 });
        s.fallingArrows.splice(i, 1);
      }
    }
  }

  for (let i = s.slashes.length - 1; i >= 0; i--) {
    s.slashes[i].life -= dt;
    if (s.slashes[i].life <= 0) s.slashes.splice(i, 1);
  }
  for (let i = s.rings.length - 1; i >= 0; i--) {
    const rg = s.rings[i];
    if ((rg.delay || 0) > 0) { rg.delay -= dt; continue; }
    rg.life -= dt;
    const t = 1 - Math.max(0, rg.life / rg.maxLife);
    rg.radius = 4 + (rg.maxRadius - 4) * t;
    if (rg.life <= 0) s.rings.splice(i, 1);
  }
  if (Array.isArray(s.groundDecals)) {
    for (let i = s.groundDecals.length - 1; i >= 0; i--) {
      const dc = s.groundDecals[i];
      dc.life -= dt;
      dc.angle += (dc.spin || 0) * dt;
      if (dc.life <= 0) s.groundDecals.splice(i, 1);
    }
  }
    if (Array.isArray(s.vfxAnims)) {
    for (let i = s.vfxAnims.length - 1; i >= 0; i--) {
      s.vfxAnims[i].life -= dt;
      if (s.vfxAnims[i].life <= 0) s.vfxAnims.splice(i, 1);
    }
  }
  if (Array.isArray(s.pendingMeteors)) {
    for (let i = s.pendingMeteors.length - 1; i >= 0; i--) {
      const pm = s.pendingMeteors[i];
      pm.timer -= dt;
      if (pm.timer <= 0) {
        s.pendingMeteors.splice(i, 1);
        sfx.ultSlam();
        const expSize = pm.rad * TILE_SIZE * 1.85;
        spawnVfxAnim(pm.x, pm.y, "vfx_fire_explosion", expSize, 0.56);
        spawnGroundDecal(pm.x, pm.y, "vfx_ground_slam_shockwave", pm.rad * TILE_SIZE * 1.5, 0.28, { scaleStart: 0.2, scaleEnd: 1.7 });
        spawnRing(pm.x, pm.y, pm.rad * TILE_SIZE, "#f97316", 0.42);
        spawnBurst(pm.x, pm.y, "#facc15", 26, 1.5);
        s.shake = Math.max(s.shake, 11);
        s.hitstop = Math.max(s.hitstop, 0.04);
        if (s.isPvp) {
          broadcastPvpAction({ kind: "vfx", x: pm.x, y: pm.y, sheetKey: "vfx_fire_explosion", sizePx: expSize, duration: 0.56 });
          broadcastPvpAction({ kind: "ring", x: pm.x, y: pm.y, radPx: pm.rad * TILE_SIZE, color: "#f97316", dur: 0.42 });
        }
        for (const e of [...s.level.enemies]) {
          const dx = e.x - pm.x;
          const dy = e.y - pm.y;
          const dist = Math.hypot(dx, dy);
          if (dist <= pm.rad + 0.45) {
            const nx = dist > 0.01 ? dx / dist : 0;
            const ny = dist > 0.01 ? dy / dist : 0;
            damageEnemy(e, pm.dmg, true, pm.name, nx * 5.4, ny * 5.4, { isSkill: true, isAoe: true, canInterrupt: true, stunDur: pm.stun });
          }
        }
        for (const pr of s.level.props) {
          if (pr.solid && ["crate", "barrel", "urn"].includes(pr.kind) && Math.hypot(pr.x + 0.5 - pm.x, pr.y + 0.5 - pm.y) <= pm.rad) {
            interactProp(pr);
          }
        }
      }
    }
  }
  for (let i = s.beams.length - 1; i >= 0; i--) {
    s.beams[i].life -= dt;
    if (s.beams[i].life <= 0) s.beams.splice(i, 1);
  }
  for (let i = s.afterimages.length - 1; i >= 0; i--) {
    s.afterimages[i].life -= dt;
    if (s.afterimages[i].life <= 0) s.afterimages.splice(i, 1);
  }
  for (let i = s.particles.length - 1; i >= 0; i--) {
    const pt = s.particles[i];
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.life -= dt;
    if (pt.life <= 0) s.particles.splice(i, 1);
  }
  for (let i = s.floatingTexts.length - 1; i >= 0; i--) {
    const ft = s.floatingTexts[i];
    ft.y += ft.vy * dt;
    ft.life -= dt;
    if (ft.life <= 0) s.floatingTexts.splice(i, 1);
  }
}
