import { loadAllAssets, drawSheetFrame } from "./assets.js";
import { bgm, sfx } from "./audio.js";
import { ACTS, DEFAULT_LOADOUT, DIFFICULTIES, EQUIPMENT_SETS, ITEMS, LORE_CODEX, META_UPGRADES, NPC_ENCOUNTERS, RARITIES, SPELLS, getItemPrice } from "./data.js";
import { MAP_H, MAP_W, TILE, computeFOV, generateFloor } from "./dungeon.js";

const TILE_SIZE = 32;
const DEFAULT_MAX_INVENTORY = 15;
const SAVE_KEY = "shattered_crown_meta_v1";
const RUN_SAVE_KEY = "shattered_crown_run_v1";

const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");
canvas.width = MAP_W * TILE_SIZE;
canvas.height = MAP_H * TILE_SIZE;

const portraitCanvas = document.getElementById("hero-portrait");
const portraitCtx = portraitCanvas.getContext("2d");
const mobilePortraitCanvas = document.getElementById("mobile-portrait");
const mobilePortraitCtx = mobilePortraitCanvas ? mobilePortraitCanvas.getContext("2d") : null;
const storyPortraitCanvas = document.getElementById("story-portrait");
const storyPortraitCtx = storyPortraitCanvas.getContext("2d");

let assets = {};
let animFrame = 0;
let animTimer = 0;
let lastFrameTime = 0;
let isCanvasVisible = true;

const keys = new Set();
const mouse = { x: null, y: null, inside: false };
const touchMove = { x: 0, y: 0, active: false };
const camera = { x: 0, y: 0 };

function isMobileLayout() {
  return window.innerWidth <= 960 || window.matchMedia("(pointer: coarse)").matches;
}

function clientToTile(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const px = ((clientX - rect.left) / rect.width) * canvas.width + camera.x;
  const py = ((clientY - rect.top) / rect.height) * canvas.height + camera.y;
  return { x: px / TILE_SIZE, y: py / TILE_SIZE };
}

function loadMeta() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    heroName: "Sir Aldric",
    difficulty: "normal",
    soulShards: 0,
    upgrades: { vitality: 0, might: 0, arcane: 0, provisions: 0 },
    unlockedCodex: ["crown"],
    bestFloor: 1,
    victories: 0,
    settings: { sfxLevel: "high", musicLevel: "low", screenShake: true },
  };
}

function saveMeta(nextMeta) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(nextMeta));
  } catch {}
}

function saveRun() {
  if (!state || state.runEnded || state.dyingTimer > 0 || !state.startedByUser) return;
  try {
    const snapshot = {
      floor: state.floor,
      difficulty: state.difficulty,
      bossFightStarted: state.bossFightStarted,
      hasBossKey: state.hasBossKey,
      bossKeyDrop: state.bossKeyDrop,
      level: state.level,
      elapsed: state.elapsed,
      kills: state.kills,
      seenBosses: Array.from(state.seenBosses),
      shardsCollected: state.shardsCollected,
      spellCooldowns: state.spellCooldowns,
      player: state.player,
    };
    localStorage.setItem(RUN_SAVE_KEY, JSON.stringify(snapshot));
  } catch {}
}

function loadSavedRun() {
  try {
    const raw = localStorage.getItem(RUN_SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !data.level || !data.player) return null;
    return data;
  } catch {
    return null;
  }
}

function clearSavedRun() {
  try {
    localStorage.removeItem(RUN_SAVE_KEY);
  } catch {}
}

let meta = loadMeta();
let state = null;
let uiDirty = true;

function getEnteredHeroName() {
  const input = document.getElementById("hero-name-input");
  const raw = input ? input.value.trim() : "";
  const name = raw || meta.heroName || "Sir Aldric";
  meta.heroName = name;
  saveMeta(meta);
  return name;
}

function getSelectedDifficulty() {
  const sel = document.getElementById("difficulty-select");
  const id = sel ? sel.value : meta.difficulty || "normal";
  meta.difficulty = DIFFICULTIES[id] ? id : "normal";
  saveMeta(meta);
  return meta.difficulty;
}

function repairSavedFloorIfDisconnected(lvl, player) {
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
  if (bossDoor) {
    targets.push({ x: bossDoor.x, y: bossDoor.y, isDoor: true });
  } else if (lvl.stairsPos) {
    targets.push({ x: lvl.stairsPos.x, y: lvl.stairsPos.y });
  }

  for (const t of targets) {
    const vis = getReachable();
    if (vis[t.y]?.[t.x]) continue;

    const q = [[startX, startY]];
    const parent = new Map([[`${startX},${startY}`, null]]);
    let found = false;
    while (q.length > 0) {
      const [x, y] = q.shift();
      if (x === t.x && y === t.y) {
        found = true;
        break;
      }
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

function restoreRun(saved) {
  // Ensure torches in previously saved runs are non-solid
  if (saved.level?.props) {
    for (const pr of saved.level.props) {
      if (pr.kind === "torch") pr.solid = false;
    }
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
    saved.player.maxInventory = DEFAULT_MAX_INVENTORY;
  }
  if (!Array.isArray(saved.level.groundItems)) {
    saved.level.groundItems = [];
  }
  if (!Array.isArray(saved.level.shops)) {
    saved.level.shops = [];
  }
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
    if (saved.player.equipment.subweapon === undefined) {
      saved.player.equipment.subweapon = null;
    }
    for (const k of Object.keys(saved.player.equipment)) {
      saved.player.equipment[k] = migrateEquipItem(saved.player.equipment[k]);
    }
  }
  if (Array.isArray(saved.player.inventory)) {
    saved.player.inventory.forEach(migrateEquipItem);
  }
  if (Array.isArray(saved.level.groundItems)) {
    saved.level.groundItems.forEach((g) => migrateEquipItem(g.item));
  }
  const repairedCorridor = repairSavedFloorIfDisconnected(saved.level, saved.player);
  saved.player.z = 0;
  saved.player.leap = null;
  saved.player.ultCharge = null;
  saved.player.rapidSlash = null;
  saved.player.stunTimer = 0;
  saved.player.tempDef = 0;
  saved.player.tempDefTimer = 0;
  state = {
    floor: saved.floor,
    difficulty: saved.difficulty || "normal",
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
    stairsCooldown: 0,
    invFullMsgCd: 0,
    lastFovTile: { x: -1, y: -1 },
    seenBosses: new Set(saved.seenBosses || []),
    shardsCollected: saved.shardsCollected || [false, false, false],
    spellCooldowns: saved.spellCooldowns || Object.fromEntries(SPELLS.map((s) => [s.id, 0])),
    player: saved.player,
    projectiles: [],
    slashes: [],
    rings: [],
    beams: [],
    arrowStorms: [],
    frostZones: [],
    fallingArrows: [],
    afterimages: [],
    floatingTexts: [],
    particles: [],
  };

  updateFOVIfNeeded(true);
  clearLog();
  addLog(`Welcome back, ${state.player.name || "Sir Aldric"}! Resumed Floor ${state.floor}.`, "story");
  if (repairedCorridor) {
    addLog("A sealed passage on this floor has been reopened!", "story");
    saveRun();
  }
  showFloorBanner(`Resumed Floor ${state.floor} — ${state.level.act.name}`);
  buildSpellButtons();
  updateUI();
}

function getActiveSpells(player = state?.player) {
  const ids = Array.isArray(player?.loadout) && player.loadout.length === 4 ? player.loadout : DEFAULT_LOADOUT;
  return ids
    .map((id, idx) => {
      const sp = SPELLS.find((s) => s.id === id);
      return sp ? { ...sp, hotkey: String(idx + 1) } : null;
    })
    .filter(Boolean);
}

function createNewRun(heroName = getEnteredHeroName(), difficultyId = getSelectedDifficulty(), loadout = DEFAULT_LOADOUT, heroClass = "paladin", skipSave = false) {
  clearSavedRun();
  const vit = meta.upgrades.vitality || 0;
  const might = meta.upgrades.might || 0;
  const arc = meta.upgrades.arcane || 0;
  const prov = meta.upgrades.provisions || 0;

  const isGilded = heroClass === "gilded";
  const isSoldier = heroClass === "soldier";
  const level = generateFloor(1, difficultyId);
  const maxHp = 42 + vit * 8 + (heroClass === "paladin" ? 4 : 0);
  const maxMp = 20 + arc * 6 + (heroClass === "paladin" ? 2 : 0);

  const inventory = [
    { ...ITEMS.health_potion, qty: 1 + prov },
    { ...ITEMS.mana_potion, qty: 1 },
  ];
  if (isSoldier) {
    inventory.push({ ...ITEMS.iron_sword, qty: 1 });
  }

  state = {
    floor: 1,
    difficulty: difficultyId,
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
    stairsCooldown: 0,
    invFullMsgCd: 0,
    lastFovTile: { x: -1, y: -1 },
    seenBosses: new Set(),
    shardsCollected: [false, false, false],
    spellCooldowns: Object.fromEntries(SPELLS.map((s) => [s.id, 0])),
    player: {
      name: heroName,
      heroClass: isGilded ? "gilded" : isSoldier ? "soldier" : "paladin",
      x: level.playerStart.x + 0.5,
      y: level.playerStart.y + 0.5,
      z: 0,
      leap: null,
      ultCharge: null,
      rapidSlash: null,
      stunTimer: 0,
      tempDef: 0,
      tempDefTimer: 0,
      loadout: Array.isArray(loadout) && loadout.length === 4 ? [...loadout] : [...DEFAULT_LOADOUT],
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
      skillPoints: 1,
      skillRanks: Object.fromEntries(SPELLS.map((s) => [s.id, 0])),
      shortcuts: ["health_potion", "mana_potion", null, null],
      hp: maxHp,
      maxHp,
      mp: maxMp,
      maxMp,
      baseAtk: 7 + might + (isGilded ? 2 : isSoldier ? 1 : 0),
      baseDef: 2 + (isSoldier ? 1 : 0),
      baseCrit: 10 + (isGilded ? 5 : 0),
      gold: 15,
      equipment: {
        weapon: isSoldier ? { ...ITEMS.oak_shortbow } : { ...ITEMS.iron_sword },
        subweapon: null,
        armor: null,
        helmet: null,
        boots: null,
        ring: null,
      },
      maxInventory: DEFAULT_MAX_INVENTORY,
      inventory,
    },
    projectiles: [],
    slashes: [],
    rings: [],
    beams: [],
    arrowStorms: [],
    frostZones: [],
    fallingArrows: [],
    afterimages: [],
    floatingTexts: [],
    particles: [],
  };

  updateFOVIfNeeded(true);
  clearLog();
  addLog(`${heroName} descends into the Goblin Catacombs. Level up to unlock your skills!`, "story");
  showFloorBanner(`Floor 1 — ${state.level.act.name}`);
  buildSpellButtons();
  updateUI();
  if (!skipSave) saveRun();
}

function getActiveSetBonuses(p = state?.player) {
  const counts = {};
  if (p?.equipment) {
    for (const item of Object.values(p.equipment)) {
      if (item?.setId) counts[item.setId] = (counts[item.setId] || 0) + 1;
    }
  }
  const totals = { atk: 0, def: 0, crit: 0, maxHp: 0, maxMp: 0, speed: 0 };
  const activeLabels = [];
  for (const [setId, count] of Object.entries(counts)) {
    const def = EQUIPMENT_SETS[setId];
    if (!def) continue;
    let best = null;
    for (const b of def.bonuses) {
      if (count >= b.count) best = b;
    }
    if (best) {
      totals.atk += best.atk || 0;
      totals.def += best.def || 0;
      totals.crit += best.crit || 0;
      totals.maxHp += best.maxHp || 0;
      totals.maxMp += best.maxMp || 0;
      totals.speed += best.speed || 0;
      activeLabels.push({ name: def.name, color: def.color, count, label: best.label });
    }
  }
  return { counts, totals, activeLabels };
}

function getPlayerStats(p = state.player) {
  let atk = p.baseAtk + (p.tempAtk || 0);
  let def = p.baseDef + (p.tempDef || 0);
  let crit = p.baseCrit;
  let bonusHp = 0;
  let bonusMp = 0;
  let speedBonus = p.heroClass === "soldier" ? 0.35 : 0;

  for (const item of Object.values(p.equipment)) {
    if (!item) continue;
    atk += item.atk || 0;
    def += item.def || 0;
    crit += item.crit || 0;
    bonusHp += item.maxHp || 0;
    bonusMp += item.maxMp || 0;
    if (item.slot === "boots") speedBonus += 0.55;
  }

  const sets = getActiveSetBonuses(p);
  atk += sets.totals.atk;
  def += sets.totals.def;
  crit += sets.totals.crit;
  bonusHp += sets.totals.maxHp;
  bonusMp += sets.totals.maxMp;
  speedBonus += sets.totals.speed;

  return {
    atk,
    def,
    crit: Math.min(75, crit),
    maxHp: p.maxHp + bonusHp,
    maxMp: p.maxMp + bonusMp,
    moveSpeed: 4.5 + speedBonus + (p.hasteTimer > 0 ? 0.7 : 0),
  };
}

function addLog(text, kind = "info") {
  const logEl = document.getElementById("combat-log");
  const div = document.createElement("div");
  div.className = `log-entry ${kind}`;
  div.textContent = text;
  logEl.prepend(div);
  while (logEl.children.length > 60) logEl.removeChild(logEl.lastChild);
}

function clearLog() {
  document.getElementById("combat-log").innerHTML = "";
}

function showFloorBanner(text) {
  const banner = document.getElementById("floor-banner");
  banner.textContent = text;
  banner.classList.add("visible");
  clearTimeout(showFloorBanner._t);
  showFloorBanner._t = setTimeout(() => banner.classList.remove("visible"), 2600);
}

function addFloat(tx, ty, text, color = "#fff") {
  if (!state) return;
  if (state.floatingTexts.length >= 18) state.floatingTexts.shift();
  state.floatingTexts.push({
    x: tx * TILE_SIZE,
    y: ty * TILE_SIZE - 10,
    vy: -28,
    text,
    color,
    life: 0.78,
    maxLife: 0.78,
  });
}

function spawnBurst(tx, ty, color, count = 10, speedScale = 1) {
  if (!state) return;
  const cx = tx * TILE_SIZE;
  const cy = ty * TILE_SIZE;
  const maxParticles = 80;
  if (state.particles.length >= maxParticles) {
    state.particles.splice(0, state.particles.length - maxParticles + Math.min(count, 16));
  }
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = (28 + Math.random() * 72) * speedScale;
    const life = 0.32 + Math.random() * 0.28;
    state.particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      color,
      size: 2 + Math.random() * 3,
      life,
      maxLife: life,
    });
  }
}

function spawnRing(tx, ty, maxRadiusPx, color, duration = 0.35, { delay = 0, lineWidth = 2.5 } = {}) {
  if (!state) return;
  if (state.rings.length >= 30) state.rings.shift();
  state.rings.push({
    x: tx * TILE_SIZE,
    y: ty * TILE_SIZE,
    radius: 4,
    maxRadius: maxRadiusPx,
    color,
    life: duration,
    maxLife: duration,
    delay,
    lineWidth,
  });
}

function getWeaponCategory(weapon) {
  if (!weapon) return null;
  if (weapon.weaponType === "bow") return "bow";
  if (weapon.weaponType === "wand" || weapon.weaponType === "staff") return "wand";
  return "melee";
}

function getSubWeaponCategory(sub) {
  if (!sub) return null;
  if (sub.subType === "arrows") return "bow";
  if (sub.subType === "book") return "wand";
  return "melee";
}

function isWeaponSubPairValid(weapon, sub) {
  if (!weapon || !sub) return true;
  return getWeaponCategory(weapon) === getSubWeaponCategory(sub);
}

function getRarityInfo(item) {
  const key =
    item?.rarity ||
    (item?.tier === 3 ? "legendary" : item?.tier === 2 ? "unique" : item?.setId ? "rare" : "common");
  return RARITIES[key] || RARITIES.common;
}

function getMaxInventory(p = state?.player) {
  return p?.maxInventory || DEFAULT_MAX_INVENTORY;
}

function addItemToInventory(itemTpl, qty = itemTpl?.qty || 1, { silentFull = false } = {}) {
  const inv = state.player.inventory;
  const maxInv = getMaxInventory();
  if (itemTpl.type === "consumable") {
    const existing = inv.find((i) => i.id === itemTpl.id);
    if (existing) {
      existing.qty += qty;
      uiDirty = true;
      return true;
    }
  }
  if (inv.length >= maxInv) {
    if (!silentFull) {
      addLog("Inventory is full!", "info");
    }
    return false;
  }
  inv.push({ ...itemTpl, qty });
  uiDirty = true;
  return true;
}

function spawnGroundItem(itemTpl, x, y, options = {}) {
  if (!state?.level) return null;
  if (!Array.isArray(state.level.groundItems)) state.level.groundItems = [];
  const { requireLeave = false, fullMsgCd = 0, qty = itemTpl?.qty || 1 } = options;

  let spawnX = x;
  let spawnY = y;
  const existing = state.level.groundItems;
  if (existing.some((g) => Math.hypot(g.x - spawnX, g.y - spawnY) < 0.28)) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const ang = (attempt / 8) * Math.PI * 2;
      const nx = x + Math.cos(ang) * 0.34;
      const ny = y + Math.sin(ang) * 0.34;
      if (canOccupy(nx, ny, 0.16) && !existing.some((g) => Math.hypot(g.x - nx, g.y - ny) < 0.25)) {
        spawnX = nx;
        spawnY = ny;
        break;
      }
    }
  }

  const entry = {
    uid: `gi_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    item: { ...itemTpl, qty },
    x: spawnX,
    y: spawnY,
    requireLeave: Boolean(requireLeave),
    fullMsgCd,
    bobPhase: Math.random() * Math.PI * 2,
  };
  state.level.groundItems.push(entry);
  return entry;
}

function giveOrDropItem(itemTpl, x, y, options = {}) {
  const qty = options.qty || itemTpl?.qty || 1;
  if (addItemToInventory(itemTpl, qty, { silentFull: true })) {
    return true;
  }
  spawnGroundItem(itemTpl, x, y, {
    requireLeave: Boolean(options.requireLeave),
    fullMsgCd: 1.8,
    qty,
  });
  return false;
}

function dropInventoryItem(index, amount = 1) {
  if (!state || state.runEnded || state.dyingTimer > 0) return;
  const p = state.player;
  const inv = p.inventory;
  const item = inv[index];
  if (!item) return;

  const currentQty = item.qty || 1;
  const dropQty = Math.min(Math.max(1, amount), currentQty);
  const dropped = { ...item, qty: dropQty };

  if (currentQty > dropQty) {
    item.qty = currentQty - dropQty;
  } else {
    inv.splice(index, 1);
  }

  spawnGroundItem(dropped, p.x, p.y, { requireLeave: true, qty: dropQty });
  sfx.step();
  const label = dropQty > 1 ? `${dropped.name} (x${dropQty})` : dropped.name;
  addFloat(p.x, p.y - 0.3, `Dropped ${label}`, "#cbd5e1");
  addLog(`Dropped ${label} on the ground.`, "info");
  uiDirty = true;
  saveRun();
}

function unlockCodex(id) {
  if (!meta.unlockedCodex.includes(id)) {
    meta.unlockedCodex.push(id);
    saveMeta(meta);
    const entry = LORE_CODEX.find((c) => c.id === id);
    if (entry) addLog(`Lore Unlocked: ${entry.title}`, "story");
  }
}

function grantXP(amount) {
  const p = state.player;
  p.xp += amount;
  let leveledUp = false;
  while (p.xp >= p.xpNext) {
    p.xp -= p.xpNext;
    p.level += 1;
    p.skillPoints = (p.skillPoints || 0) + 1;
    p.xpNext = 20 + (p.level - 1) * 10;
    p.maxHp += 8;
    p.maxMp += 4;
    p.baseAtk += 2;
    p.baseDef += 1;
    const stats = getPlayerStats();
    p.hp = stats.maxHp;
    p.mp = stats.maxMp;
    leveledUp = true;
    sfx.levelUp();
    addFloat(p.x, p.y, "LEVEL UP! +1 SKILL PT", "#facc15");
    spawnBurst(p.x, p.y, "#facc15", 20, 1.3);
    spawnRing(p.x, p.y, 48, "#facc15", 0.45);
    addLog(`Level ${p.level} reached! +1 Skill Point, +8 HP, +4 MP, +2 ATK, +1 DEF.`, "loot");
  }
  uiDirty = true;
  saveRun();
}

function upgradeSkillById(spellId) {
  if (!state || state.runEnded) return false;
  const p = state.player;
  const sp = SPELLS.find((s) => s.id === spellId);
  if (!sp) return false;
  const rank = p.skillRanks[sp.id] || 0;
  if (rank >= sp.maxRank || (p.skillPoints || 0) <= 0) return false;
  const reqHeroLv = sp.reqLevels ? sp.reqLevels[rank] : 1;
  if (p.level < reqHeroLv) return false;

  p.skillPoints -= 1;
  p.skillRanks[sp.id] = rank + 1;
  sfx.levelUp();
  addFloat(p.x, p.y - 0.5, `${sp.name} Lv ${rank + 1}!`, "#facc15");
  spawnBurst(p.x, p.y, sp.color, 16, 1.2);
  spawnRing(p.x, p.y, 40, "#facc15", 0.35);
  addLog(`${rank === 0 ? "Unlocked" : "Upgraded"} ${sp.name} (Rank ${rank + 1}/${sp.maxRank})!`, "story");

  for (const selector of [`.touch-skill-btn[data-spell-id="${sp.id}"]`, `.spell-btn[data-spell-id="${sp.id}"]`]) {
    const el = document.querySelector(selector);
    if (el) {
      el.classList.remove("skill-upgraded");
      void el.offsetWidth;
      el.classList.add("skill-upgraded");
      setTimeout(() => el.classList.remove("skill-upgraded"), 450);
    }
  }

  uiDirty = true;
  saveRun();
  return true;
}

function openSkillDialog() {
  if (!state || state.runEnded) return;
  const p = state.player;
  const dlg = document.getElementById("skill-dialog");
  document.getElementById("modal-skill-points").textContent = p.skillPoints || 0;

  const list = document.getElementById("skill-upgrade-list");
  list.innerHTML = "";

  for (const sp of getActiveSpells(p)) {
    const rank = p.skillRanks[sp.id] || 0;
    const maxed = rank >= sp.maxRank;
    const reqHeroLv = !maxed && sp.reqLevels ? sp.reqLevels[rank] : null;
    const levelTooLow = reqHeroLv !== null && p.level < reqHeroLv;

    const card = document.createElement("div");
    card.className = `skill-upgrade-card ${sp.isUltimate ? "ult" : ""}`;
    card.innerHTML = `
      <div class="skill-upgrade-head">
        <img src="${sp.icon}" alt="" />
        <div>
          <strong>[${sp.hotkey}] ${sp.name} ${sp.isUltimate ? "(ULT)" : ""}</strong>
          <div style="font-size:0.75rem;color:var(--accent)">Rank ${rank} / ${sp.maxRank}</div>
        </div>
      </div>
      <p class="skill-upgrade-desc">${sp.desc}</p>
    `;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = rank === 0 ? "btn btn-primary" : "btn btn-secondary";
    if (maxed) {
      btn.textContent = "Max Level";
    } else if (levelTooLow) {
      btn.textContent = `Requires Hero Lv ${reqHeroLv}`;
    } else {
      btn.textContent = rank === 0 ? "Unlock (1 Pt)" : `Upgrade to Lv ${rank + 1} (1 Pt)`;
    }
    btn.disabled = maxed || levelTooLow || (p.skillPoints || 0) <= 0;
    btn.addEventListener("click", () => {
      if (!upgradeSkillById(sp.id)) return;
      if ((p.skillPoints || 0) <= 0) {
        dlg.close("upgraded");
      } else {
        openSkillDialog();
      }
    });
    card.appendChild(btn);
    list.appendChild(card);
  }

  if (!dlg.open) dlg.showModal();
}

function damageEnemy(enemy, rawDmg, isCrit = false, sourceLabel = "strike", knockX = 0, knockY = 0, options = {}) {
  if ((enemy.evadeTimer || 0) > 0 && !options.ignoreDodge) {
    addFloat(enemy.x, enemy.y - 0.45, "DODGED!", "#38bdf8");
    spawnBurst(enemy.x, enemy.y, "#38bdf8", 8, 0.9);
    addLog(`${enemy.name} dodged your ${sourceLabel}!`, "info");
    return;
  }
  const baseDef = (enemy.def || 0) + (enemy.bonusDef || 0);
  const sunderPenalty = (enemy.sunderTimer || 0) > 0 ? Math.max(3, Math.floor(baseDef * 0.35)) : 0;
  const effectiveDef = Math.max(0, baseDef - sunderPenalty);
  const flatBlock = Math.floor(effectiveDef * 0.28);
  const pctMult = 100 / (100 + effectiveDef * 1.8);
  const dmg = Math.max(1, Math.round(Math.max(1, rawDmg - flatBlock) * pctMult));
  enemy.hp -= dmg;
  enemy.hurtTimer = 0.16;
  enemy.kbX += knockX;
  enemy.kbY += knockY;
  state.shake = Math.max(state.shake, isCrit ? 5 : 2.5);
  if (isCrit) state.hitstop = Math.max(state.hitstop, 0.03);

  addFloat(enemy.x, enemy.y, `${dmg}${isCrit ? "!" : ""}`, isCrit ? "#fde047" : "#f87171");
  spawnBurst(enemy.x, enemy.y, isCrit ? "#fde047" : "#ef4444", isCrit ? 12 : 8);
  addLog(`Your ${sourceLabel} hits ${enemy.name} for ${dmg} damage${isCrit ? " (CRIT!)" : ""}.`, "combat");

  if (!options.isReflect && !enemy.isClone && (enemy.reflectTimer || 0) > 0 && enemy.hp > 0) {
    const reflectDmg = Math.max(1, Math.round(dmg * (enemy.reflectPct || 0.35)));
    const p = state.player;
    const dx = p.x - enemy.x;
    const dy = p.y - enemy.y;
    const dist = Math.max(0.01, Math.hypot(dx, dy));
    spawnBurst(enemy.x, enemy.y, "#fde047", 6, 0.8);
    hurtPlayer(reflectDmg, `${enemy.name}'s Golden Reflect`, (dx / dist) * 2.0, (dy / dist) * 2.0, { isReflect: true });
  }

  if (enemy.hp <= 0) {
    sfx.loot();
    if (!enemy.isClone) {
      state.kills += 1;
      state.player.gold += enemy.gold || 0;
    }
    state.hitstop = Math.max(state.hitstop, 0.035);
    spawnBurst(enemy.x, enemy.y, enemy.isBoss ? "#facc15" : enemy.isClone ? "#c084fc" : "#fb7185", enemy.isBoss ? 28 : 14, 1.25);
    if (enemy.isClone) {
      addLog(`Shattered ${enemy.name}!`, "combat");
    } else {
      addLog(`${enemy.name} defeated! (+${enemy.xp} XP, +${enemy.gold} Gold)`, "loot");
      grantXP(enemy.xp);
    }

    if (enemy.isBoss) {
      handleBossDefeated(enemy);
    } else if (!enemy.isClone && Math.random() < 0.28) {
      const drop = Math.random() < 0.6 ? ITEMS.health_potion : ITEMS.bread;
      spawnGroundItem(drop, enemy.x, enemy.y);
      addFloat(enemy.x, enemy.y - 0.35, `Dropped ${drop.name}`, "#fde047");
      addLog(`${enemy.name} dropped ${drop.name} on the ground.`, "loot");
    }
    state.level.enemies = state.level.enemies.filter((e) => e.uid !== enemy.uid);
    if (!enemy.isBoss && !enemy.isClone && !state.level.isBossFloor && state.floor < 12) {
      const left = state.level.enemies.filter((e) => !e.isBoss && !e.isClone).length;
      if (left === 0 && state.level.stairsPos) {
        const { x, y } = state.level.stairsPos;
        state.level.grid[y][x] = TILE.STAIRS;
        state.level.explored[y][x] = true;
        spawnBurst(x + 0.5, y + 0.5, "#94a3b8", 18, 1.2);
        spawnRing(x + 0.5, y + 0.5, 42, "#cbd5e1", 0.45);
        showFloorBanner("All Enemies Defeated — Stairs Unlocked!");
        addLog("All enemies defeated! The stone stairs to the next floor have appeared.", "story");
      }
    }
    if (!enemy.isBoss && !enemy.isClone && state.level.isBossFloor) {
      const nonBossLeft = state.level.enemies.filter((e) => !e.isBoss && !e.isClone).length;
      if (nonBossLeft === 0 && !state.hasBossKey && !state.bossKeyDrop) {
        state.bossKeyDrop = { x: enemy.x, y: enemy.y };
        addFloat(enemy.x, enemy.y - 0.4, "BOSS KEY DROPPED!", "#facc15");
        spawnBurst(enemy.x, enemy.y, "#facc15", 20, 1.3);
        addLog("The last guardian dropped the Boss Key! Look to the Boss Chamber.", "story");

        const rooms = state.level.rooms || [];
        const bossRoom = rooms[rooms.length - 1];
        if (bossRoom) {
          for (let y = Math.max(0, bossRoom.y - 1); y <= Math.min(MAP_H - 1, bossRoom.y + bossRoom.h); y++) {
            for (let x = Math.max(0, bossRoom.x - 1); x <= Math.min(MAP_W - 1, bossRoom.x + bossRoom.w); x++) {
              state.level.explored[y][x] = true;
            }
          }
          state.camReveal = {
            targetX: bossRoom.cx + 0.5,
            targetY: bossRoom.cy + 0.5,
            timer: 2.3,
            duration: 2.3,
          };
          showFloorBanner("Boss Chamber Revealed — Collect the Boss Key!");
        }
      }
    }
    uiDirty = true;
  }
}

function handleBossDefeated(boss) {
  for (const cl of state.level.enemies) {
    if (cl.isClone) spawnBurst(cl.x, cl.y, "#c084fc", 12, 0.9);
  }
  state.level.enemies = state.level.enemies.filter((e) => !e.isClone);

  const shardIdx = boss.shardIndex;
  const bonus = DIFFICULTIES[state.difficulty]?.shardBonus || 0;
  if (shardIdx !== undefined) {
    state.shardsCollected[shardIdx] = true;
    meta.soulShards += 3 + bonus;
    saveMeta(meta);
    addLog(`You reclaimed Crown Shard ${shardIdx + 1}! (+${3 + bonus} Soul Shards)`, "story");
  }

  const bossLootPool =
    state.floor >= 8
      ? Object.values(ITEMS).filter((it) => it.rarity === "legendary")
      : Object.values(ITEMS).filter((it) => it.rarity === "unique");
  if (bossLootPool.length > 0) {
    const bossDrop = bossLootPool[Math.floor(Math.random() * bossLootPool.length)];
    const rInfo = getRarityInfo(bossDrop);
    spawnGroundItem(bossDrop, boss.x, boss.y);
    addFloat(boss.x, boss.y - 0.5, `${rInfo.label}: ${bossDrop.name}!`, rInfo.color);
    addLog(`${boss.name} dropped [${rInfo.label}] ${bossDrop.name}!`, "loot");
  }

  for (const pr of state.level.props) {
    if (pr.kind === "door" && pr.locked) {
      pr.locked = false;
      pr.opened = true;
      pr.solid = false;
    }
  }
  const bossBar = document.getElementById("boss-hud-bar");
  if (bossBar) bossBar.hidden = true;

  if (state.floor === 12) {
    meta.victories += 1;
    meta.soulShards += 5 + bonus;
    saveMeta(meta);
    endRun(true);
    return;
  }

  const { x, y } = state.level.stairsPos;
  state.level.grid[y][x] = TILE.STAIRS;
  spawnBurst(x + 0.5, y + 0.5, "#38bdf8", 24, 1.4);
  spawnRing(x + 0.5, y + 0.5, 56, "#38bdf8", 0.6);
  addLog("The sanctum seal breaks! Stairs to the next floor have appeared.", "story");
  uiDirty = true;
}

function isBlockedAt(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
  if (state.level.grid[ty][tx] === TILE.WALL) return true;
  return state.level.props.some((pr) => pr.solid && pr.kind !== "torch" && pr.x === tx && pr.y === ty);
}

function distPointToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq <= 1e-6) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

function canOccupy(cx, cy, radius) {
  const minX = Math.floor(cx - radius);
  const maxX = Math.floor(cx + radius);
  const minY = Math.floor(cy - radius);
  const maxY = Math.floor(cy + radius);
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      if (isBlockedAt(tx, ty)) return false;
    }
  }
  return true;
}

function moveWithSlide(entity, dx, dy, radius) {
  if (dx !== 0 && canOccupy(entity.x + dx, entity.y, radius)) {
    entity.x += dx;
  }
  if (dy !== 0 && canOccupy(entity.x, entity.y + dy, radius)) {
    entity.y += dy;
  }
}

function interactProp(prop) {
  if (prop.kind === "chest" && !prop.opened) {
    prop.opened = true;
    prop.solid = false;
    sfx.loot();
    const gold = 12 + state.floor * 5;
    state.player.gold += gold;
    const gearPool = [
      ITEMS.oak_shortbow,
      ITEMS.apprentice_wand,
      ITEMS.frost_wand,
      ITEMS.hunter_arrows,
      ITEMS.apprentice_tome,
      ITEMS.vanguard_blade,
      ITEMS.oak_shield,
      ITEMS.plate_armor,
      ITEMS.steel_helm,
      ITEMS.ranger_bow,
      ITEMS.ranger_quiver,
      ITEMS.ranger_tunic,
      ITEMS.scroll_smite,
      ITEMS.health_potion,
    ];
    if (state.floor >= 2) {
      gearPool.push(
        ITEMS.ranger_hood,
        ITEMS.ranger_boots,
        ITEMS.battle_axe,
        ITEMS.crimson_buckler,
        ITEMS.crimson_coat,
        ITEMS.swift_boots,
        ITEMS.ember_ring,
        ITEMS.astral_wand,
        ITEMS.astral_focus
      );
    }
    if (state.floor >= 4) {
      gearPool.push(
        ITEMS.astral_robes,
        ITEMS.astral_circlet,
        ITEMS.astral_ring,
        ITEMS.sun_staff,
        ITEMS.aegis_shield,
        ITEMS.sunfire_vestments,
        ITEMS.sunfire_crown,
        ITEMS.sunfire_ring
      );
    }
    if (state.floor >= 6) {
      gearPool.push(
        ITEMS.void_reaver,
        ITEMS.void_bulwark,
        ITEMS.void_plate,
        ITEMS.void_helm,
        ITEMS.void_greaves,
        ITEMS.void_ring,
        ITEMS.void_tome,
        ITEMS.sovereign_crossbow,
        ITEMS.sovereign_wand,
        ITEMS.sovereign_quiver,
        ITEMS.sovereign_plate,
        ITEMS.sovereign_crown,
        ITEMS.sovereign_greaves
      );
    }
    const drop = gearPool[Math.floor(Math.random() * gearPool.length)];
    const rInfo = getRarityInfo(drop);
    spawnBurst(prop.x + 0.5, prop.y + 0.5, rInfo.color, 14);
    if (giveOrDropItem(drop, prop.x + 0.5, prop.y + 0.5)) {
      addFloat(prop.x + 0.5, prop.y + 0.5, `+${drop.name}`, rInfo.color);
      addLog(`Opened chest: found ${gold} Gold and [${rInfo.label}] ${drop.name}!`, "loot");
    } else {
      addFloat(prop.x + 0.5, prop.y + 0.5, "Inventory is full!", "#f87171");
      addLog(`Opened chest: found ${gold} Gold and [${rInfo.label}] ${drop.name}, but inventory is full! Left on the ground.`, "info");
    }
    uiDirty = true;
  } else if (["crate", "barrel", "urn"].includes(prop.kind) && !prop.broken) {
    prop.broken = true;
    prop.solid = false;
    sfx.hit();
    spawnBurst(prop.x + 0.5, prop.y + 0.5, "#b45309", 10);
    if (Math.random() < 0.5) {
      const gold = 4 + Math.floor(Math.random() * 7);
      state.player.gold += gold;
      addFloat(prop.x + 0.5, prop.y + 0.5, `+${gold}g`, "#fde047");
      addLog(`Smashed ${prop.kind}: found ${gold} Gold.`, "loot");
    } else if (Math.random() < 0.45) {
      if (giveOrDropItem(ITEMS.bread, prop.x + 0.5, prop.y + 0.5)) {
        addFloat(prop.x + 0.5, prop.y + 0.5, "+Hearth Loaf", "#86efac");
        addLog(`Smashed ${prop.kind}: found a Hearth Loaf.`, "loot");
      } else {
        addFloat(prop.x + 0.5, prop.y + 0.5, "Inventory is full!", "#f87171");
        addLog(`Smashed ${prop.kind}: found a Hearth Loaf, but inventory is full! Left on the ground.`, "info");
      }
    } else {
      addLog(`Smashed ${prop.kind}—empty.`, "info");
    }
    uiDirty = true;
  } else if (prop.kind === "well") {
    if (!prop.used) {
      prop.used = true;
      const stats = getPlayerStats();
      const hpGain = Math.round(stats.maxHp * 0.5);
      const mpGain = Math.round(stats.maxMp * 0.5);
      state.player.hp = Math.min(stats.maxHp, state.player.hp + hpGain);
      state.player.mp = Math.min(stats.maxMp, state.player.mp + mpGain);
      sfx.heal();
      addFloat(prop.x + 0.5, prop.y + 0.5, `+${hpGain} HP`, "#4ade80");
      spawnBurst(prop.x + 0.5, prop.y + 0.5, "#38bdf8", 14);
      addLog(`You drink from the Sanctum Well (+${hpGain} HP, +${mpGain} MP).`, "heal");
      uiDirty = true;
    }
  } else if (prop.kind === "door") {
    if (prop.locked) {
      if (prop.isBossDoor && state.bossFightStarted) {
        if ((state.doorMsgCd || 0) <= 0) {
          state.doorMsgCd = 1.4;
          addFloat(prop.x + 0.5, prop.y + 0.5, "Arena Sealed!", "#fca5a5");
          addLog("The Boss Chamber door is sealed until the boss is defeated!", "info");
        }
        return;
      }
      if (prop.isBossDoor && state.hasBossKey) {
        prop.locked = true;
        prop.opened = false;
        prop.solid = true;
        sfx.loot();
        addFloat(prop.x + 0.5, prop.y + 0.5, "ARENA SEALED!", "#facc15");
        spawnBurst(prop.x + 0.5, prop.y + 0.5, "#facc15", 14);
        addLog("Entered the Boss Chamber — the door slams shut behind you!", "story");

        const rooms = state.level.rooms || [];
        const bossRoom = rooms[rooms.length - 1];
        if (bossRoom) {
          let inX = prop.x + 0.5;
          let inY = prop.y + 0.5;
          if (prop.x < bossRoom.x) inX = bossRoom.x + 0.9;
          else if (prop.x >= bossRoom.x + bossRoom.w) inX = bossRoom.x + bossRoom.w - 0.9;
          else if (prop.y < bossRoom.y) inY = bossRoom.y + 0.9;
          else if (prop.y >= bossRoom.y + bossRoom.h) inY = bossRoom.y + bossRoom.h - 0.9;
          state.player.x = inX;
          state.player.y = inY;
        }

        revealBossRoom(state.level, true);
        updateFOVIfNeeded(true);
        checkBossSpotted();
        const boss = state.level.enemies.find((e) => e.isBoss);
        if (boss && !state.bossFightStarted) {
          startBossMatch(boss, true);
        }
      } else if ((state.doorMsgCd || 0) <= 0) {
        state.doorMsgCd = 1.4;
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

function openStairsDialog() {
  const dlg = document.getElementById("stairs-dialog");
  if (!dlg || dlg.open) return;
  keys.clear();
  touchMove.active = false;
  touchMove.x = 0;
  touchMove.y = 0;
  const nextFloor = state.floor + 1;
  document.getElementById("stairs-dialog-title").textContent = `Descend to Floor ${nextFloor}?`;
  document.getElementById("stairs-dialog-text").textContent =
    `You found the stairs down to Floor ${nextFloor}. Do you want to proceed now or keep exploring Floor ${state.floor}?`;
  dlg.showModal();
}

function descendFloor() {
  state.floor += 1;
  if (state.floor > meta.bestFloor) {
    meta.bestFloor = state.floor;
    saveMeta(meta);
  }
  state.level = generateFloor(state.floor, state.difficulty || "normal");
  state.bossFightStarted = false;
  state.hasBossKey = false;
  state.bossKeyDrop = null;
  state.invFullMsgCd = 0;
  state.shopCooldown = 0;
  state.camReveal = null;
  state.bossIntroTimer = 0;
  const bossBar = document.getElementById("boss-hud-bar");
  if (bossBar) bossBar.hidden = true;
  const introEl = document.getElementById("boss-intro-overlay");
  if (introEl) introEl.hidden = true;
  state.player.x = state.level.playerStart.x + 0.5;
  state.player.y = state.level.playerStart.y + 0.5;
  state.player.z = 0;
  state.player.leap = null;
  state.player.valiantCharge = null;
  state.player.radiantCharge = null;
  state.player.ultCharge = null;
  state.player.rapidSlash = null;
  state.player.stunTimer = 0;
  state.player.tempDef = 0;
  state.player.tempDefTimer = 0;
  state.projectiles = [];
  state.slashes = [];
  state.rings = [];
  state.beams = [];
  state.arrowStorms = [];
  state.frostZones = [];
  state.fallingArrows = [];
  state.afterimages = [];
  const stats = getPlayerStats();
  state.player.mp = Math.min(stats.maxMp, state.player.mp + 4);
  updateFOVIfNeeded(true);
  sfx.stairs();
  showFloorBanner(`Floor ${state.floor} — ${state.level.act.name}`);
  addLog(`Descended to Floor ${state.floor} (${state.level.act.name}).`, "story");
  checkBossSpotted();
  uiDirty = true;
  saveRun();
}

function isBossRoomUnlocked(lvl) {
  if (!lvl?.isBossFloor) return false;
  const door = lvl.props?.find((pr) => pr.isBossDoor);
  return Boolean(door && !door.locked);
}

function revealBossRoom(lvl, fullVisibility = false) {
  const rooms = lvl?.rooms || [];
  const bossRoom = rooms[rooms.length - 1];
  if (!bossRoom) return;
  for (let y = Math.max(0, bossRoom.y - 1); y <= Math.min(MAP_H - 1, bossRoom.y + bossRoom.h); y++) {
    for (let x = Math.max(0, bossRoom.x - 1); x <= Math.min(MAP_W - 1, bossRoom.x + bossRoom.w); x++) {
      if (lvl.explored[y]) lvl.explored[y][x] = true;
      if (fullVisibility && lvl.visible[y]) lvl.visible[y][x] = true;
    }
  }
}

function updateFOVIfNeeded(force = false) {
  const tx = Math.floor(state.player.x);
  const ty = Math.floor(state.player.y);
  if (force || tx !== state.lastFovTile.x || ty !== state.lastFovTile.y) {
    state.lastFovTile.x = tx;
    state.lastFovTile.y = ty;
    computeFOV(state.level, tx, ty, 6);
    if (state.level.isBossFloor && (state.bossFightStarted || isBossRoomUnlocked(state.level))) {
      revealBossRoom(state.level, true);
    }
    checkBossSpotted();
  }
}

function checkBossSpotted() {
  for (const e of state.level.enemies) {
    const ex = Math.floor(e.x);
    const ey = Math.floor(e.y);
    if (e.isBoss && state.level.visible[ey]?.[ex] && !state.seenBosses.has(e.uid)) {
      state.seenBosses.add(e.uid);
      if (e.id === "royal_goblin") unlockCodex("grak");
      if (e.id === "gilded_knight") unlockCodex("aurelius");
      if (e.id === "void_king") unlockCodex("malakor");
      addLog(`BOSS ENCOUNTER: ${e.name} blocks your path!`, "story");
    }
  }
}

function getAimAngle() {
  const p = state.player;
  if (mouse.inside && mouse.x !== null) {
    return Math.atan2(mouse.y - p.y, mouse.x - p.x);
  }
  return p.aimAngle;
}

function performMeleeAttack() {
  if (!state || state.runEnded || state.dyingTimer > 0) return;
  const p = state.player;
  if ((p.stunTimer || 0) > 0 || p.attackCd > 0) return;

  const angle = getAimAngle();
  p.aimAngle = angle;
  p.facingLeft = Math.cos(angle) < 0;
  const stats = getPlayerStats();
  const weapon = p.equipment?.weapon;
  const isRanged =
    weapon && (weapon.weaponType === "bow" || weapon.weaponType === "wand" || weapon.weaponType === "staff" || weapon.ranged);

  if (isRanged) {
    const isBow = weapon.weaponType === "bow" || weapon.projectileKind === "arrow" || weapon.projectileKind === "fire_arrow";
    p.anim = isBow && p.heroClass === "soldier" ? "bow" : "attack";
    p.animTimer = 0.22;
    p.attackCd = weapon.attackCd || 0.36;

    const isCrit = Math.random() * 100 < stats.crit;
    const dmg = Math.round(stats.atk * (isCrit ? 1.65 : 1));
    const speed = weapon.projSpeed || (isBow ? 13.0 : 11.5);
    const color = weapon.projColor || (isBow ? "#fde047" : "#38bdf8");

    if (isBow) {
      sfx.arrow();
    } else {
      sfx.magicOrb();
    }

    state.projectiles.push({
      x: p.x + Math.cos(angle) * 0.42,
      y: p.y + Math.sin(angle) * 0.42,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: isBow ? 0.22 : 0.25,
      color,
      dmg,
      isCrit,
      isEnemy: false,
      isArrow: isBow,
      isMagicOrb: !isBow,
      fireTrail: weapon.projectileKind === "fire_arrow",
      chill: weapon.chill || 0,
      life: 0.9,
      label: weapon.name,
    });
    spawnBurst(p.x + Math.cos(angle) * 0.4, p.y + Math.sin(angle) * 0.4, color, 4, 0.55);
    return;
  }

  p.anim = "attack";
  p.animTimer = 0.24;
  p.attackCd = 0.34;

  // Small forward lunge
  moveWithSlide(p, Math.cos(angle) * 0.18, Math.sin(angle) * 0.18, 0.28);

  state.slashes.push({
    x: p.x * TILE_SIZE,
    y: p.y * TILE_SIZE,
    angle,
    radius: 36,
    life: 0.16,
    maxLife: 0.16,
    color: "#fde047",
  });
  sfx.slash();

  const reach = 1.55;
  let hitAny = false;

  for (const e of [...state.level.enemies]) {
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= reach) {
      const angToEnemy = Math.atan2(dy, dx);
      let diff = Math.abs(angToEnemy - angle);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff <= 1.25 || dist < 0.7) {
        const isCrit = Math.random() * 100 < stats.crit;
        const dmg = Math.round(stats.atk * (isCrit ? 1.65 : 1));
        const nx = dist > 0.01 ? dx / dist : Math.cos(angle);
        const ny = dist > 0.01 ? dy / dist : Math.sin(angle);
        damageEnemy(e, dmg, isCrit, "blade", nx * 3.8, ny * 3.8);
        hitAny = true;
      }
    }
  }

  // Smash breakables in melee arc
  for (const pr of state.level.props) {
    if (!pr.solid || !["crate", "barrel", "urn"].includes(pr.kind)) continue;
    const dx = pr.x + 0.5 - p.x;
    const dy = pr.y + 0.5 - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= reach) {
      interactProp(pr);
      hitAny = true;
    }
  }

  if (hitAny) state.shake = Math.max(state.shake, 2);
}

function performDash() {
  if (!state || state.runEnded || state.dyingTimer > 0) return;
  const p = state.player;
  if ((p.stunTimer || 0) > 0 || p.dashCd > 0 || p.dashTimer > 0) return;
  if (p.mp < 10) {
    addLog("Not enough MP to Dash! (10 MP required)", "info");
    return;
  }
  p.mp -= 10;
  uiDirty = true;

  let dx = 0;
  let dy = 0;
  if (keys.has("w") || keys.has("arrowup")) dy -= 1;
  if (keys.has("s") || keys.has("arrowdown")) dy += 1;
  if (keys.has("a") || keys.has("arrowleft")) dx -= 1;
  if (keys.has("d") || keys.has("arrowright")) dx += 1;

  if (dx === 0 && dy === 0) {
    if (touchMove.active && (Math.abs(touchMove.x) > 0.1 || Math.abs(touchMove.y) > 0.1)) {
      dx = touchMove.x;
      dy = touchMove.y;
    } else {
      const ang = getAimAngle();
      dx = Math.cos(ang);
      dy = Math.sin(ang);
    }
  }
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;

  p.dashDirX = dx;
  p.dashDirY = dy;
  p.dashTimer = 0.16;
  p.dashCd = 1.05;
  p.iFrames = Math.max(p.iFrames, 0.24);
  p.facingLeft = dx < 0;
  sfx.dash();
  spawnBurst(p.x, p.y, "#38bdf8", 8, 0.9);
}

function castSpell(spellId) {
  if (!state || state.runEnded || state.dyingTimer > 0) return;
  const spell = SPELLS.find((s) => s.id === spellId);
  if (!spell) return;
  const p = state.player;
  if ((p.stunTimer || 0) > 0 || p.leap || p.ultCharge || p.rapidSlash || p.valiantCharge || p.radiantCharge) return;
  const stats = getPlayerStats();

  const rank = p.skillRanks[spell.id] || 0;
  if (rank <= 0) {
    addLog(`${spell.name} is locked! Level up to earn Skill Points.`, "info");
    return;
  }
  if (state.spellCooldowns[spell.id] > 0) return;
  if (p.mp < spell.mpCost) {
    addLog("Not enough MP!", "info");
    return;
  }

  const rIdx = Math.min(rank - 1, spell.cooldowns.length - 1);
  p.mp -= spell.mpCost;
  state.spellCooldowns[spell.id] = spell.cooldowns[rIdx];
  uiDirty = true;

  const angle = getAimAngle();
  p.aimAngle = angle;
  p.facingLeft = Math.cos(angle) < 0;

  if (spell.type === "aoe_self") {
    sfx.nova();
    p.anim = "attack";
    p.animTimer = 0.24;
    state.shake = Math.max(state.shake, 5);
    const radius = spell.radii[rIdx];
    const dmg = Math.round(stats.atk * spell.mults[rIdx]);
    spawnBurst(p.x, p.y, spell.color, 22, 1.3);
    spawnRing(p.x, p.y, radius * TILE_SIZE, spell.color, 0.35);
    spawnRing(p.x, p.y, radius * TILE_SIZE * 0.65, "#fde047", 0.25);

    const hits = state.level.enemies.filter((e) => Math.hypot(e.x - p.x, e.y - p.y) <= radius + 0.35);
    for (const e of hits) {
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const dist = Math.max(0.01, Math.hypot(dx, dy));
      damageEnemy(e, dmg, false, spell.name, (dx / dist) * 5.2, (dy / dist) * 5.2);
    }
    if (hits.length === 0) addLog(`${spell.name} echoed through empty air.`, "info");
    return;
  }

  if (spell.type === "projectile") {
    sfx.frost();
    p.anim = "attack";
    p.animTimer = 0.18;
    const speed = 11.5;
    const range = spell.range || 7.5;
    state.projectiles.push({
      x: p.x + Math.cos(angle) * 0.4,
      y: p.y + Math.sin(angle) * 0.4,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: 0.25,
      color: spell.color,
      dmg: Math.round(stats.atk * spell.mults[rIdx]) + spell.flats[rIdx],
      isEnemy: false,
      isFrostLance: true,
      chill: spell.chills[rIdx],
      frostRadius: 2.0,
      frostDuration: 4.0,
      frostFreezeDur: 1.5,
      frostShatterDmg: Math.max(2, Math.round(stats.atk * 0.35)),
      life: range / speed,
      label: spell.name,
    });
    return;
  }

  if (spell.type === "targeted") {
    sfx.smite();
    p.anim = "attack";
    p.animTimer = 0.22;

    // Auto-target nearest visible enemy within range
    let bestEnemy = null;
    let bestDist = spell.range + 0.4;
    for (const e of state.level.enemies) {
      if (e.isBoss && !state.bossFightStarted) continue;
      const ex = Math.floor(e.x);
      const ey = Math.floor(e.y);
      if (!state.level.visible[ey]?.[ex]) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d <= bestDist) {
        bestDist = d;
        bestEnemy = e;
      }
    }

    let targetX = bestEnemy ? bestEnemy.x : p.x + Math.cos(angle) * 2.2;
    let targetY = bestEnemy ? bestEnemy.y : p.y + Math.sin(angle) * 2.2;
    if (bestEnemy) {
      p.facingLeft = bestEnemy.x < p.x;
    }

    spawnBurst(targetX, targetY, spell.color, 18, 1.2);
    spawnRing(targetX, targetY, 38, spell.color, 0.35);
    state.beams.push({
      x: targetX * TILE_SIZE,
      y: targetY * TILE_SIZE,
      color: spell.color,
      life: 0.32,
      maxLife: 0.32,
    });
    state.shake = Math.max(state.shake, 4);

    const dmg = Math.round(stats.atk * spell.mults[rIdx]) + spell.flats[rIdx];
    for (const e of [...state.level.enemies]) {
      if (Math.hypot(e.x - targetX, e.y - targetY) <= 1.25) {
        damageEnemy(e, dmg, false, spell.name, 0, 0);
      }
    }
    return;
  }

  if (spell.type === "ultimate_leap") {
    sfx.ultLeap();
    p.anim = "attack";
    p.animTimer = 1.25;
    p.iFrames = 1.4;
    p.leap = {
      progress: 0,
      duration: 1.25,
      maxHeight: 74,
      dirX: Math.cos(angle),
      dirY: Math.sin(angle),
      rankIdx: rIdx,
      spell,
    };
    spawnBurst(p.x, p.y, "#fde047", 14, 1.1);
    addFloat(p.x, p.y - 0.5, "SKYFALL!", "#f97316");
    return;
  }

  if (spell.type === "aegis_bulwark") {
    const bonus = spell.defBonuses[rIdx];
    p.tempDef = bonus;
    p.tempDefTimer = spell.duration;
    p.aegisBlast = { timer: spell.duration, stun: spell.stuns[rIdx], radius: spell.radius, spell };
    sfx.heal();
    spawnBurst(p.x, p.y, "#38bdf8", 14, 1.1);
    spawnRing(p.x, p.y, 32, "#facc15", 0.35);
    addFloat(p.x, p.y - 0.35, `AEGIS +${bonus} DEF`, "#38bdf8");
    return;
  }

  if (spell.type === "radiant_cleave") {
    sfx.heal();
    p.anim = "attack";
    p.animTimer = 0.52;
    p.radiantCharge = {
      timer: 0.5,
      duration: 0.5,
      angle,
      rankIdx: rIdx,
      dmg: Math.round(stats.atk * spell.mults[rIdx]),
      spell,
    };
    spawnRing(p.x, p.y, 34, "#fb923c", 0.35);
    spawnBurst(p.x, p.y, "#fde047", 10, 0.9);
    return;
  }

  if (spell.type === "sovereign_grace") {
    const healAmt = spell.heals[rIdx];
    p.hp = Math.min(stats.maxHp, p.hp + healAmt);
    p.hasteTimer = spell.duration;
    sfx.heal();
    spawnBurst(p.x, p.y, "#34d399", 18, 1.2);
    spawnRing(p.x, p.y, 38, "#34d399", 0.4);
    addFloat(p.x, p.y - 0.35, `+${healAmt} HP · HASTE`, "#34d399");
    addLog(`${spell.name}: Restored ${healAmt} HP and gained +15% Speed!`, "heal");
    return;
  }

  if (spell.type === "valiant_charge") {
    sfx.ultLeap();
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    p.facingLeft = dirX < 0;
    p.anim = "attack";
    p.animTimer = 0.55;
    p.iFrames = Math.max(p.iFrames, 0.58);
    // Compute exact landing endpoint up to max range ahead
    let endX = p.x;
    let endY = p.y;
    const maxDist = spell.dist || 5.5;
    const step = 0.25;
    for (let d = step; d <= maxDist; d += step) {
      const nx = p.x + dirX * d;
      const ny = p.y + dirY * d;
      if (canOccupy(nx, ny, 0.28)) {
        endX = nx;
        endY = ny;
      } else {
        break;
      }
    }
    const travelDist = Math.hypot(endX - p.x, endY - p.y);
    const spearDistMax = Math.max(1.35, travelDist);
    p.valiantCharge = {
      phase: "windup",
      timer: 0.28,
      windupDur: 0.28,
      dashDur: 0.22,
      startX: p.x,
      startY: p.y,
      targetX: endX,
      targetY: endY,
      travelDist,
      spearDistMax,
      traveled: 0,
      dirX,
      dirY,
      speed: travelDist > 0.05 ? travelDist / 0.22 : 0,
      baseDmg: Math.round(stats.atk * spell.mults[rIdx]),
      wallBonus: spell.wallBonus || 0.65,
      piercedIds: new Set(),
      hitIds: new Set(),
      spell,
    };
    spawnRing(p.x, p.y, 26, "#38bdf8", 0.3);
    return;
  }

  if (spell.type === "seal_retribution") {
    sfx.nova();
    p.retributionTimer = spell.duration;
    p.retributionReflect = spell.reflects[rIdx];
    p.retributionBurn = spell.burnDmg[rIdx];
    p.retributionTick = 0.2;
    p.retributionRadius = spell.radius;
    spawnBurst(p.x, p.y, "#ef4444", 18, 1.2);
    spawnRing(p.x, p.y, spell.radius * TILE_SIZE, "#ef4444", 0.4);
    addFloat(p.x, p.y - 0.35, "RETRIBUTION", "#ef4444");
    addLog(`${spell.name}: Consecrated thorns active for ${spell.duration}s!`, "story");
    return;
  }

  if (spell.type === "rapid_slash") {
    p.rapidSlash = {
      remaining: spell.hits || 3,
      timer: 0,
      interval: 0.12,
      angle,
      rankIdx: rIdx,
      spell,
    };
    return;
  }

  if (spell.type === "cleave_lifesteal") {
    sfx.slash();
    p.anim = "attack";
    p.animTimer = 0.25;
    state.slashes.push({
      x: p.x * TILE_SIZE,
      y: p.y * TILE_SIZE,
      angle,
      color: spell.color,
      life: 0.24,
      maxLife: 0.24,
    });
    const dmg = Math.round(stats.atk * spell.mults[rIdx]);
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    let totalDmg = 0;
    for (const e of [...state.level.enemies]) {
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= spell.range) {
        const dot = dist < 0.01 ? 1 : (dx / dist) * dirX + (dy / dist) * dirY;
        if (dot >= -0.15 || dist < 0.9) {
          damageEnemy(e, dmg, false, spell.name, dirX * 3.0, dirY * 3.0);
          totalDmg += dmg;
        }
      }
    }
    if (totalDmg > 0) {
      const healAmt = Math.max(1, Math.round(totalDmg * spell.lifesteals[rIdx]));
      p.hp = Math.min(stats.maxHp, p.hp + healAmt);
      addFloat(p.x, p.y - 0.35, `+${healAmt} HP`, "#4ade80");
      spawnBurst(p.x, p.y, "#f87171", 10, 0.9);
    } else {
      addLog(`${spell.name} cleaved empty air.`, "info");
    }
    return;
  }

  if (spell.type === "ultimate_charge_stun") {
    sfx.ultLeap();
    p.anim = "attack";
    p.animTimer = spell.chargeTime;
    p.ultCharge = {
      timer: spell.chargeTime,
      duration: spell.chargeTime,
      rankIdx: rIdx,
      spell,
    };
    addFloat(p.x, p.y - 0.5, "CHARGING...", "#fde047");
    addLog(`${spell.name}: Raising sword (${spell.chargeTime.toFixed(1)}s charge)...`, "story");
    return;
  }

  if (spell.type === "arrow_volley") {
    sfx.slash();
    p.anim = "attack";
    p.animTimer = 0.22;
    const speed = 13.0;
    const dmg = Math.round(stats.atk * spell.mults[rIdx]);
    for (const offset of [-0.22, 0, 0.22]) {
      const a = angle + offset;
      state.projectiles.push({
        x: p.x + Math.cos(a) * 0.4,
        y: p.y + Math.sin(a) * 0.4,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        radius: 0.24,
        color: spell.color,
        dmg,
        isEnemy: false,
        isArrow: true,
        life: 0.72,
        label: spell.name,
      });
    }
    return;
  }

  if (spell.type === "piercing_shot") {
    sfx.frost();
    p.anim = "attack";
    p.animTimer = 0.24;
    const speed = 15.0;
    state.projectiles.push({
      x: p.x + Math.cos(angle) * 0.4,
      y: p.y + Math.sin(angle) * 0.4,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: 0.28,
      color: spell.color,
      dmg: Math.round(stats.atk * spell.mults[rIdx]),
      isEnemy: false,
      isArrow: true,
      pierce: true,
      hitIds: new Set(),
      life: 0.8,
      label: spell.name,
    });
    return;
  }

  if (spell.type === "battle_rally") {
    const healAmt = spell.heals[rIdx];
    const atkBonus = spell.atkBonuses[rIdx];
    p.hp = Math.min(stats.maxHp, p.hp + healAmt);
    p.tempAtk = atkBonus;
    p.tempAtkTimer = spell.duration;
    sfx.levelUp();
    spawnBurst(p.x, p.y, "#fb923c", 16, 1.2);
    spawnRing(p.x, p.y, 38, "#facc15", 0.35);
    addFloat(p.x, p.y - 0.35, `+${healAmt} HP · +${atkBonus} ATK`, "#fde047");
    addLog(`${spell.name}: +${healAmt} HP and +${atkBonus} ATK for ${spell.duration}s!`, "heal");
    return;
  }

  if (spell.type === "ultimate_barrage") {
    sfx.ultLeap();
    p.anim = "attack";
    p.animTimer = 0.35;
    let bestEnemy = null;
    let bestDist = 7.5;
    for (const e of state.level.enemies) {
      if (e.isBoss && !state.bossFightStarted) continue;
      if (!state.level.visible[Math.floor(e.y)]?.[Math.floor(e.x)]) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d <= bestDist) {
        bestDist = d;
        bestEnemy = e;
      }
    }
    const tx = bestEnemy ? bestEnemy.x : p.x + Math.cos(angle) * 2.8;
    const ty = bestEnemy ? bestEnemy.y : p.y + Math.sin(angle) * 2.8;
    const radius = spell.radii[rIdx];
    const dmg = Math.round(stats.atk * spell.mults[rIdx]) + spell.flats[rIdx];
    const chillDur = spell.chills[rIdx];
    const dur = spell.duration || 3.0;

    if (!state.arrowStorms) state.arrowStorms = [];
    if (!state.fallingArrows) state.fallingArrows = [];
    state.arrowStorms.push({
      x: tx,
      y: ty,
      radius,
      duration: dur,
      timer: dur,
      tickInterval: spell.tickInterval || 0.35,
      tickTimer: 0,
      spawnTimer: 0,
      dmg,
      chillDur,
      spell,
    });
    spawnRing(tx, ty, radius * TILE_SIZE, "#facc15", 0.4);
    addFloat(tx, ty - 0.5, "ARROW STORM!", "#fde047");
    addLog(`${spell.name}: Raining arrows for ${dur.toFixed(1)}s!`, "story");
    return;
  }
}

function useInventoryItem(index) {
  if (!state || state.runEnded || state.dyingTimer > 0) return;
  const inv = state.player.inventory;
  const item = inv[index];
  if (!item) return;

  const p = state.player;
  const stats = getPlayerStats();

  if (item.type === "consumable") {
    if (item.healHp) {
      p.hp = Math.min(stats.maxHp, p.hp + item.healHp);
      sfx.heal();
      addFloat(p.x, p.y, `+${item.healHp} HP`, "#4ade80");
      spawnBurst(p.x, p.y, "#4ade80", 10);
      addLog(`Used ${item.name} (+${item.healHp} HP).`, "heal");
    }
    if (item.healMp) {
      p.mp = Math.min(stats.maxMp, p.mp + item.healMp);
      sfx.spell();
      addFloat(p.x, p.y, `+${item.healMp} MP`, "#60a5fa");
      spawnBurst(p.x, p.y, "#60a5fa", 10);
      addLog(`Used ${item.name} (+${item.healMp} MP).`, "heal");
    }
    if (item.buffAtk) {
      p.baseAtk += item.buffAtk;
      sfx.levelUp();
      addFloat(p.x, p.y, `+${item.buffAtk} ATK`, "#fde047");
      spawnBurst(p.x, p.y, "#fde047", 14);
      addLog(`Read ${item.name}: permanently gained +${item.buffAtk} ATK!`, "loot");
    }
    item.qty -= 1;
    if (item.qty <= 0) inv.splice(index, 1);
    uiDirty = true;
  } else if (item.slot) {
    const prev = p.equipment[item.slot];
    p.equipment[item.slot] = item;
    inv.splice(index, 1);
    if (prev) inv.push(prev);

    // Enforce weapon + sub-weapon pairing: incompatible pair returns to inventory (or ground if full)
    let unpaired = null;
    if (item.slot === "weapon" && p.equipment.subweapon && !isWeaponSubPairValid(item, p.equipment.subweapon)) {
      unpaired = p.equipment.subweapon;
      p.equipment.subweapon = null;
    } else if (item.slot === "subweapon" && p.equipment.weapon && !isWeaponSubPairValid(p.equipment.weapon, item)) {
      unpaired = p.equipment.weapon;
      p.equipment.weapon = null;
    }

    sfx.loot();
    addLog(`Equipped ${item.name}.`, "loot");
    if (unpaired) {
      if (addItemToInventory(unpaired, 1, { silentFull: true })) {
        addLog(`Returned ${unpaired.name} to your satchel (does not pair with ${item.name}).`, "info");
      } else {
        spawnGroundItem(unpaired, p.x, p.y, { requireLeave: true });
        addLog(`Satchel full! ${unpaired.name} was placed on the ground (does not pair with ${item.name}).`, "info");
      }
    }
    uiDirty = true;
    saveRun();
  }
}

function quickPotion(id) {
  if (!state) return;
  const idx = state.player.inventory.findIndex((i) => i.id === id);
  if (idx >= 0) useInventoryItem(idx);
  else addLog("None left in your satchel!", "info");
}

function useShortcut(slotIdx) {
  if (!state || state.runEnded || state.dyingTimer > 0) return;
  const itemId = state.player.shortcuts?.[slotIdx];
  if (!itemId) {
    addLog(`Shortcut ${slotIdx + 1} is empty. Open Bag and tap an item to assign it.`, "info");
    return;
  }
  const idx = state.player.inventory.findIndex((i) => i.id === itemId);
  if (idx >= 0) {
    useInventoryItem(idx);
  } else {
    addLog("None left in your satchel!", "info");
  }
}

function openItemActionDialog(index) {
  if (!state || state.runEnded) return;
  const item = state.player.inventory[index];
  if (!item) return;

  const dlg = document.getElementById("item-action-dialog");
  const rInfo = getRarityInfo(item);
  document.getElementById("item-action-icon").src = item.icon;
  const titleEl = document.getElementById("item-action-title");
  titleEl.textContent = item.qty > 1 ? `${item.name} (x${item.qty})` : item.name;
  titleEl.style.color = rInfo.color;
  const descEl = document.getElementById("item-action-desc");
  descEl.innerHTML = `<span class="rarity-badge" style="color:${rInfo.color};border-color:${rInfo.color};background:${rInfo.bg}">${rInfo.label}</span> ${item.desc}`;

  const compareEl = document.getElementById("item-action-compare");
  if (compareEl) {
    if (item.slot) {
      const p = state.player;
      const equipped = p.equipment?.[item.slot] || null;
      const eqRarity = equipped ? getRarityInfo(equipped) : null;
      const slotLabel = item.slot === "subweapon" ? "Sub-Weapon" : item.slot;

      const nextEquipment = { ...p.equipment, [item.slot]: item };
      let unpairedOther = null;
      if (item.slot === "weapon" && nextEquipment.subweapon && !isWeaponSubPairValid(item, nextEquipment.subweapon)) {
        unpairedOther = nextEquipment.subweapon;
        nextEquipment.subweapon = null;
      } else if (item.slot === "subweapon" && nextEquipment.weapon && !isWeaponSubPairValid(nextEquipment.weapon, item)) {
        unpairedOther = nextEquipment.weapon;
        nextEquipment.weapon = null;
      }

      const curStats = getPlayerStats(p);
      const nextPlayer = { ...p, equipment: nextEquipment };
      const nextStats = getPlayerStats(nextPlayer);
      const curSets = getActiveSetBonuses(p).totals;
      const nextSets = getActiveSetBonuses(nextPlayer).totals;

      const statDefs = [
        { key: "atk", label: "ATK", suffix: "", netKey: "atk" },
        { key: "def", label: "DEF", suffix: "", netKey: "def" },
        { key: "crit", label: "CRIT", suffix: "%", netKey: "crit" },
        { key: "maxHp", label: "Max HP", suffix: "", netKey: "maxHp" },
        { key: "maxMp", label: "Max MP", suffix: "", netKey: "maxMp" },
      ];

      let rowsHtml = "";
      for (const sd of statDefs) {
        const oldItemVal = equipped?.[sd.key] || 0;
        const newItemVal = item?.[sd.key] || 0;
        const netDiff = nextStats[sd.netKey] - curStats[sd.netKey];
        if (oldItemVal === 0 && newItemVal === 0 && netDiff === 0) continue;

        const cls = netDiff > 0 ? "up" : netDiff < 0 ? "down" : "same";
        const deltaText =
          netDiff > 0
            ? `▲ +${netDiff}${sd.suffix}`
            : netDiff < 0
              ? `▼ ${netDiff}${sd.suffix}`
              : `— 0${sd.suffix}`;
        rowsHtml += `
          <div class="cmp-row">
            <span class="cmp-stat-name">${sd.label}</span>
            <span class="cmp-vals">${oldItemVal}${sd.suffix} → ${newItemVal}${sd.suffix}</span>
            <span class="cmp-delta ${cls}">${deltaText}</span>
          </div>
        `;
      }

      const setDeltaParts = [];
      for (const [k, lbl, sfxTxt] of [
        ["atk", "ATK", ""],
        ["def", "DEF", ""],
        ["crit", "CRIT", "%"],
        ["maxHp", "Max HP", ""],
        ["maxMp", "Max MP", ""],
      ]) {
        const d = (nextSets[k] || 0) - (curSets[k] || 0);
        if (d !== 0) {
          const c = d > 0 ? "#4ade80" : "#f87171";
          const arrow = d > 0 ? "▲ +" : "▼ ";
          setDeltaParts.push(`<span style="color:${c};font-weight:700">${arrow}${d} ${lbl}${sfxTxt}</span>`);
        }
      }

      compareEl.innerHTML = `
        <div class="item-compare-head">
          <div class="item-compare-side">
            <span class="cmp-label">Equipped (${slotLabel})</span>
            <div class="cmp-item">
              ${
                equipped
                  ? `<img src="${equipped.icon}" class="pixel-icon" alt="" /><span style="color:${eqRarity.color}">${equipped.name}</span>`
                  : `<span style="color:var(--muted)">Empty Slot</span>`
              }
            </div>
          </div>
          <span class="item-compare-arrow">→</span>
          <div class="item-compare-side" style="border-color:${rInfo.color}">
            <span class="cmp-label">To Equip</span>
            <div class="cmp-item">
              <img src="${item.icon}" class="pixel-icon" alt="" /><span style="color:${rInfo.color}">${item.name}</span>
            </div>
          </div>
        </div>
        <div class="item-compare-rows">${rowsHtml || `<div class="hint-text">Same stat values as equipped item.</div>`}</div>
        ${setDeltaParts.length > 0 ? `<div class="cmp-set-note">Set Bonus Change: ${setDeltaParts.join(" · ")}</div>` : ""}
        ${unpairedOther ? `<div class="cmp-pair-warn">Does not pair with <strong>${unpairedOther.name}</strong> — it will return to your satchel.</div>` : ""}
      `;
      compareEl.hidden = false;
    } else {
      compareEl.hidden = true;
      compareEl.innerHTML = "";
    }
  }

  const btnsEl = document.getElementById("item-action-buttons");
  btnsEl.innerHTML = "";

  const primaryBtn = document.createElement("button");
  primaryBtn.type = "button";
  primaryBtn.className = "btn btn-primary";
  primaryBtn.textContent = item.type === "consumable" ? "Consume / Use" : "Equip";
  primaryBtn.addEventListener("click", () => {
    useInventoryItem(index);
    dlg.close();
  });
  btnsEl.appendChild(primaryBtn);

  if (item.slot) {
    const dropBtn = document.createElement("button");
    dropBtn.type = "button";
    dropBtn.className = "btn btn-danger";
    dropBtn.textContent = "Discard to Ground";
    dropBtn.addEventListener("click", () => {
      dropInventoryItem(index, 1);
      dlg.close();
    });
    btnsEl.appendChild(dropBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn-secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => dlg.close());
    btnsEl.appendChild(cancelBtn);
  } else {
    for (let s = 0; s < 4; s++) {
      const sBtn = document.createElement("button");
      sBtn.type = "button";
      sBtn.className = "btn btn-secondary";
      const isAssigned = state.player.shortcuts?.[s] === item.id;
      sBtn.textContent = isAssigned ? `Shortcut ${s + 1} (Set)` : `Add to Shortcut ${s + 1}`;
      sBtn.addEventListener("click", () => {
        if (!state.player.shortcuts) state.player.shortcuts = [null, null, null, null];
        state.player.shortcuts[s] = item.id;
        sfx.loot();
        addLog(`Assigned ${item.name} to Shortcut ${s + 1}.`, "info");
        uiDirty = true;
        saveRun();
        dlg.close();
      });
      btnsEl.appendChild(sBtn);
    }

    const qty = item.qty || 1;
    if (qty > 1) {
      const dropOneBtn = document.createElement("button");
      dropOneBtn.type = "button";
      dropOneBtn.className = "btn btn-danger";
      dropOneBtn.textContent = "Drop 1 to Ground";
      dropOneBtn.addEventListener("click", () => {
        dropInventoryItem(index, 1);
        dlg.close();
      });
      btnsEl.appendChild(dropOneBtn);

      const dropAllBtn = document.createElement("button");
      dropAllBtn.type = "button";
      dropAllBtn.className = "btn btn-danger";
      dropAllBtn.textContent = `Discard All (x${qty})`;
      dropAllBtn.addEventListener("click", () => {
        dropInventoryItem(index, qty);
        dlg.close();
      });
      btnsEl.appendChild(dropAllBtn);
    } else {
      const dropBtn = document.createElement("button");
      dropBtn.type = "button";
      dropBtn.className = "btn btn-danger btn-full";
      dropBtn.textContent = "Drop / Discard to Ground";
      dropBtn.addEventListener("click", () => {
        dropInventoryItem(index, 1);
        dlg.close();
      });
      btnsEl.appendChild(dropBtn);
    }
  }

  dlg.showModal();
}

function openShopDialog(shop) {
  if (!state || state.runEnded || !shop) return;
  const dlg = document.getElementById("shop-dialog");
  if (!dlg) return;

  const BASIC_SKILL_SWAP_COST = 1000;
  const ULT_SKILL_SWAP_COST = 2500;
  let swapState = null; // null | { step: 1 | 2, slotIdx: number | null, candidateId: string | null }

  const renderSkillSwapPanel = (locked) => {
    const panel = document.getElementById("shop-skill-swap-panel");
    const mainView = document.getElementById("shop-main-view");
    if (!panel || !mainView) return;

    if (!swapState || locked || shop.skillSold) {
      swapState = null;
      mainView.hidden = false;
      panel.hidden = true;
      panel.innerHTML = "";
      return;
    }

    mainView.hidden = true;
    panel.hidden = false;
    panel.innerHTML = "";

    const p = state.player;
    const activeSpells = getActiveSpells(p);

    if (swapState.step === 1) {
      const head = document.createElement("div");
      head.className = "skill-swap-step-head";
      head.innerHTML = `
        <div>
          <strong>Step 1 of 2 — Select Skill to Swap Out</strong>
          <div><span>Basic Skill: ${BASIC_SKILL_SWAP_COST}g · Ultimate Skill: ${ULT_SKILL_SWAP_COST}g</span></div>
        </div>
      `;
      panel.appendChild(head);

      const grid = document.createElement("div");
      grid.className = "skill-swap-grid";
      activeSpells.forEach((sp, idx) => {
        const isUlt = Boolean(sp.isUltimate);
        const cost = isUlt ? ULT_SKILL_SWAP_COST : BASIC_SKILL_SWAP_COST;
        const rank = p.skillRanks[sp.id] || 0;
        const canAfford = p.gold >= cost;

        const card = document.createElement("button");
        card.type = "button";
        card.className = `skill-swap-card ${isUlt ? "ult" : ""}`;
        card.disabled = !canAfford;
        card.innerHTML = `
          <img src="${sp.icon}" alt="" />
          <div class="skill-swap-card-body">
            <strong>[${idx + 1}] ${sp.name}${isUlt ? " (ULT)" : ""}</strong>
            <span class="skill-swap-meta">Rank ${rank}/${sp.maxRank} · ${canAfford ? `Swap for ${cost}g` : `Need ${cost}g`}</span>
            <span class="skill-swap-desc">${sp.desc}</span>
          </div>
        `;
        card.addEventListener("click", () => {
          if (!canAfford || locked || shop.skillSold) return;
          swapState = { step: 2, slotIdx: idx, candidateId: null };
          renderShopContents();
        });
        grid.appendChild(card);
      });
      panel.appendChild(grid);

      const actions = document.createElement("div");
      actions.className = "skill-swap-actions";
      const backBtn = document.createElement("button");
      backBtn.type = "button";
      backBtn.className = "btn btn-secondary";
      backBtn.textContent = "Back to Shop";
      backBtn.addEventListener("click", () => {
        swapState = null;
        renderShopContents();
      });
      actions.appendChild(backBtn);
      panel.appendChild(actions);
      return;
    }

    const oldSpell = activeSpells[swapState.slotIdx];
    if (!oldSpell) {
      swapState = { step: 1, slotIdx: null, candidateId: null };
      renderSkillSwapPanel(locked);
      return;
    }
    const isUlt = Boolean(oldSpell.isUltimate);
    const cost = isUlt ? ULT_SKILL_SWAP_COST : BASIC_SKILL_SWAP_COST;
    const oldRank = p.skillRanks[oldSpell.id] || 0;
    const candidates = SPELLS.filter((s) => Boolean(s.isUltimate) === isUlt && !p.loadout.includes(s.id));

    const head = document.createElement("div");
    head.className = "skill-swap-step-head";
    head.innerHTML = `
      <div>
        <strong>Step 2 of 2 — Select Skill to Put in Slot [${swapState.slotIdx + 1}]</strong>
        <div><span>Replacing [${swapState.slotIdx + 1}] ${oldSpell.name} (Carried Rank: Lv ${oldRank}) · Cost: ${cost}g</span></div>
      </div>
    `;
    panel.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "skill-swap-grid";
    for (const cand of candidates) {
      const isSelected = swapState.candidateId === cand.id;
      const card = document.createElement("button");
      card.type = "button";
      card.className = `skill-swap-card ${isUlt ? "ult" : ""} ${isSelected ? "selected" : ""}`;
      card.innerHTML = `
        <img src="${cand.icon}" alt="" />
        <div class="skill-swap-card-body">
          <strong>${cand.name}${isUlt ? " (ULT)" : ""}</strong>
          <span class="skill-swap-meta">${cand.mpCost} MP · ${cand.cooldowns[0]}s CD · Max Lv ${cand.maxRank}</span>
          <span class="skill-swap-desc">${cand.desc}</span>
        </div>
      `;
      card.addEventListener("click", () => {
        swapState.candidateId = cand.id;
        renderSkillSwapPanel(locked);
      });
      grid.appendChild(card);
    }
    panel.appendChild(grid);

    const actions = document.createElement("div");
    actions.className = "skill-swap-actions";

    const leftGroup = document.createElement("div");
    leftGroup.style.display = "flex";
    leftGroup.style.gap = "8px";

    const backStepBtn = document.createElement("button");
    backStepBtn.type = "button";
    backStepBtn.className = "btn btn-secondary";
    backStepBtn.textContent = "Change Slot";
    backStepBtn.addEventListener("click", () => {
      swapState = { step: 1, slotIdx: null, candidateId: null };
      renderSkillSwapPanel(locked);
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn-secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => {
      swapState = null;
      renderShopContents();
    });

    leftGroup.appendChild(backStepBtn);
    leftGroup.appendChild(cancelBtn);

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "btn btn-primary";
    const selectedNew = candidates.find((c) => c.id === swapState.candidateId) || null;
    confirmBtn.disabled = !selectedNew || p.gold < cost || locked || Boolean(shop.skillSold);
    confirmBtn.textContent = selectedNew ? `Confirm Swap (${cost}g)` : `Pick a Skill (${cost}g)`;
    confirmBtn.addEventListener("click", () => {
      if (!selectedNew || p.gold < cost || locked || shop.skillSold) return;
      p.gold -= cost;
      shop.skillSold = true;
      p.loadout[swapState.slotIdx] = selectedNew.id;

      const existingNewRank = p.skillRanks[selectedNew.id] || 0;
      p.skillRanks[selectedNew.id] = Math.min(selectedNew.maxRank, Math.max(oldRank, existingNewRank));
      if (oldSpell.id !== selectedNew.id) {
        p.skillRanks[oldSpell.id] = 0;
      }
      state.spellCooldowns[oldSpell.id] = 0;
      state.spellCooldowns[selectedNew.id] = 0;
      if (oldSpell.id === "seal_retribution") p.sealTimer = 0;
      if (oldSpell.id === "battle_rally") p.rallyTimer = 0;
      if (oldSpell.id === "iron_bastion") p.aegisTimer = 0;

      buildSpellButtons();
      updateCooldownUI();
      sfx.levelUp();
      spawnBurst(p.x, p.y, selectedNew.color || "#facc15", 18, 1.25);
      addFloat(p.x, p.y - 0.35, `Learned ${selectedNew.name}!`, selectedNew.color || "#facc15");
      addLog(`Swapped [${swapState.slotIdx + 1}] ${oldSpell.name} -> ${selectedNew.name} for ${cost} Gold.`, "story");

      swapState = null;
      uiDirty = true;
      saveRun();
      renderShopContents();
    });

    actions.appendChild(leftGroup);
    actions.appendChild(confirmBtn);
    panel.appendChild(actions);
  };

  const renderShopContents = () => {
    const p = state.player;
    const nonBossLeft = state.level.enemies.filter((e) => !e.isBoss && !e.isClone).length;
    const locked = nonBossLeft > 0;

    document.getElementById("shop-gold").textContent = p.gold;
    const statusEl = document.getElementById("shop-status-banner");
    if (locked) {
      statusEl.className = "shop-status locked";
      statusEl.textContent = `Shop Locked — Defeat all enemies on this floor first! (${nonBossLeft} remaining)`;
    } else {
      statusEl.className = "shop-status open";
      statusEl.textContent = "All floor enemies defeated! Browse wares, swap a skill, or sell excess gear before facing the Boss.";
    }

    const stockEl = document.getElementById("shop-stock-list");
    stockEl.innerHTML = "";
    for (const entry of shop.stock) {
      const rInfo = getRarityInfo(entry.item);
      const isVial = entry.item?.id === "health_potion" || entry.item?.id === "mana_potion";
      const maxBuys = typeof entry.maxBuys === "number" ? entry.maxBuys : isVial ? 5 : 1;
      const buys = typeof entry.buys === "number" ? entry.buys : entry.sold ? maxBuys : 0;
      const remaining = Math.max(0, maxBuys - buys);

      const row = document.createElement("div");
      row.className = "shop-row";
      row.style.borderLeft = `3px solid ${rInfo.color}`;

      const stockTag = maxBuys > 1 ? ` · Stock: ${remaining}/${maxBuys}` : " · Buy Once";
      const info = document.createElement("div");
      info.className = "shop-row-info";
      info.innerHTML = `
        <img src="${entry.item.icon}" class="pixel-icon" alt="" />
        <div class="shop-row-meta">
          <strong style="color:${rInfo.color}">${entry.item.name}</strong>
          <span class="shop-desc"><span class="rarity-badge" style="color:${rInfo.color};border-color:${rInfo.color};background:${rInfo.bg}">${rInfo.label}</span>${entry.item.desc}${stockTag}</span>
        </div>
      `;

      const buyBtn = document.createElement("button");
      buyBtn.type = "button";
      buyBtn.className = "btn btn-primary";
      if (remaining <= 0 || entry.sold) {
        buyBtn.textContent = maxBuys > 1 ? "Sold Out" : "Sold";
        buyBtn.disabled = true;
      } else if (locked) {
        buyBtn.textContent = maxBuys > 1 ? `${entry.price}g (${remaining} left · Locked)` : `${entry.price}g (Locked)`;
        buyBtn.disabled = true;
      } else {
        buyBtn.textContent = maxBuys > 1 ? `Buy (${entry.price}g · ${remaining} left)` : `Buy (${entry.price}g)`;
        buyBtn.disabled = p.gold < entry.price;
      }

      buyBtn.addEventListener("click", () => {
        if (locked || remaining <= 0 || entry.sold || p.gold < entry.price) return;
        if (!addItemToInventory(entry.item, 1, { silentFull: true })) {
          addFloat(p.x, p.y - 0.35, "Inventory is full!", "#f87171");
          addLog("Inventory is full! Drop, use, or sell an item before buying.", "info");
          return;
        }
        p.gold -= entry.price;
        entry.maxBuys = maxBuys;
        entry.buys = buys + 1;
        if (entry.buys >= maxBuys) {
          entry.sold = true;
        }
        sfx.loot();
        addFloat(p.x, p.y - 0.3, `+${entry.item.name}`, rInfo.color);
        addLog(`Bought [${rInfo.label}] ${entry.item.name} for ${entry.price} Gold.`, "loot");
        uiDirty = true;
        saveRun();
        renderShopContents();
      });

      row.appendChild(info);
      row.appendChild(buyBtn);
      stockEl.appendChild(row);
    }

    const skillOfferEl = document.getElementById("shop-skill-offer");
    if (skillOfferEl) {
      skillOfferEl.innerHTML = "";
      const skillRow = document.createElement("div");
      skillRow.className = "shop-row";
      skillRow.style.borderLeft = `3px solid ${RARITIES.legendary.color}`;
      skillRow.innerHTML = `
        <div class="shop-row-info">
          <img src="spritecook-inventory-icons/scroll.png" class="pixel-icon" alt="" />
          <div class="shop-row-meta">
            <strong style="color:${RARITIES.legendary.color}">Arcane Skill Swap</strong>
            <span class="shop-desc"><span class="rarity-badge" style="color:${RARITIES.unique.color};border-color:${RARITIES.unique.color};background:${RARITIES.unique.bg}">Buy Once</span>Swap 1 Basic Skill (1000g) or Ultimate Skill (2500g).</span>
          </div>
        </div>
      `;
      const swapBtn = document.createElement("button");
      swapBtn.type = "button";
      swapBtn.className = "btn btn-primary";
      if (shop.skillSold) {
        swapBtn.textContent = "Swapped (Sold)";
        swapBtn.disabled = true;
      } else if (locked) {
        swapBtn.textContent = "1000g / 2500g (Locked)";
        swapBtn.disabled = true;
      } else if (p.gold < BASIC_SKILL_SWAP_COST) {
        swapBtn.textContent = `Need ${BASIC_SKILL_SWAP_COST}g+`;
        swapBtn.disabled = true;
      } else {
        swapBtn.textContent = "Swap Skill (1000g / 2500g)";
      }
      swapBtn.addEventListener("click", () => {
        if (locked || shop.skillSold || p.gold < BASIC_SKILL_SWAP_COST) return;
        swapState = { step: 1, slotIdx: null, candidateId: null };
        renderSkillSwapPanel(locked);
      });
      skillRow.appendChild(swapBtn);
      skillOfferEl.appendChild(skillRow);
    }

    const sellEl = document.getElementById("shop-sell-list");
    sellEl.innerHTML = "";
    if (p.inventory.length === 0) {
      sellEl.innerHTML = `<div class="hint-text">Your satchel is empty.</div>`;
    } else {
      p.inventory.forEach((item, idx) => {
        const rInfo = getRarityInfo(item);
        const sellVal = Math.max(4, Math.floor(getItemPrice(item) * 0.45));
        const row = document.createElement("div");
        row.className = "shop-row";
        row.style.borderLeft = `3px solid ${rInfo.color}`;

        const info = document.createElement("div");
        info.className = "shop-row-info";
        info.innerHTML = `
          <img src="${item.icon}" class="pixel-icon" alt="" />
          <div class="shop-row-meta">
            <strong style="color:${rInfo.color}">${item.name}${item.qty > 1 ? ` (x${item.qty})` : ""}</strong>
            <span class="shop-desc"><span class="rarity-badge" style="color:${rInfo.color};border-color:${rInfo.color};background:${rInfo.bg}">${rInfo.label}</span>${item.desc}</span>
          </div>
        `;

        const sellBtn = document.createElement("button");
        sellBtn.type = "button";
        sellBtn.className = "btn btn-secondary";
        sellBtn.textContent = locked ? `+${sellVal}g (Locked)` : `Sell (+${sellVal}g)`;
        sellBtn.disabled = locked;
        sellBtn.addEventListener("click", () => {
          if (locked) return;
          const target = p.inventory[idx];
          if (!target) return;
          if ((target.qty || 1) > 1) {
            target.qty -= 1;
          } else {
            p.inventory.splice(idx, 1);
          }
          p.gold += sellVal;
          sfx.loot();
          addFloat(p.x, p.y - 0.3, `+${sellVal}g`, "#fde047");
          addLog(`Sold ${target.name} for ${sellVal} Gold.`, "loot");
          uiDirty = true;
          saveRun();
          renderShopContents();
        });

        row.appendChild(info);
        row.appendChild(sellBtn);
        sellEl.appendChild(row);
      });
    }

    renderSkillSwapPanel(locked);
  };

  renderShopContents();
  if (!dlg.open) {
    keys.clear();
    touchMove.active = false;
    touchMove.x = 0;
    touchMove.y = 0;
    dlg.addEventListener(
      "close",
      () => {
        swapState = null;
        state.shopCooldown = 1.8;
      },
      { once: true }
    );
    dlg.showModal();
  }
}

function openStoryDialog(npc) {
  const tpl = NPC_ENCOUNTERS[npc.id];
  if (!tpl) return;
  if (tpl.codexId) unlockCodex(tpl.codexId);

  const dlg = document.getElementById("story-dialog");
  document.getElementById("story-role").textContent = tpl.role;
  document.getElementById("story-dialog-title").textContent = tpl.speaker;
  document.getElementById("story-dialog-text").textContent = tpl.lines[0];

  storyPortraitCtx.clearRect(0, 0, 80, 80);
  storyPortraitCtx.imageSmoothingEnabled = false;
  drawSheetFrame(storyPortraitCtx, assets[tpl.sprite], 0, 4, 4, 72, 72);

  const choicesEl = document.getElementById("story-choices");
  choicesEl.innerHTML = "";

  tpl.choices.forEach((choice, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary";
    if (i === 0) btn.autofocus = true;
    btn.textContent = choice.label;
    if (choice.cost && state.player.gold < choice.cost) {
      btn.disabled = true;
      btn.textContent += " (Not enough Gold)";
    }
    btn.addEventListener("click", () => {
      dlg.close("chosen");
      state.npcCooldown = 1.5;
      applyStoryChoice(choice, npc);
    });
    choicesEl.appendChild(btn);
  });

  const leaveBtn = document.createElement("button");
  leaveBtn.type = "button";
  leaveBtn.className = "btn btn-secondary";
  leaveBtn.textContent = "Farewell (Leave)";
  leaveBtn.addEventListener("click", () => {
    state.npcCooldown = 1.5;
    dlg.close("leave");
  });
  choicesEl.appendChild(leaveBtn);

  dlg.showModal();
}

function revealEntireFloor(lvl) {
  if (!lvl?.explored || !lvl?.grid) return;
  const h = lvl.explored.length;
  for (let y = 0; y < h; y++) {
    const row = lvl.explored[y];
    if (!row) continue;
    const w = row.length;
    for (let x = 0; x < w; x++) {
      if (lvl.grid[y]?.[x] !== TILE.WALL) {
        row[x] = true;
        continue;
      }
      let touchesFloor = false;
      for (let dy = -1; dy <= 1 && !touchesFloor; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny >= 0 && ny < h && nx >= 0 && nx < w && lvl.grid[ny]?.[nx] !== TILE.WALL) {
            touchesFloor = true;
            break;
          }
        }
      }
      if (touchesFloor) row[x] = true;
    }
  }
}

function applyStoryChoice(choice, npc) {
  const p = state.player;
  const stats = getPlayerStats();
  if (choice.cost) p.gold -= choice.cost;

  switch (choice.effect) {
    case "full_heal":
      p.hp = stats.maxHp;
      p.mp = stats.maxMp;
      sfx.heal();
      addLog("Brother Galen's prayer restores you completely.", "heal");
      break;
    case "gift_potions": {
      const gotHp = giveOrDropItem(ITEMS.health_potion, p.x, p.y, { requireLeave: true });
      const gotMp = giveOrDropItem(ITEMS.mana_potion, p.x, p.y, { requireLeave: true });
      sfx.loot();
      if (gotHp && gotMp) {
        addLog("Received a Crimson Vial and Azure Vial.", "loot");
      } else {
        addFloat(p.x, p.y - 0.35, "Inventory is full!", "#f87171");
        addLog("Inventory is full! Provisions that couldn't fit were placed on the ground.", "info");
      }
      break;
    }
    case "buy_scroll":
      p.baseAtk += 2;
      sfx.levelUp();
      addLog("Lyra hands you a Scroll of Valor (+2 ATK).", "loot");
      break;
    case "reveal_floor":
      revealEntireFloor(state.level);
      grantXP(15);
      addLog("Lyra shares her map of the floor (+15 XP).", "story");
      break;
    case "buy_atk":
      p.baseAtk += 3;
      sfx.levelUp();
      addLog("Unit-09 sharpens your blade with foundry plasma (+3 ATK).", "loot");
      break;
    case "reveal_and_mp":
      revealEntireFloor(state.level);
      sfx.loot();
      if (giveOrDropItem(ITEMS.mana_potion, p.x, p.y, { requireLeave: true })) {
        addLog("Downloaded floor schematic and received an Azure Vial.", "loot");
      } else {
        addFloat(p.x, p.y - 0.35, "Inventory is full!", "#f87171");
        addLog("Downloaded floor schematic; inventory is full so the Azure Vial was left on the ground.", "info");
      }
      break;
    case "buy_aegis":
      sfx.loot();
      if (giveOrDropItem(ITEMS.aegis_shield, p.x, p.y, { requireLeave: true })) {
        addLog("Purchased the Gilded Aegis! Equip it from your satchel.", "loot");
      } else {
        addFloat(p.x, p.y - 0.35, "Inventory is full!", "#f87171");
        addLog("Purchased the Gilded Aegis, but inventory is full! Left on the ground.", "info");
      }
      break;
    case "small_heal":
      p.hp = Math.min(stats.maxHp, p.hp + 18);
      p.mp = Math.min(stats.maxMp, p.mp + 10);
      sfx.heal();
      addLog("You share a warm draught (+18 HP, +10 MP).", "heal");
      break;
    case "upgrade_inventory": {
      p.maxInventory = getMaxInventory(p) + 1;
      sfx.levelUp();
      addFloat(p.x, p.y - 0.25, `+1 Max Inventory (${p.maxInventory})`, "#fde047");
      spawnBurst(p.x, p.y, "#fde047", 14);
      const speaker = NPC_ENCOUNTERS[npc.id]?.speaker || "Traveler";
      addLog(`${speaker} reinforced your satchel! Max inventory increased to ${p.maxInventory}.`, "loot");
      break;
    }
  }
  npc.talked = true;
  state.level.npcs = state.level.npcs.filter((n) => n !== npc);
  uiDirty = true;
}

function stunPlayer(duration, sourceName = "Boss", color = "#facc15") {
  if (!state || state.runEnded || state.dyingTimer > 0) return;
  const p = state.player;
  p.stunTimer = Math.max(p.stunTimer || 0, duration);
  p.ultCharge = null;
  p.rapidSlash = null;
  p.valiantCharge = null;
  p.radiantCharge = null;
  p.vx = 0;
  p.vy = 0;
  addFloat(p.x, p.y - 0.5, "STUNNED!", color);
  spawnBurst(p.x, p.y, color, 10, 0.9);
  addLog(`${sourceName} stunned you for ${duration.toFixed(1)}s!`, "combat");
}

function hurtPlayer(rawDmg, sourceName, knockX = 0, knockY = 0, options = {}) {
  const p = state.player;
  if (p.iFrames > 0 || state.runEnded || state.dyingTimer > 0) return;

  const stats = getPlayerStats();
  const flatBlock = Math.floor(stats.def * 0.35);
  const pctMult = 100 / (100 + stats.def * 2.2);
  const dmg = Math.max(1, Math.round(Math.max(1, rawDmg - flatBlock) * pctMult));
  const blocked = Math.max(0, rawDmg - dmg);
  p.hp = Math.max(0, p.hp - dmg);
  p.iFrames = 0.45;
  p.anim = "hurt";
  p.animTimer = 0.25;
  p.kbX += knockX;
  p.kbY += knockY;
  state.shake = Math.max(state.shake, 5);

  sfx.hit();
  addFloat(p.x, p.y, `-${dmg}`, "#ef4444");
  spawnBurst(p.x, p.y, "#ef4444", 10);
  addLog(`${sourceName} hits you for ${dmg} damage${blocked > 0 ? ` (${blocked} blocked)` : ""}.`, "combat");
  if (!options.isReflect && p.retributionTimer > 0) {
    const reflectDmg = Math.max(1, Math.round(rawDmg * (p.retributionReflect || 0.45)));
    for (const e of [...state.level.enemies]) {
      if (Math.hypot(e.x - p.x, e.y - p.y) <= (p.retributionRadius || 2.1) + 0.4) {
        damageEnemy(e, reflectDmg, false, "Seal of Retribution", 0, 0, { isReflect: true });
      }
    }
  }
  uiDirty = true;

  if (p.hp <= 0) {
    p.hp = 0;
    p.anim = "death";
    p.animTimer = 1.0;
    state.dyingTimer = 0.9;
    spawnBurst(p.x, p.y, "#f87171", 20, 1.2);
  }
}

function endRun(victory) {
  state.runEnded = true;
  clearSavedRun();
  const shardsEarned = Math.max(1, Math.floor(state.floor / 2) + (victory ? 5 : 0));
  meta.soulShards += shardsEarned;
  saveMeta(meta);

  const heroName = state.player.name || "Sir Aldric";
  const secs = Math.floor(state.elapsed);
  const mins = Math.floor(secs / 60);
  const rem = String(secs % 60).padStart(2, "0");

  const dlg = document.getElementById("end-dialog");
  document.getElementById("end-dialog-title").textContent = victory
    ? "Victory! The Crown Reforged"
    : "You Have Fallen";
  document.getElementById("end-dialog-summary").textContent = victory
    ? `Malakor's obsidian staff shatters! ${heroName} returns to Oakhaven Bastion bearing all three Crown Shards.`
    : `${heroName} fell on Floor ${state.floor}. Your Soul Shards return to Oakhaven Sanctum to strengthen the next descent.`;

  document.getElementById("end-stats").innerHTML = `
    <div class="stat-pill"><span>Floor Reached</span><strong>${state.floor} / 12</strong></div>
    <div class="stat-pill"><span>Enemies Slain</span><strong>${state.kills}</strong></div>
    <div class="stat-pill"><span>Time Survived</span><strong>${mins}:${rem}</strong></div>
    <div class="stat-pill"><span>Soul Shards</span><strong>+${shardsEarned}</strong></div>
  `;

  updateUI();
  dlg.showModal();
}

function buildSpellButtons() {
  const activeSpells = getActiveSpells(state?.player);
  const spellBar = document.getElementById("spell-bar");
  spellBar.innerHTML = "";
  for (const sp of activeSpells) {
    const wrap = document.createElement("div");
    wrap.className = `spell-slot-wrap${sp.isUltimate ? " ult" : ""}`;
    wrap.dataset.spellId = sp.id;

    const mainRow = document.createElement("div");
    mainRow.className = "spell-slot-main";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "spell-btn";
    btn.dataset.spellId = sp.id;
    btn.title = `${sp.desc} (Hotkey: ${sp.hotkey})`;
    btn.innerHTML = `
      <div class="spell-cd-overlay" style="transform: scaleY(0)"></div>
      <img src="${sp.icon}" alt="" />
      <div class="spell-meta">
        <strong>[${sp.hotkey}] ${sp.name}</strong>
        <span>${sp.mpCost} MP</span>
      </div>
    `;
    btn.addEventListener("click", () => castSpell(sp.id));

    const plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.className = "spell-plus-btn";
    plusBtn.textContent = "+";
    plusBtn.title = "Unlock / Upgrade Skill (1 Skill Pt)";
    plusBtn.hidden = true;
    plusBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      upgradeSkillById(sp.id);
    });

    mainRow.appendChild(btn);
    mainRow.appendChild(plusBtn);

    const pipsEl = document.createElement("div");
    pipsEl.className = "spell-pips";
    pipsEl.setAttribute("aria-label", `${sp.name} level indicator`);
    for (let r = 0; r < sp.maxRank; r++) {
      const pip = document.createElement("span");
      pip.className = "spell-pip";
      pipsEl.appendChild(pip);
    }

    wrap.appendChild(mainRow);
    wrap.appendChild(pipsEl);
    spellBar.appendChild(wrap);
  }

  // Sync mobile arc skill buttons
  activeSpells.forEach((sp, idx) => {
    const tBtn = document.getElementById(`touch-skill-${idx + 1}`);
    if (!tBtn) return;
    tBtn.dataset.spellId = sp.id;
    const pipsHtml = Array.from({ length: sp.maxRank }, () => `<span class="ts-pip"></span>`).join("");
    tBtn.innerHTML = `<span class="ts-plus" hidden>+</span><img src="${sp.icon}" alt="${sp.name}" /><span class="ts-cd" hidden></span><div class="ts-pips">${pipsHtml}</div>`;
    const plusEl = tBtn.querySelector(".ts-plus");
    if (plusEl) {
      plusEl.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        upgradeSkillById(sp.id);
      });
    }
  });
}

function updateCooldownUI() {
  if (!state) return;
  const p = state.player;
  for (const wrap of document.querySelectorAll(".spell-slot-wrap")) {
    const btn = wrap.querySelector(".spell-btn");
    const sp = SPELLS.find((s) => s.id === wrap.dataset.spellId);
    if (!sp || !btn) continue;
    const rank = p.skillRanks[sp.id] || 0;
    const locked = rank <= 0;
    const maxed = rank >= sp.maxRank;
    const reqHeroLv = !maxed && sp.reqLevels ? sp.reqLevels[rank] : null;
    const canUpgrade = !maxed && (p.skillPoints || 0) > 0 && (reqHeroLv === null || p.level >= reqHeroLv);
    const cd = state.spellCooldowns[sp.id] || 0;
    const maxCd = locked ? 1 : sp.cooldowns[Math.min(rank - 1, sp.cooldowns.length - 1)];
    const ratio = locked ? 0 : Math.min(1, cd / maxCd);
    const overlay = btn.querySelector(".spell-cd-overlay");
    if (overlay) overlay.style.transform = `scaleY(${ratio})`;
    const costLabel = btn.querySelector(".spell-meta span");
    const outOfMana = !locked && p.mp < sp.mpCost;
    if (costLabel) {
      costLabel.textContent = locked
        ? canUpgrade
          ? "Ready to Unlock"
          : reqHeroLv !== null && p.level < reqHeroLv
            ? `Locked (Lv ${reqHeroLv})`
            : "Locked (Lv Up)"
        : outOfMana && cd <= 0
          ? "Out of Mana"
          : `Lv${rank}/${sp.maxRank} · ${sp.mpCost} MP`;
    }
    btn.classList.toggle("locked", locked);
    btn.classList.toggle("out-of-mana", outOfMana && cd <= 0);
    btn.disabled = locked || outOfMana || cd > 0 || Boolean(p.leap || p.ultCharge) || state.runEnded || state.dyingTimer > 0;

    const plusBtn = wrap.querySelector(".spell-plus-btn");
    if (plusBtn) {
      plusBtn.hidden = !canUpgrade;
      if (canUpgrade) {
        plusBtn.title = rank === 0 ? `Unlock ${sp.name} (1 Skill Pt)` : `Level up ${sp.name} to Lv ${rank + 1} (1 Skill Pt)`;
      }
    }

    const pipsEl = wrap.querySelector(".spell-pips");
    if (pipsEl) {
      pipsEl.title = `${sp.name}: Lv ${rank} / ${sp.maxRank}`;
      const pips = pipsEl.querySelectorAll(".spell-pip");
      pips.forEach((pip, idx) => pip.classList.toggle("filled", idx < rank));
    }
  }

  for (const tBtn of document.querySelectorAll(".touch-skill-btn")) {
    const sp = SPELLS.find((s) => s.id === tBtn.dataset.spellId);
    if (!sp) continue;
    const rank = p.skillRanks[sp.id] || 0;
    const locked = rank <= 0;
    const cd = state.spellCooldowns[sp.id] || 0;
    const outOfMana = !locked && p.mp < sp.mpCost;
    const maxed = rank >= sp.maxRank;
    const reqHeroLv = !maxed && sp.reqLevels ? sp.reqLevels[rank] : null;
    const canUpgrade = !maxed && (p.skillPoints || 0) > 0 && (reqHeroLv === null || p.level >= reqHeroLv);

    tBtn.classList.toggle("locked", locked);
    tBtn.classList.toggle("on-cooldown", !locked && cd > 0);
    tBtn.classList.toggle("out-of-mana", outOfMana && cd <= 0);
    tBtn.disabled = locked || outOfMana || cd > 0 || Boolean(p.leap || p.ultCharge) || state.runEnded || state.dyingTimer > 0;
    const cdEl = tBtn.querySelector(".ts-cd");
    if (cdEl) {
      if (!locked && cd > 0) {
        cdEl.hidden = false;
        cdEl.classList.remove("oom");
        cdEl.textContent = String(Math.ceil(cd));
      } else if (outOfMana) {
        cdEl.hidden = false;
        cdEl.classList.add("oom");
        cdEl.textContent = "OUT OF MANA";
      } else {
        cdEl.hidden = true;
        cdEl.classList.remove("oom");
      }
    }
    const plusEl = tBtn.querySelector(".ts-plus");
    if (plusEl) {
      plusEl.hidden = !canUpgrade;
    }
    const pips = tBtn.querySelectorAll(".ts-pip");
    pips.forEach((pip, idx) => pip.classList.toggle("filled", idx < rank));
  }

  const dashBtn = document.getElementById("btn-dash");
  if (dashBtn) {
    dashBtn.disabled = p.dashCd > 0 || p.mp < 10;
    dashBtn.classList.toggle("on-cooldown", p.dashCd > 0 || p.mp < 10);
    dashBtn.textContent = p.dashCd > 0 ? `Dash (${p.dashCd.toFixed(1)}s)` : "Dash (10 MP)";
  }
  const tDash = document.getElementById("touch-btn-dash");
  const tDashCd = document.getElementById("touch-dash-cd");
  if (tDash && tDashCd) {
    tDash.disabled = p.dashCd > 0 || p.mp < 10;
    tDash.classList.toggle("on-cooldown", p.dashCd > 0 || p.mp < 10);
    if (p.dashCd > 0) {
      tDashCd.hidden = false;
      tDashCd.textContent = String(Math.ceil(p.dashCd));
    } else {
      tDashCd.hidden = true;
    }
  }
  const skillBtn = document.getElementById("btn-skills");
  const ptsEl = document.getElementById("skill-points-count");
  const mSkillBtn = document.getElementById("mhud-btn-skills");
  const mPtsEl = document.getElementById("mhud-skill-pts");
  const pts = p.skillPoints || 0;
  if (skillBtn && ptsEl) {
    ptsEl.textContent = pts;
    skillBtn.classList.toggle("has-points", pts > 0);
  }
  if (mSkillBtn && mPtsEl) {
    mPtsEl.textContent = pts;
    mSkillBtn.classList.toggle("has-points", pts > 0);
  }
}

function updateUI() {
  if (!state) return;
  uiDirty = false;
  const p = state.player;
  const stats = getPlayerStats();
  p.hp = Math.min(p.hp, stats.maxHp);
  p.mp = Math.min(p.mp, stats.maxMp);

  document.getElementById("hero-name").textContent = p.name || "Sir Aldric";
  document.getElementById("act-subtitle").textContent = `Floor ${state.floor} — ${state.level.act.name}`;
  document.getElementById("mhud-name").textContent = p.name || "Sir Aldric";
  document.getElementById("mhud-level").textContent = p.level;
  document.getElementById("mhud-hp").textContent = `${Math.ceil(p.hp)}/${stats.maxHp}`;
  document.getElementById("mhud-mp").textContent = `${Math.floor(p.mp)}/${stats.maxMp}`;
  document.getElementById("mhud-xp").textContent = `${p.xp}/${p.xpNext}`;
  document.getElementById("mhud-bar-hp").style.width = `${(p.hp / stats.maxHp) * 100}%`;
  document.getElementById("mhud-bar-mp").style.width = `${(p.mp / stats.maxMp) * 100}%`;
  document.getElementById("mhud-bar-xp").style.width = `${(p.xp / p.xpNext) * 100}%`;
  document.getElementById("soul-shards-count").textContent = meta.soulShards;
  document.getElementById("stat-level").textContent = p.level;
  document.getElementById("stat-hp").textContent = `${Math.ceil(p.hp)} / ${stats.maxHp}`;
  document.getElementById("stat-mp").textContent = `${Math.floor(p.mp)} / ${stats.maxMp}`;
  document.getElementById("stat-xp").textContent = `${p.xp} / ${p.xpNext}`;
  document.getElementById("bar-hp").style.width = `${(p.hp / stats.maxHp) * 100}%`;
  document.getElementById("bar-mp").style.width = `${(p.mp / stats.maxMp) * 100}%`;
  document.getElementById("bar-xp").style.width = `${(p.xp / p.xpNext) * 100}%`;

  document.getElementById("stat-atk").textContent = stats.atk;
  document.getElementById("stat-def").textContent = stats.def;
  document.getElementById("stat-crit").textContent = `${stats.crit}%`;
  document.getElementById("stat-gold").textContent = p.gold;

  const count = state.shardsCollected.filter(Boolean).length;
  document.getElementById("shards-collected").textContent = count;
  [1, 2, 3].forEach((n, i) => {
    document.getElementById(`crown-shard-${n}`).classList.toggle("collected", state.shardsCollected[i]);
  });

  const eqEl = document.getElementById("equipment-slots");
  eqEl.innerHTML = "";
  const slotOrder = ["weapon", "subweapon", "armor", "helmet", "boots", "ring"];
  for (const slot of slotOrder) {
    const item = p.equipment?.[slot] || null;
    const row = document.createElement("div");
    row.className = "equip-slot";
    const slotLabel = slot === "subweapon" ? "Sub-Weapon" : slot;
    row.innerHTML = `<span class="slot-name">${slotLabel}</span>`;
    if (item) {
      const rInfo = getRarityInfo(item);
      row.style.borderLeft = `3px solid ${rInfo.color}`;
      row.innerHTML += `<img src="${item.icon}" class="pixel-icon" alt="" /><span style="color:${rInfo.color}">${item.name}</span>`;
      row.title = `[${rInfo.label}] ${item.desc}`;
    } else {
      row.innerHTML += `<span style="color:var(--muted)">Empty</span>`;
    }
    eqEl.appendChild(row);
  }
  const setData = getActiveSetBonuses(p);
  const activeSets = setData.activeLabels;
  if (activeSets.length > 0) {
    const setSummary = document.createElement("div");
    setSummary.className = "equip-set-bonuses";
    for (const s of activeSets) {
      const tag = document.createElement("div");
      tag.className = "equip-set-tag";
      tag.style.borderColor = s.color;
      tag.innerHTML = `<strong style="color:${s.color}">${s.name} (${s.count})</strong><span>${s.label}</span>`;
      setSummary.appendChild(tag);
    }

    const t = setData.totals;
    const totalParts = [];
    if (t.atk) totalParts.push(`+${t.atk} ATK`);
    if (t.def) totalParts.push(`+${t.def} DEF`);
    if (t.crit) totalParts.push(`+${t.crit}% CRIT`);
    if (t.maxHp) totalParts.push(`+${t.maxHp} Max HP`);
    if (t.maxMp) totalParts.push(`+${t.maxMp} Max MP`);
    if (t.speed) totalParts.push(`+${t.speed.toFixed(2)} Speed`);
    if (totalParts.length > 0) {
      const totalBox = document.createElement("div");
      totalBox.className = "equip-set-total";
      totalBox.innerHTML = `<strong>Total Set Bonus</strong><span>${totalParts.join(" · ")}</span>`;
      setSummary.appendChild(totalBox);
    }

    eqEl.appendChild(setSummary);
  }

  const hpCount = p.inventory.find((i) => i.id === "health_potion")?.qty || 0;
  const mpCount = p.inventory.find((i) => i.id === "mana_potion")?.qty || 0;
  document.getElementById("quick-hp-count").textContent = hpCount;
  document.getElementById("quick-mp-count").textContent = mpCount;

  const maxInv = getMaxInventory(p);
  document.getElementById("inv-count").textContent = p.inventory.length;
  const invMaxEl = document.getElementById("inv-max");
  if (invMaxEl) invMaxEl.textContent = maxInv;
  const invGrid = document.getElementById("inventory-grid");
  invGrid.innerHTML = "";
  for (let i = 0; i < maxInv; i++) {
    const item = p.inventory[i];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `inv-slot ${item ? "" : "empty"}`;
    if (item) {
      const rInfo = getRarityInfo(item);
      btn.style.borderColor = rInfo.color;
      btn.style.background = rInfo.bg;
      btn.title = `[${rInfo.label}] ${item.name} — ${item.desc}`;
      btn.innerHTML = `<span class="inv-rarity-dot" style="background:${rInfo.color}"></span><img src="${item.icon}" alt="${item.name}" />${
        item.qty > 1 ? `<span class="inv-qty">${item.qty}</span>` : ""
      }`;
      btn.addEventListener("click", () => openItemActionDialog(i));
    } else {
      btn.disabled = true;
    }
    invGrid.appendChild(btn);
  }

  renderShortcuts();
}

function renderShortcuts() {
  if (!state) return;
  const p = state.player;
  const slots = p.shortcuts || [null, null, null, null];
  for (const containerId of ["mobile-shortcuts", "drawer-shortcuts"]) {
    const container = document.getElementById(containerId);
    if (!container) continue;
    container.innerHTML = "";
    for (let s = 0; s < 4; s++) {
      const itemId = slots[s];
      const item = itemId ? p.inventory.find((i) => i.id === itemId) : null;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "shortcut-slot";
      btn.title = item ? `${item.name} (Shortcut ${s + 1})` : `Empty Shortcut ${s + 1}`;
      if (item) {
        btn.innerHTML = `<img src="${item.icon}" alt="${item.name}" />${
          item.qty > 1 ? `<span class="inv-qty">${item.qty}</span>` : ""
        }`;
      } else {
        btn.textContent = String(s + 1);
      }
      btn.addEventListener("click", () => useShortcut(s));
      container.appendChild(btn);
    }
  }
}

function clampPointInBossRoom(x, y, bossRoom, fallbackX, fallbackY) {
  let tx = x;
  let ty = y;
  if (bossRoom) {
    tx = Math.max(bossRoom.x + 0.55, Math.min(bossRoom.x + bossRoom.w - 0.55, tx));
    ty = Math.max(bossRoom.y + 0.55, Math.min(bossRoom.y + bossRoom.h - 0.55, ty));
  }
  if (canOccupy(tx, ty, 0.38)) return { x: tx, y: ty };
  return { x: fallbackX, y: fallbackY };
}

function findBossTeleportSpot(boss, p, bossRoom) {
  const behindAng = (p.aimAngle || 0) + Math.PI;
  const offsets = [0, 0.7, -0.7, 1.4, -1.4, 2.1, -2.1, Math.PI];
  for (const distTry of [1.55, 1.9, 1.2]) {
    for (const off of offsets) {
      const a = behindAng + off;
      const tx = p.x + Math.cos(a) * distTry;
      const ty = p.y + Math.sin(a) * distTry;
      if (bossRoom && (tx < bossRoom.x + 0.55 || tx > bossRoom.x + bossRoom.w - 0.55 || ty < bossRoom.y + 0.55 || ty > bossRoom.y + bossRoom.h - 0.55)) {
        continue;
      }
      if (canOccupy(tx, ty, 0.38)) return { x: tx, y: ty };
    }
  }
  if (bossRoom && canOccupy(bossRoom.cx + 0.5, bossRoom.cy + 0.5, 0.38)) {
    return { x: bossRoom.cx + 0.5, y: bossRoom.cy + 0.5 };
  }
  return { x: boss.x, y: boss.y };
}

function tryTriggerBossDodge(boss, threatX, threatY, bossRoom) {
  if (!boss?.isBoss || (boss.dodgeCd || 0) > 0 || boss.bossAction || boss.bossDodge) return false;
  if ((boss.stunTimer || 0) > 0 || (boss.frozenTimer || 0) > 0) return false;

  const baseAng = Math.atan2(boss.y - threatY, boss.x - threatX);
  const candidates = [baseAng + Math.PI / 2, baseAng - Math.PI / 2, baseAng + Math.PI * 0.35, baseAng - Math.PI * 0.35, baseAng];
  const sidestepSign = Math.random() < 0.5 ? 1 : -1;
  const ordered = [
    baseAng + (Math.PI / 2) * sidestepSign,
    baseAng - (Math.PI / 2) * sidestepSign,
    baseAng + 0.55 * sidestepSign,
    baseAng - 0.55 * sidestepSign,
    baseAng,
  ];

  let bestSpot = null;
  for (const ang of ordered) {
    for (const stepDist of [2.1, 1.55]) {
      const tx = boss.x + Math.cos(ang) * stepDist;
      const ty = boss.y + Math.sin(ang) * stepDist;
      if (bossRoom && (tx < bossRoom.x + 0.55 || tx > bossRoom.x + bossRoom.w - 0.55 || ty < bossRoom.y + 0.55 || ty > bossRoom.y + bossRoom.h - 0.55)) {
        continue;
      }
      if (canOccupy(tx, ty, 0.38)) {
        bestSpot = { x: tx, y: ty };
        break;
      }
    }
    if (bestSpot) break;
  }
  if (!bestSpot) return false;

  const dashColor = boss.id === "void_king" ? "#c084fc" : boss.id === "gilded_knight" ? "#fde047" : "#38bdf8";
  boss.bossDodge = {
    startX: boss.x,
    startY: boss.y,
    tx: bestSpot.x,
    ty: bestSpot.y,
    timer: 0.16,
    duration: 0.16,
    color: dashColor,
  };
  boss.evadeTimer = 0.2;
  boss.dodgeCd = boss.enraged ? 3.8 : 5.2;
  boss.windupTimer = 0;
  sfx.dash();
  spawnBurst(boss.x, boss.y, dashColor, 10, 1.0);
  spawnRing(boss.x, boss.y, 26, dashColor, 0.22);
  addFloat(boss.x, boss.y - 0.45, "DODGE!", dashColor);
  return true;
}

function startBossMatch(boss, lockDoorNow = true) {
  if (state.bossFightStarted) return;
  state.bossFightStarted = true;
  state.bossIntroTimer = 2.1;
  boss.z = 115;
  boss.falling = true;
  revealBossRoom(state.level, true);
  checkBossSpotted();

  if (lockDoorNow) {
    for (const pr of state.level.props) {
      if (pr.kind === "door" && pr.isBossDoor) {
        pr.opened = false;
        pr.solid = true;
        pr.locked = true;
      }
    }
  }

  const introEl = document.getElementById("boss-intro-overlay");
  const introName = document.getElementById("boss-intro-name");
  const introAct = document.getElementById("boss-intro-act");
  const introSkills = document.getElementById("boss-intro-skills");
  const introCanvas = document.getElementById("boss-intro-canvas");
  if (introName) introName.textContent = boss.name;
  if (introAct) introAct.textContent = `${state.level.act.name} — Boss`;
  if (introSkills) introSkills.textContent = boss.bossSkillDesc || `${boss.maxHp} HP`;
  if (introCanvas) {
    const bCtx = introCanvas.getContext("2d");
    bCtx.clearRect(0, 0, 96, 96);
    bCtx.imageSmoothingEnabled = false;
    if (boss.isSheet) {
      drawSheetFrame(bCtx, assets[boss.sprite], 0, 8, 8, 80, 80);
    } else if (assets[boss.sprite]) {
      bCtx.drawImage(assets[boss.sprite], 8, 8, 80, 80);
    }
  }
  if (introEl) introEl.hidden = false;
  sfx.stairs();
  addLog(`BOSS MATCH: ${boss.name} enters the arena!`, "story");
}

function updateRoomAndBossHUD() {
  if (!state) return;
  const nonBossLeft = state.level.enemies.filter((e) => !e.isBoss && !e.isClone).length;
  const boss = state.level.enemies.find((e) => e.isBoss);

  const badge = document.getElementById("room-enemy-badge");
  if (badge) {
    if (state.level.isBossFloor) {
      if (boss && state.bossFightStarted) {
        badge.textContent = "BOSS FIGHT!";
        badge.className = "room-enemy-badge has-enemies";
      } else if (nonBossLeft > 0) {
        badge.textContent = `Boss Floor · Enemies Left: ${nonBossLeft}`;
        badge.className = "room-enemy-badge has-enemies";
      } else if (!state.hasBossKey) {
        badge.textContent = "Boss Floor · Pick Up Boss Key!";
        badge.className = "room-enemy-badge has-enemies";
      } else {
        badge.textContent = "Boss Floor · Enter Boss Room!";
        badge.className = "room-enemy-badge clear";
      }
    } else if (nonBossLeft > 0) {
      badge.textContent = `Floor Enemies Left: ${nonBossLeft}`;
      badge.className = "room-enemy-badge has-enemies";
    } else {
      badge.textContent = "Floor Clear!";
      badge.className = "room-enemy-badge clear";
    }
  }

  const bossBar = document.getElementById("boss-hud-bar");
  if (bossBar) {
    if (boss && state.bossFightStarted) {
      bossBar.hidden = false;
      document.getElementById("boss-hud-name").textContent = boss.name;
      document.getElementById("boss-hud-hp-text").textContent = `${Math.max(0, Math.ceil(boss.hp))} / ${boss.maxHp}`;
      document.getElementById("boss-hud-fill").style.width = `${Math.max(0, (boss.hp / boss.maxHp) * 100)}%`;
    } else {
      bossBar.hidden = true;
    }
  }

  // Dynamic background music track selection
  const menuOpen = !document.getElementById("main-menu").hidden || document.getElementById("title-dialog").open;
  if (menuOpen) {
    bgm.play("town");
  } else if (boss && state.bossFightStarted) {
    bgm.play("boss");
  } else if (nonBossLeft > 0) {
    bgm.play("battle");
  } else {
    bgm.play("explore");
  }
}

function updateSimulation(dt) {
  if (!state || state.runEnded) return;

  // Hitstop freeze frame for juicy impacts
  if (state.hitstop > 0) {
    state.hitstop = Math.max(0, state.hitstop - dt);
    return;
  }

  state.elapsed += dt;
  state.shake = Math.max(0, state.shake - dt * 18);
  state.npcCooldown = Math.max(0, state.npcCooldown - dt);
  state.shopCooldown = Math.max(0, (state.shopCooldown || 0) - dt);
  state.stairsCooldown = Math.max(0, (state.stairsCooldown || 0) - dt);
  state.doorMsgCd = Math.max(0, (state.doorMsgCd || 0) - dt);
  state.saveTimer = (state.saveTimer || 0) + dt;
  if (state.saveTimer >= 5.0) {
    state.saveTimer = 0;
    saveRun();
  }

  updateRoomAndBossHUD();

  // Camera reveal pan to Boss Chamber when last floor enemy falls
  if (state.camReveal) {
    state.camReveal.timer -= dt;
    if (state.camReveal.timer <= 0) {
      state.camReveal = null;
    }
    return;
  }

  // Boss Intro Pause (shows boss image & name before boss drops in)
  if (state.bossIntroTimer > 0) {
    state.bossIntroTimer -= dt;
    if (state.bossIntroTimer <= 0) {
      const introEl = document.getElementById("boss-intro-overlay");
      if (introEl) introEl.hidden = true;
    }
    return;
  }

  const p = state.player;
  const stats = getPlayerStats();

  // Death sequence animation
  if (state.dyingTimer > 0) {
    state.dyingTimer -= dt;
    if (state.dyingTimer <= 0) {
      endRun(false);
    }
    return;
  }

  // Cooldowns & MP regeneration
  p.attackCd = Math.max(0, p.attackCd - dt);
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.iFrames = Math.max(0, p.iFrames - dt);
  p.stunTimer = Math.max(0, (p.stunTimer || 0) - dt);
  if (p.tempDefTimer > 0) {
    p.tempDefTimer = Math.max(0, p.tempDefTimer - dt);
    if (p.tempDefTimer <= 0) {
      p.tempDef = 0;
      uiDirty = true;
    }
  }
  if (p.tempAtkTimer > 0) {
    p.tempAtkTimer = Math.max(0, p.tempAtkTimer - dt);
    if (p.tempAtkTimer <= 0) {
      p.tempAtk = 0;
      uiDirty = true;
    }
  }
  if (p.hasteTimer > 0) {
    p.hasteTimer = Math.max(0, p.hasteTimer - dt);
  }
  if (p.aegisBlast) {
    p.aegisBlast.timer -= dt;
    if (p.aegisBlast.timer <= 0) {
      const ab = p.aegisBlast;
      p.aegisBlast = null;
      sfx.nova();
      state.shake = Math.max(state.shake, 7);
      spawnBurst(p.x, p.y, "#38bdf8", 22, 1.35);
      spawnRing(p.x, p.y, ab.radius * TILE_SIZE, "#facc15", 0.38);
      for (const e of [...state.level.enemies]) {
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= ab.radius + 0.35) {
          e.stunTimer = Math.max(e.stunTimer || 0, ab.stun);
          e.windupTimer = 0;
          const nx = dist > 0.01 ? dx / dist : 0;
          const ny = dist > 0.01 ? dy / dist : 0;
          damageEnemy(e, Math.round(stats.atk * 0.9), false, ab.spell.name, nx * 5.8, ny * 5.8);
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
      for (const e of [...state.level.enemies]) {
        if (Math.hypot(e.x - p.x, e.y - p.y) <= rad + 0.3) {
          damageEnemy(e, p.retributionBurn || 5, false, "Seal of Retribution", 0, 0);
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
      const weapon = p.equipment?.weapon;
      const wCat = getWeaponCategory(weapon);

      if (wCat === "bow" || wCat === "wand") {
        const isBow = wCat === "bow";
        const spreadOff = rs.remaining === 3 ? -0.09 : rs.remaining === 2 ? 0 : 0.09;
        const shotAng = rs.angle + spreadOff;
        const speed = weapon?.projSpeed || (isBow ? 13.5 : 11.8);
        const color = weapon?.projColor || (isBow ? "#fde047" : sp.color);
        if (isBow) sfx.arrow();
        else sfx.magicOrb();
        p.anim = isBow && p.heroClass === "soldier" ? "bow" : "attack";
        p.animTimer = 0.14;
        state.projectiles.push({
          x: p.x + Math.cos(shotAng) * 0.42,
          y: p.y + Math.sin(shotAng) * 0.42,
          vx: Math.cos(shotAng) * speed,
          vy: Math.sin(shotAng) * speed,
          radius: isBow ? 0.22 : 0.25,
          color,
          dmg,
          isEnemy: false,
          isArrow: isBow,
          isMagicOrb: !isBow,
          fireTrail: weapon?.projectileKind === "fire_arrow",
          chill: weapon?.chill || 0,
          life: 0.9,
          label: sp.name,
        });
        spawnBurst(p.x + Math.cos(shotAng) * 0.4, p.y + Math.sin(shotAng) * 0.4, color, 4, 0.55);
      } else {
        const ang = rs.angle + (rs.remaining % 2 === 0 ? -0.22 : 0.22);
        sfx.slash();
        p.anim = "attack";
        p.animTimer = 0.14;
        state.slashes.push({
          x: p.x * TILE_SIZE,
          y: p.y * TILE_SIZE,
          angle: ang,
          color: sp.color,
          life: 0.15,
          maxLife: 0.15,
        });
        const dirX = Math.cos(rs.angle);
        const dirY = Math.sin(rs.angle);
        for (const e of [...state.level.enemies]) {
          const dx = e.x - p.x;
          const dy = e.y - p.y;
          const dist = Math.hypot(dx, dy);
          if (dist <= sp.range) {
            const dot = dist < 0.01 ? 1 : (dx / dist) * dirX + (dy / dist) * dirY;
            if (dot >= 0.1 || dist < 0.85) {
              damageEnemy(e, dmg, false, sp.name, dirX * 1.4, dirY * 1.4);
            }
          }
        }
      }
      rs.remaining -= 1;
      rs.timer = rs.interval;
      if (rs.remaining <= 0) p.rapidSlash = null;
    }
  }
  for (const sp of getActiveSpells(p)) {
    state.spellCooldowns[sp.id] = Math.max(0, state.spellCooldowns[sp.id] - dt);
  }

  state.mpRegenTimer += dt;
  if (state.mpRegenTimer >= 2.4) {
    state.mpRegenTimer -= 2.4;
    if (p.mp < stats.maxMp) {
      p.mp = Math.min(stats.maxMp, p.mp + 1);
      uiDirty = true;
    }
  }

  // Player knockback decay
  if (Math.abs(p.kbX) > 0.05 || Math.abs(p.kbY) > 0.05) {
    moveWithSlide(p, p.kbX * dt, p.kbY * dt, 0.28);
    const decay = Math.exp(-12 * dt);
    p.kbX *= decay;
    p.kbY *= decay;
  }

  // Player movement, Ultimate Charge, Ultimate Leap, or Dash
  if (p.ultCharge) {
    p.ultCharge.timer -= dt;
    p.anim = "attack";
    p.animTimer = 0.2;
    if (Math.random() < 0.55) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 10 + Math.random() * 24;
      state.particles.push({
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
      state.shake = 14;
      state.hitstop = 0.055;
      sfx.ultSlam();

      const radius = spell.radii[rankIdx];
      const dmg = Math.round(stats.atk * spell.mults[rankIdx]) + spell.flats[rankIdx];
      const stunDur = spell.stuns[rankIdx];
      spawnBurst(p.x, p.y, "#fbbf24", 30, 1.55);
      spawnBurst(p.x, p.y, "#ffffff", 16, 1.25);
      spawnRing(p.x, p.y, radius * TILE_SIZE, "#fbbf24", 0.45);
      spawnRing(p.x, p.y, radius * TILE_SIZE * 0.6, "#ffffff", 0.3);
      state.beams.push({
        x: p.x * TILE_SIZE,
        y: p.y * TILE_SIZE,
        color: "#fde047",
        life: 0.36,
        maxLife: 0.36,
      });

      let hitCount = 0;
      for (const e of [...state.level.enemies]) {
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= radius + 0.35) {
          hitCount += 1;
          e.stunTimer = Math.max(e.stunTimer || 0, stunDur);
          e.windupTimer = 0;
          const nx = dist > 0.01 ? dx / dist : 0;
          const ny = dist > 0.01 ? dy / dist : 0;
          damageEnemy(e, dmg, true, spell.name, nx * 4.5, ny * 4.5);
          addFloat(e.x, e.y - 0.45, "STUNNED!", "#fde047");
        }
      }
      if (hitCount > 0) {
        addLog(`${spell.name} stunned ${hitCount} ${hitCount === 1 ? "enemy" : "enemies"} for ${stunDur.toFixed(1)}s!`, "story");
      }
    }
  } else if (p.radiantCharge) {
    const rc = p.radiantCharge;
    rc.timer -= dt;
    p.anim = "attack";
    p.animTimer = 0.18;
    if (mouse.inside && mouse.x !== null) {
      rc.angle = Math.atan2(mouse.y - p.y, mouse.x - p.x);
      p.aimAngle = rc.angle;
      p.facingLeft = Math.cos(rc.angle) < 0;
    }
    if (Math.random() < 0.7) {
      const ang = rc.angle + (Math.random() - 0.5) * 1.4;
      const distPx = 18 + Math.random() * 20;
      state.particles.push({
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
      state.shake = Math.max(state.shake, 5.5);
      state.slashes.push({
        x: (p.x + dirX * 0.45) * TILE_SIZE,
        y: (p.y + dirY * 0.45) * TILE_SIZE,
        angle: rc.angle,
        color: rc.spell.color || "#fb923c",
        life: 0.24,
        maxLife: 0.24,
      });
      spawnBurst(p.x + dirX * 0.5, p.y + dirY * 0.5, "#fb923c", 16, 1.2);
      spawnRing(p.x, p.y, 38, "#fde047", 0.28);

      state.projectiles.push({
        x: p.x + dirX * 0.65,
        y: p.y + dirY * 0.65,
        vx: dirX * waveSpeed,
        vy: dirY * waveSpeed,
        dmg: rc.dmg,
        color: rc.spell.color || "#fb923c",
        radius: 0.95,
        life: waveRange / waveSpeed,
        maxLife: waveRange / waveSpeed,
        isEnemy: false,
        isSlashWave: true,
        pierce: true,
        hitIds: new Set(),
        sunderDur: rc.spell.sunderDur || 5.0,
        label: rc.spell.name,
      });
    }
  } else if (p.valiantCharge) {
    const vc = p.valiantCharge;
    vc.timer -= dt;
    if (vc.phase === "windup") {
      p.anim = "attack";
      const prog = Math.min(1, 1 - vc.timer / vc.windupDur);
      const eased = 1 - Math.pow(1 - prog, 2.2);
      const spearDist = 0.55 + (vc.spearDistMax - 0.55) * eased;
      const tipX = vc.startX + vc.dirX * spearDist;
      const tipY = vc.startY + vc.dirY * spearDist;

      // Damage enemies touched along the extending spear thrust & spearhead point
      const thrustDmg = Math.max(1, Math.round(vc.baseDmg * 0.4));
      for (const e of [...state.level.enemies]) {
        if (!vc.piercedIds.has(e.uid) && distPointToSegment(e.x, e.y, vc.startX, vc.startY, tipX, tipY) <= 0.92) {
          vc.piercedIds.add(e.uid);
          damageEnemy(e, thrustDmg, false, `${vc.spell.name} Thrust`, vc.dirX * 1.4, vc.dirY * 1.4);
          spawnBurst(e.x, e.y, "#38bdf8", 10, 1.15);
          spawnRing(e.x, e.y, 26, "#fde047", 0.25);
        }
      }

      if (vc.timer <= 0) {
        vc.phase = "dash";
        vc.timer = vc.dashDur;
        sfx.dash();
        state.shake = Math.max(state.shake, 7);
        spawnBurst(p.x, p.y, "#38bdf8", 14, 1.25);
        spawnRing(p.x, p.y, 34, "#facc15", 0.25);
      }
    } else {
      const prevHeroX = p.x;
      const prevHeroY = p.y;
      const remDist = Math.max(0, vc.travelDist - vc.traveled);
      const stepDist = vc.travelDist > 0.05 ? Math.min(remDist, vc.speed * dt) : 0;
      if (stepDist > 0) {
        moveWithSlide(p, vc.dirX * stepDist, vc.dirY * stepDist, 0.28);
      }
      const stepMoved = Math.hypot(p.x - prevHeroX, p.y - prevHeroY);
      vc.traveled += stepMoved;

      state.afterimages.push({
        x: p.x,
        y: p.y,
        facingLeft: p.facingLeft,
        frame: animFrame,
        life: 0.2,
        maxLife: 0.2,
      });
      if (state.afterimages.length > 10) state.afterimages.shift();
      for (let k = 0; k < 2; k++) {
        state.particles.push({
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
      for (const e of [...state.level.enemies]) {
        if (!vc.hitIds.has(e.uid) && distPointToSegment(e.x, e.y, prevHeroX, prevHeroY, headTipX, headTipY) <= 0.95) {
          vc.hitIds.add(e.uid);
          const prevX = e.x;
          const prevY = e.y;
          moveWithSlide(e, vc.dirX * 1.15, vc.dirY * 1.15, e.isBoss ? 0.38 : 0.28);
          const wallPinned = Math.hypot(e.x - prevX, e.y - prevY) < 0.45;
          const finalDmg = wallPinned ? Math.round(vc.baseDmg * (1 + vc.wallBonus)) : vc.baseDmg;
          damageEnemy(e, finalDmg, wallPinned, vc.spell.name, vc.dirX * 4.0, vc.dirY * 4.0);
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
        state.shake = Math.max(state.shake, 10);
        state.beams.push({
          x: impactX * TILE_SIZE,
          y: impactY * TILE_SIZE,
          color: "#38bdf8",
          life: 0.28,
          maxLife: 0.28,
        });
        state.slashes.push(
          { x: impactX * TILE_SIZE, y: impactY * TILE_SIZE, angle: ang + 0.6, radius: 42, life: 0.18, maxLife: 0.18, color: "#38bdf8" },
          { x: impactX * TILE_SIZE, y: impactY * TILE_SIZE, angle: ang - 0.6, radius: 42, life: 0.18, maxLife: 0.18, color: "#fde047" }
        );
        spawnBurst(impactX, impactY, "#facc15", 20, 1.45);
        spawnBurst(impactX, impactY, "#38bdf8", 14, 1.25);
        spawnRing(impactX, impactY, 1.75 * TILE_SIZE, "#38bdf8", 0.3, { delay: 0, lineWidth: 3 });
        spawnRing(impactX, impactY, 2.05 * TILE_SIZE, "#fde047", 0.38, { delay: 0.06, lineWidth: 2.5 });
        for (const e of [...state.level.enemies]) {
          const dTip = Math.hypot(e.x - impactX, e.y - impactY);
          const dHero = Math.hypot(e.x - p.x, e.y - p.y);
          if (dTip <= 1.75 || dHero <= 1.35) {
            damageEnemy(e, finDmg, false, `${vc.spell.name} Burst`, vc.dirX * 3.5, vc.dirY * 3.5);
          }
        }
        for (const pr of state.level.props) {
          if (
            pr.solid &&
            ["crate", "barrel", "urn"].includes(pr.kind) &&
            (Math.hypot(pr.x + 0.5 - impactX, pr.y + 0.5 - impactY) <= 1.6 || Math.hypot(pr.x + 0.5 - p.x, pr.y + 0.5 - p.y) <= 1.35)
          ) {
            interactProp(pr);
          }
        }
      }
    }
  } else if (p.leap) {
    const { rankIdx, spell } = p.leap;
    p.leap.progress += dt / p.leap.duration;
    const t = Math.min(1, p.leap.progress);
    // Smooth parabolic jump arc (up then smoothly down, never stuck hovering)
    p.z = Math.sin(t * Math.PI) * p.leap.maxHeight;

    // Steer with walk keys/joystick during the 1.25s leap, or glide forward ahead
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
      const glideSpeed = 2.2;
      moveWithSlide(p, p.leap.dirX * glideSpeed * dt, p.leap.dirY * glideSpeed * dt, 0.28);
    }

    if (Math.random() < 0.6) {
      state.particles.push({
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
      state.shake = 18;
      state.hitstop = 0.065;
      sfx.ultSlam();
      sfx.nova();

      const radius = spell.radii[rankIdx];
      const dmg = Math.round(stats.atk * spell.mults[rankIdx]) + spell.flats[rankIdx];
      const radPx = radius * TILE_SIZE;

      // Concentric water-ripple shockwave rings on impact
      spawnRing(p.x, p.y, radPx * 0.88, "#ffffff", 0.36, { delay: 0, lineWidth: 3.5 });
      spawnRing(p.x, p.y, radPx * 1.0, "#fde047", 0.44, { delay: 0.07, lineWidth: 3 });
      spawnRing(p.x, p.y, radPx * 1.12, "#f97316", 0.52, { delay: 0.14, lineWidth: 2.8 });
      spawnRing(p.x, p.y, radPx * 0.72, "#38bdf8", 0.44, { delay: 0.21, lineWidth: 2.4 });
      spawnRing(p.x, p.y, radPx * 1.24, "#fef08a", 0.56, { delay: 0.28, lineWidth: 2 });

      state.beams.push({
        x: p.x * TILE_SIZE,
        y: p.y * TILE_SIZE,
        color: "#fde047",
        life: 0.38,
        maxLife: 0.38,
      });
      spawnBurst(p.x, p.y, "#f97316", 32, 1.7);
      spawnBurst(p.x, p.y, "#fde047", 20, 1.35);

      for (const e of [...state.level.enemies]) {
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= radius + 0.45) {
          const nx = dist > 0.01 ? dx / dist : 0;
          const ny = dist > 0.01 ? dy / dist : 0;
          damageEnemy(e, dmg, true, spell.name, nx * 6.8, ny * 6.8);
        }
      }
      // Smash nearby breakables on slam
      for (const pr of state.level.props) {
        if (pr.solid && ["crate", "barrel", "urn"].includes(pr.kind)) {
          if (Math.hypot(pr.x + 0.5 - p.x, pr.y + 0.5 - p.y) <= radius) {
            interactProp(pr);
          }
        }
      }
    }
  } else if (p.dashTimer > 0) {
    p.dashTimer -= dt;
    const dashSpeed = 13.5;
    moveWithSlide(p, p.dashDirX * dashSpeed * dt, p.dashDirY * dashSpeed * dt, 0.28);
    state.afterimages.push({
      x: p.x,
      y: p.y,
      facingLeft: p.facingLeft,
      frame: animFrame,
      life: 0.18,
      maxLife: 0.18,
    });
  } else if ((p.stunTimer || 0) > 0) {
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
      p.aimAngle = Math.atan2(my, mx);
      if (mx < -0.1) p.facingLeft = true;
      if (mx > 0.1) p.facingLeft = false;
      p.vx = mx * stats.moveSpeed;
      p.vy = my * stats.moveSpeed;

      moveWithSlide(p, p.vx * dt, p.vy * dt, 0.28);

      if (p.animTimer <= 0) p.anim = "walk";
      p.stepTimer += dt;
      if (p.stepTimer >= 0.24) {
        p.stepTimer = 0;
        sfx.step();
      }
      p.dustTimer += dt;
      if (p.dustTimer >= 0.12) {
        p.dustTimer = 0;
        state.particles.push({
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

  updateFOVIfNeeded(false);

  // Check stairs
  const ptx = Math.floor(p.x);
  const pty = Math.floor(p.y);
  if (state.level.grid[pty]?.[ptx] === TILE.STAIRS && (state.stairsCooldown || 0) <= 0) {
    openStairsDialog();
    return;
  }

  // Collect Boss Key drop
  if (state.bossKeyDrop) {
    if (Math.hypot(state.bossKeyDrop.x - p.x, state.bossKeyDrop.y - p.y) < 0.9) {
      state.hasBossKey = true;
      state.bossKeyDrop = null;
      sfx.loot();
      addFloat(p.x, p.y - 0.3, "+BOSS KEY!", "#facc15");
      spawnBurst(p.x, p.y, "#facc15", 16);
      addLog("Collected the Boss Key! Proceed to the Boss Chamber door.", "loot");
      saveRun();
    }
  }

  // Collect or inspect Ground Items
  state.invFullMsgCd = Math.max(0, (state.invFullMsgCd || 0) - dt);
  if (Array.isArray(state.level.groundItems) && state.level.groundItems.length > 0) {
    const remaining = [];
    let pickedAny = false;
    for (const gItem of state.level.groundItems) {
      gItem.fullMsgCd = Math.max(0, (gItem.fullMsgCd || 0) - dt);
      const dist = Math.hypot(gItem.x - p.x, gItem.y - p.y);
      if (gItem.requireLeave) {
        if (dist >= 0.75) gItem.requireLeave = false;
        remaining.push(gItem);
        continue;
      }
      if (dist < 0.72) {
        const qty = gItem.item.qty || 1;
        if (addItemToInventory(gItem.item, qty, { silentFull: true })) {
          sfx.loot();
          const label = qty > 1 ? `+${gItem.item.name} x${qty}` : `+${gItem.item.name}`;
          addFloat(gItem.x, gItem.y - 0.3, label, "#86efac");
          spawnBurst(gItem.x, gItem.y, "#86efac", 10);
          addLog(`Picked up ${gItem.item.name}${qty > 1 ? ` (x${qty})` : ""}.`, "loot");
          pickedAny = true;
          continue;
        }
        if ((gItem.fullMsgCd || 0) <= 0 && (state.invFullMsgCd || 0) <= 0) {
          gItem.fullMsgCd = 1.8;
          state.invFullMsgCd = 1.2;
          addFloat(p.x, p.y - 0.45, "Inventory is full!", "#f87171");
          addLog(`Inventory is full! Could not pick up ${gItem.item.name}.`, "info");
        }
      }
      remaining.push(gItem);
    }
    state.level.groundItems = remaining;
    if (pickedAny) {
      uiDirty = true;
      saveRun();
    }
  }

  // Auto-interact with adjacent/bumped doors, chests, wells, breakables
  for (const pr of state.level.props) {
    if (!pr.solid) continue;
    const dist = Math.hypot(pr.x + 0.5 - p.x, pr.y + 0.5 - p.y);
    if (dist < 1.0 && (pr.kind === "door" || pr.kind === "chest" || pr.kind === "well" || ["crate", "barrel", "urn"].includes(pr.kind))) {
      interactProp(pr);
    }
  }

  // Keep boss doors permanently sealed and player inside the Boss Chamber during an active boss fight
  if (state.level.isBossFloor && state.bossFightStarted) {
    for (const pr of state.level.props) {
      if (pr.kind === "door" && pr.isBossDoor) {
        pr.locked = true;
        pr.opened = false;
        pr.solid = true;
      }
    }
    const rooms = state.level.rooms || [];
    const bossRoom = rooms[rooms.length - 1];
    if (bossRoom) {
      p.x = Math.max(bossRoom.x + 0.35, Math.min(bossRoom.x + bossRoom.w - 0.35, p.x));
      p.y = Math.max(bossRoom.y + 0.35, Math.min(bossRoom.y + bossRoom.h - 0.35, p.y));
    }
  }

  // NPC & Shop proximity interaction
  if (state.npcCooldown <= 0) {
    for (const npc of state.level.npcs) {
      const dist = Math.hypot(npc.x + 0.5 - p.x, npc.y + 0.5 - p.y);
      if (dist < 0.85) {
        openStoryDialog(npc);
        return;
      }
    }
  }
  if ((state.shopCooldown || 0) <= 0 && !state.bossFightStarted && Array.isArray(state.level.shops)) {
    for (const shop of state.level.shops) {
      const dist = Math.hypot(shop.x + 0.5 - p.x, shop.y + 0.5 - p.y);
      if (dist < 0.85) {
        openShopDialog(shop);
        return;
      }
    }
  }

  // Update enemies in real time
  for (const e of state.level.enemies) {
    if (e.isBoss && !state.bossFightStarted) continue;
    if (e.falling) {
      e.z = Math.max(0, (e.z || 0) - 270 * dt);
      if (e.z <= 0) {
        e.z = 0;
        e.falling = false;
        state.shake = 12;
        sfx.ultSlam();
        spawnBurst(e.x, e.y, "#facc15", 24, 1.4);
        spawnRing(e.x, e.y, 48, "#ef4444", 0.45);
      }
      continue;
    }
    e.hurtTimer = Math.max(0, e.hurtTimer - dt);
    e.chilled = Math.max(0, e.chilled - dt);
    e.frozenTimer = Math.max(0, (e.frozenTimer || 0) - dt);
    e.stunTimer = Math.max(0, (e.stunTimer || 0) - dt);
    e.sunderTimer = Math.max(0, (e.sunderTimer || 0) - dt);
    e.dodgeCd = Math.max(0, (e.dodgeCd || 0) - dt);
    e.evadeTimer = Math.max(0, (e.evadeTimer || 0) - dt);
    e.animTimer = Math.max(0, e.animTimer - dt);
    if (e.animTimer <= 0) e.anim = "idle";

    const chillFactor = e.chilled > 0 ? 0.5 : 1;
    if (e.defBuffTimer > 0) {
      e.defBuffTimer = Math.max(0, e.defBuffTimer - dt);
      if (e.defBuffTimer <= 0) e.bonusDef = 0;
    }
    if (e.reflectTimer > 0) {
      e.reflectTimer = Math.max(0, e.reflectTimer - dt);
    }

    // Boss 1 (King Grak): loses HP -> gains movement speed, attack speed, and faster skill cooldowns
    let grakMissingPct = 0;
    if (e.isBoss && e.id === "royal_goblin") {
      if (e.baseSpeed === undefined) e.baseSpeed = e.speed || 2.55;
      if (e.baseAttackCd === undefined) e.baseAttackCd = e.attackCd || 1.05;
      if (e.baseSkillCd === undefined) e.baseSkillCd = e.skillCd || 3.8;
      grakMissingPct = 1 - Math.max(0, e.hp) / Math.max(1, e.maxHp);
      e.speed = e.baseSpeed * (1 + grakMissingPct * 0.85);
      e.attackCd = e.baseAttackCd / (1 + grakMissingPct * 0.9);
      e.skillCd = e.baseSkillCd / (1 + grakMissingPct * 0.95);
    }

    e.attackTimer = Math.max(0, e.attackTimer - dt * chillFactor);
    e.rangedTimer = Math.max(0, e.rangedTimer - dt * chillFactor);

    // Knockback
    if (Math.abs(e.kbX) > 0.05 || Math.abs(e.kbY) > 0.05) {
      moveWithSlide(e, e.kbX * dt, e.kbY * dt, e.isBoss ? 0.38 : 0.28);
      const decay = Math.exp(-10 * dt);
      e.kbX *= decay;
      e.kbY *= decay;
    }

    if (e.stunTimer > 0 || e.frozenTimer > 0) {
      e.windupTimer = 0;
      e.bossAction = null;
      e.bossDodge = null;
      e.z = 0;
      continue;
    }

    if (e.bossDodge) {
      const bd = e.bossDodge;
      bd.timer -= dt;
      const prog = Math.min(1, 1 - Math.max(0, bd.timer) / bd.duration);
      e.x = bd.startX + (bd.tx - bd.startX) * prog;
      e.y = bd.startY + (bd.ty - bd.startY) * prog;
      e.anim = "walk";
      if (Math.random() < 0.7) {
        state.particles.push({
          x: e.x * TILE_SIZE,
          y: e.y * TILE_SIZE,
          vx: (Math.random() - 0.5) * 18,
          vy: (Math.random() - 0.5) * 18,
          color: bd.color || "#38bdf8",
          size: 3.5,
          life: 0.22,
          maxLife: 0.22,
        });
      }
      if (bd.timer <= 0) {
        e.x = bd.tx;
        e.y = bd.ty;
        e.bossDodge = null;
        spawnBurst(e.x, e.y, bd.color || "#38bdf8", 8, 0.9);
      }
      continue;
    }

    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const dist = Math.hypot(dx, dy);
    const ex = Math.floor(e.x);
    const ey = Math.floor(e.y);
    const isVis = state.level.visible[ey]?.[ex];
    const seesPlayer = e.isBoss ? state.bossFightStarted : e.isClone ? state.bossFightStarted : (isVis || dist <= 4.2);

    if (dx < -0.05) e.facingLeft = true;
    if (dx > 0.05) e.facingLeft = false;

    // Boss Enrage (< 50% HP)
    if (e.isBoss && !e.enraged && e.hp <= e.maxHp * 0.5) {
      e.enraged = true;
      if (e.id !== "royal_goblin") {
        e.speed = (e.speed || 2.2) * 1.18;
        e.skillCd = (e.skillCd || 3.6) * 0.78;
      }
      e.skillTimer = Math.min(e.skillTimer ?? 1, 0.8);
      sfx.ultSlam();
      state.shake = Math.max(state.shake, 8);
      spawnBurst(e.x, e.y, "#ef4444", 24, 1.35);
      spawnRing(e.x, e.y, 44, "#ef4444", 0.4);
      addFloat(e.x, e.y - 0.6, "ENRAGED!", "#ef4444");
      addLog(`${e.name} becomes ENRAGED!`, "story");
    }

    // Active Telegraphed Boss Surprise Skill / Teleport / Stun
    if (e.bossAction) {
      const act = e.bossAction;
      act.timer -= dt * chillFactor;
      if (act.type === "leap_ambush") {
        const prog = Math.min(1, 1 - Math.max(0, act.timer) / act.duration);
        e.x = act.startX + (act.tx - act.startX) * prog;
        e.y = act.startY + (act.ty - act.startY) * prog;
        e.z = Math.sin(prog * Math.PI) * 34;
      }
      if (act.timer <= 0) {
        e.bossAction = null;
        e.z = 0;
        e.anim = "attack";
        e.animTimer = 0.35;
        const hitAng = Math.atan2(p.y - act.ty, p.x - act.tx);

        if (act.type === "leap_ambush") {
          e.x = act.tx;
          e.y = act.ty;
          sfx.ultSlam();
          state.shake = Math.max(state.shake, 10);
          spawnBurst(e.x, e.y, act.color, 20, 1.3);
          spawnRing(e.x, e.y, act.radius * TILE_SIZE, act.color, 0.38);
          if (Math.hypot(p.x - e.x, p.y - e.y) <= act.radius) {
            hurtPlayer(Math.round(e.atk * 1.25), `${e.name}'s Leap Ambush`, Math.cos(hitAng) * 4.8, Math.sin(hitAng) * 4.8);
          }
        } else if (act.type === "stun_slam") {
          sfx.ultSlam();
          state.shake = Math.max(state.shake, 10);
          spawnBurst(e.x, e.y, "#facc15", 20, 1.25);
          spawnRing(e.x, e.y, act.radius * TILE_SIZE, "#ef4444", 0.38);
          if (Math.hypot(p.x - e.x, p.y - e.y) <= act.radius) {
            hurtPlayer(Math.round(e.atk * 1.15), `${e.name}'s Concussive Slam`, Math.cos(hitAng) * 4.5, Math.sin(hitAng) * 4.5);
            stunPlayer(1.0, e.name, "#facc15");
          }
        } else if (act.type === "teleport_stun" || act.type === "teleport_strike") {
          spawnBurst(e.x, e.y, act.color, 16, 1.1);
          e.x = act.tx;
          e.y = act.ty;
          e.facingLeft = p.x < e.x;
          sfx.spell();
          state.shake = Math.max(state.shake, 9);
          spawnBurst(e.x, e.y, act.color, 22, 1.35);
          spawnRing(e.x, e.y, act.radius * TILE_SIZE, act.color, 0.4);
          if (Math.hypot(p.x - e.x, p.y - e.y) <= act.radius) {
            const ang = Math.atan2(p.y - e.y, p.x - e.x);
            hurtPlayer(Math.round(e.atk * 1.2), `${e.name}'s Surprise Ambush`, Math.cos(ang) * 4.8, Math.sin(ang) * 4.8);
            if (act.type === "teleport_stun") {
              stunPlayer(1.1, e.name, "#facc15");
            }
          }
        } else if (act.type === "void_sigil_stun") {
          sfx.nova();
          state.shake = Math.max(state.shake, 9);
          spawnBurst(act.tx, act.ty, "#c084fc", 24, 1.35);
          spawnRing(act.tx, act.ty, act.radius * TILE_SIZE, "#a855f7", 0.42);
          if (Math.hypot(p.x - act.tx, p.y - act.ty) <= act.radius) {
            hurtPlayer(Math.round(e.atk * 1.25), `${e.name}'s Soul Shatter`, Math.cos(hitAng) * 4.2, Math.sin(hitAng) * 4.2);
            stunPlayer(1.2, e.name, "#c084fc");
          }
        } else if (act.type === "dark_mend") {
          const healAmt = Math.round(e.maxHp * 0.08);
          e.hp = Math.min(e.maxHp, e.hp + healAmt);
          sfx.heal();
          spawnBurst(e.x, e.y, "#4ade80", 20, 1.25);
          spawnRing(e.x, e.y, 44, "#4ade80", 0.4);
          addFloat(e.x, e.y - 0.5, `+${healAmt} HP`, "#4ade80");
          addLog(`${e.name} channels Dark Mending and restores ${healAmt} HP!`, "combat");
        }
      }
      continue;
    }

    // Windup telegraph before melee strike
    if (e.windupTimer > 0) {
      e.windupTimer -= dt * chillFactor;
      if (e.windupTimer <= 0) {
        e.anim = "attack";
        e.animTimer = 0.28;
        e.attackTimer = e.attackCd || 1.1;
        if (dist <= (e.isBoss ? 1.35 : 1.1)) {
          const nx = dist > 0.01 ? dx / dist : 0;
          const ny = dist > 0.01 ? dy / dist : 0;
          hurtPlayer(e.atk, e.name, nx * 3.5, ny * 3.5);
        }
      }
      continue;
    }

    // Smart Boss Skill Dodge: react to incoming skill projectiles & telegraphed player charges/AOEs
    if (e.isBoss && seesPlayer && (e.dodgeCd || 0) <= 0 && !e.bossAction && !e.bossDodge) {
      const rooms = state.level.rooms || [];
      const bossRoom = rooms[rooms.length - 1];
      let dodged = false;

      // 1) Detect incoming player skill projectiles headed toward the boss
      for (const pr of state.projectiles) {
        if (pr.isEnemy) continue;
        const pDist = Math.hypot(e.x - pr.x, e.y - pr.y);
        if (pDist > 4.2) continue;
        const speedSq = pr.vx * pr.vx + pr.vy * pr.vy;
        if (speedSq <= 0.1) continue;
        const dot = (e.x - pr.x) * pr.vx + (e.y - pr.y) * pr.vy;
        if (dot > 0) {
          const speed = Math.sqrt(speedSq);
          const perp = Math.abs((e.x - pr.x) * pr.vy - (e.y - pr.y) * pr.vx) / speed;
          if (perp <= (pr.radius || 0.3) + 0.95) {
            dodged = tryTriggerBossDodge(e, pr.x, pr.y, bossRoom);
            if (dodged) break;
          }
        }
      }

      // 2) Detect telegraphed player skill windups/charges aiming at or around the boss
      if (!dodged) {
        if (p.radiantCharge && p.radiantCharge.timer < 0.25 && dist <= 6.8) {
          const tipX = p.x + Math.cos(p.radiantCharge.angle) * 6.5;
          const tipY = p.y + Math.sin(p.radiantCharge.angle) * 6.5;
          if (distPointToSegment(e.x, e.y, p.x, p.y, tipX, tipY) <= 1.35) {
            dodged = tryTriggerBossDodge(e, p.x, p.y, bossRoom);
          }
        } else if (p.valiantCharge && p.valiantCharge.phase === "windup") {
          if (distPointToSegment(e.x, e.y, p.valiantCharge.startX, p.valiantCharge.startY, p.valiantCharge.targetX, p.valiantCharge.targetY) <= 1.35) {
            dodged = tryTriggerBossDodge(e, p.x, p.y, bossRoom);
          }
        } else if (p.ultCharge && p.ultCharge.timer < 0.65 && dist <= (p.ultCharge.spell.radii[p.ultCharge.rankIdx] + 0.35)) {
          dodged = tryTriggerBossDodge(e, p.x, p.y, bossRoom);
        } else if (p.leap && p.leap.progress > 0.68 && dist <= 4.2) {
          dodged = tryTriggerBossDodge(e, p.x, p.y, bossRoom);
        } else if (p.rapidSlash && dist <= 2.75) {
          dodged = tryTriggerBossDodge(e, p.x, p.y, bossRoom);
        }
      }
      if (dodged) continue;
    }

    // Boss Signature Skills (works across the entire Boss Chamber once unlocked)
    if (e.isBoss && seesPlayer) {
      e.skillTimer = Math.max(0, (e.skillTimer ?? (e.skillCd || 3.6)) - dt * chillFactor);
      if (e.skillTimer <= 0) {
        e.skillTimer = e.skillCd || 3.6;
        e.skillStep = ((e.skillStep || 0) + 1) % 3;
        e.anim = "attack";
        e.animTimer = 0.35;
        const rooms = state.level.rooms || [];
        const bossRoom = rooms[rooms.length - 1];
        const leadX = p.x + (p.vx || 0) * 0.22;
        const leadY = p.y + (p.vy || 0) * 0.22;
        const baseAng = Math.atan2(leadY - e.y, leadX - e.x);

        if (e.id === "royal_goblin") {
          if (dist > 3.2 || e.skillStep === 1) {
            // Surprise Leap Slam toward predicted hero position
            const spot = clampPointInBossRoom(leadX, leadY, bossRoom, e.x, e.y);
            addFloat(e.x, e.y - 0.5, "AMBUSH LEAP!", "#f97316");
            e.bossAction = {
              type: "leap_ambush",
              startX: e.x,
              startY: e.y,
              tx: spot.x,
              ty: spot.y,
              radius: 2.2,
              timer: 0.46,
              duration: 0.46,
              color: "#f97316",
              label: "AMBUSH LEAP!",
            };
          } else {
            // Concussive Warcry Slam (STUN)
            addFloat(e.x, e.y - 0.5, "WARCRY STUN!", "#facc15");
            e.bossAction = {
              type: "stun_slam",
              tx: e.x,
              ty: e.y,
              radius: 2.5,
              timer: 0.52,
              duration: 0.52,
              color: "#ef4444",
              label: "WARCRY STUN!",
            };
          }
        } else if (e.id === "gilded_knight") {
          if (e.skillStep === 1) {
            // Judgment Flash: Teleport behind hero + Stunning Shield Slam
            const spot = findBossTeleportSpot(e, p, bossRoom);
            addFloat(e.x, e.y - 0.5, "JUDGMENT FLASH!", "#facc15");
            e.bossAction = {
              type: "teleport_stun",
              tx: spot.x,
              ty: spot.y,
              radius: 2.25,
              timer: 0.48,
              duration: 0.48,
              color: "#facc15",
              label: "TELEPORT STUN!",
            };
          } else if (e.skillStep === 2) {
            // Gilded Aegis: High DEF + Damage Reflect
            e.defBuffTimer = 4.5;
            e.reflectTimer = 4.5;
            e.bonusDef = Math.round((e.def || 17) * 1.15 + 12);
            e.reflectPct = 0.35;
            sfx.spell();
            spawnBurst(e.x, e.y, "#fde047", 20, 1.25);
            spawnRing(e.x, e.y, 44, "#fde047", 0.45);
            addFloat(e.x, e.y - 0.5, "AEGIS + REFLECT!", "#fde047");
            addLog(`${e.name} raises Gilded Aegis (+${e.bonusDef} DEF & 35% Damage Reflect for 4.5s)!`, "story");
          } else {
            // 3-way Solar Crescent Wave
            addFloat(e.x, e.y - 0.5, "SOLAR WAVE!", "#facc15");
            for (const off of [-0.24, 0, 0.24]) {
              const a = baseAng + off;
              state.projectiles.push({
                x: e.x,
                y: e.y,
                vx: Math.cos(a) * 6.5,
                vy: Math.sin(a) * 6.5,
                radius: 0.26,
                color: "#facc15",
                dmg: Math.round(e.atk * 1.05),
                isEnemy: true,
                sourceName: `${e.name}'s Solar Wave`,
                life: 1.6,
              });
            }
          }
        } else if (e.id === "void_king") {
          e.voidStep = ((e.voidStep || 0) + 1) % 4;
          const activeClones = state.level.enemies.filter((c) => c.isClone).length;
          if (e.voidStep === 1) {
            // Shadow Step (TELEPORT ambush behind player)
            const spot = findBossTeleportSpot(e, p, bossRoom);
            addFloat(e.x, e.y - 0.5, "SHADOW STEP!", "#c084fc");
            e.bossAction = {
              type: "teleport_strike",
              tx: spot.x,
              ty: spot.y,
              radius: 2.35,
              timer: 0.45,
              duration: 0.45,
              color: "#c084fc",
              label: "SHADOW STEP!",
            };
          } else if (e.voidStep === 2 && activeClones < 2) {
            // Mirror Phantoms: create up to 2 Shadow Clones to distract & harass player
            const toSpawn = 2 - activeClones;
            for (let cIdx = 0; cIdx < toSpawn; cIdx++) {
              const spot = findBossTeleportSpot(e, p, bossRoom);
              const jitterAng = (cIdx === 0 ? 1 : -1) * 1.1;
              const cx = clampPointInBossRoom(spot.x + Math.cos(jitterAng) * 1.2, spot.y + Math.sin(jitterAng) * 1.2, bossRoom, e.x, e.y);
              state.level.enemies.push({
                uid: `clone_${Date.now()}_${cIdx}_${Math.random().toString(36).slice(2, 6)}`,
                id: "void_clone",
                name: "Hollow Phantom",
                sprite: "void_king",
                isSheet: false,
                isBoss: false,
                isClone: true,
                parentUid: e.uid,
                hp: Math.round(e.maxHp * 0.065),
                maxHp: Math.round(e.maxHp * 0.065),
                atk: Math.round(e.atk * 0.4),
                def: Math.round((e.def || 10) * 0.35),
                xp: 0,
                gold: 0,
                speed: (e.speed || 2.15) * 1.1,
                attackCd: 1.25,
                rangedCd: 2.6,
                x: cx.x,
                y: cx.y,
                vx: 0,
                vy: 0,
                kbX: 0,
                kbY: 0,
                facingLeft: p.x < cx.x,
                anim: "idle",
                animTimer: 0,
                attackTimer: 0.5,
                windupTimer: 0,
                rangedTimer: 1.4,
                chilled: 0,
                hurtTimer: 0,
                bobPhase: Math.random() * Math.PI * 2,
              });
              spawnBurst(cx.x, cx.y, "#c084fc", 14, 1.1);
            }
            sfx.spell();
            addFloat(e.x, e.y - 0.5, "VOID MIRAGES!", "#c084fc");
            addLog(`${e.name} conjures Shadow Clones to distract you!`, "story");
          } else if (e.voidStep === 3 && e.hp < e.maxHp * 0.88) {
            // Dark Mending (interruptible heal channel)
            addFloat(e.x, e.y - 0.5, "DARK MENDING!", "#4ade80");
            e.bossAction = {
              type: "dark_mend",
              tx: e.x,
              ty: e.y,
              radius: 1.4,
              timer: 0.65,
              duration: 0.65,
              color: "#4ade80",
              label: "HEALING!",
            };
          } else if (e.skillStep === 2) {
            // Soul Shatter (STUN gravity sigil under player)
            const spot = clampPointInBossRoom(leadX, leadY, bossRoom, p.x, p.y);
            addFloat(e.x, e.y - 0.5, "SOUL SHATTER!", "#a855f7");
            e.bossAction = {
              type: "void_sigil_stun",
              tx: spot.x,
              ty: spot.y,
              radius: 1.95,
              timer: 0.62,
              duration: 0.62,
              color: "#a855f7",
              label: "STUN SIGIL!",
            };
          } else {
            // Void Barrage (3-orb spread, 5-orb when enraged)
            addFloat(e.x, e.y - 0.5, "VOID BARRAGE!", "#c084fc");
            const offsets = e.enraged ? [-0.42, -0.21, 0, 0.21, 0.42] : [-0.28, 0, 0.28];
            for (const off of offsets) {
              const a = baseAng + off;
              state.projectiles.push({
                x: e.x,
                y: e.y,
                vx: Math.cos(a) * 6.0,
                vy: Math.sin(a) * 6.0,
                radius: 0.25,
                color: "#c084fc",
                dmg: Math.round(e.atk * 0.95),
                isEnemy: true,
                sourceName: `${e.name}'s Void Barrage`,
                life: 1.8,
              });
            }
          }
        }
      }
    }

    // Malakor & Hollow Phantom Clone ranged Void Orb
    if ((e.id === "void_king" || e.isClone) && seesPlayer && dist > 1.8 && e.rangedTimer <= 0) {
      e.rangedTimer = e.rangedCd || 2.1;
      const leadX = p.x + (p.vx || 0) * (e.isClone ? 0.08 : 0.2);
      const leadY = p.y + (p.vy || 0) * (e.isClone ? 0.08 : 0.2);
      const ang = Math.atan2(leadY - e.y, leadX - e.x);
      const orbSpeed = e.isClone ? 4.8 : 5.6;
      state.projectiles.push({
        x: e.x,
        y: e.y,
        vx: Math.cos(ang) * orbSpeed,
        vy: Math.sin(ang) * orbSpeed,
        radius: e.isClone ? 0.19 : 0.24,
        color: "#c084fc",
        dmg: Math.round(e.atk * 0.85),
        isEnemy: true,
        sourceName: e.name,
        life: 2.0,
      });
      spawnBurst(e.x, e.y, "#c084fc", 6, 0.7);
    }

    if (dist <= (e.isBoss ? 1.15 : 0.95) && e.attackTimer <= 0) {
      e.windupTimer = e.id === "royal_goblin" ? 0.32 / (1 + grakMissingPct * 0.65) : 0.32;
      spawnRing(e.x, e.y, 24, "#ef4444", e.windupTimer);
    } else if (seesPlayer && (e.isBoss || e.isClone || dist <= 7.8)) {
      const spd = (e.speed || 2.0) * chillFactor;
      let moveDirX = dx / Math.max(0.01, dist);
      let moveDirY = dy / Math.max(0.01, dist);

      // Smarter spacing: Malakor kites/strafes when player crowds him in melee
      if (e.id === "void_king" && dist < 2.1) {
        const strafeDir = e.enraged ? -1 : 1;
        moveDirX = -moveDirX * 0.65 + -moveDirY * 0.55 * strafeDir;
        moveDirY = -moveDirY * 0.65 + moveDirX * 0.55 * strafeDir;
      }

      let moveX = moveDirX * spd;
      let moveY = moveDirY * spd;

      // Soft separation from other enemies
      for (const other of state.level.enemies) {
        if (other.uid === e.uid) continue;
        const sx = e.x - other.x;
        const sy = e.y - other.y;
        const sd = Math.hypot(sx, sy);
        if (sd > 0.001 && sd < 0.75) {
          moveX += (sx / sd) * 1.4;
          moveY += (sy / sd) * 1.4;
        }
      }

      moveWithSlide(e, moveX * dt, moveY * dt, e.isBoss ? 0.38 : 0.28);
      if (e.animTimer <= 0) e.anim = "walk";
    }
  }

  // Update projectiles
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const pr = state.projectiles[i];
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;
    pr.life -= dt;

    // Trail particle
    if (Math.random() < 0.65) {
      state.particles.push({
        x: pr.x * TILE_SIZE,
        y: pr.y * TILE_SIZE,
        vx: (Math.random() - 0.5) * 18,
        vy: (Math.random() - 0.5) * 18,
        color: pr.color,
        size: 3,
        life: 0.2,
        maxLife: 0.2,
      });
    }

    const tx = Math.floor(pr.x);
    const ty = Math.floor(pr.y);
    const hitProp = !pr.isEnemy
      ? state.level.props.find(
          (prop) => prop.solid && ["crate", "barrel", "urn"].includes(prop.kind) && prop.x === tx && prop.y === ty
        )
      : null;
    if (hitProp) interactProp(hitProp);

    const spawnFrostZone = (zx, zy) => {
      if (!state.frostZones) state.frostZones = [];
      sfx.frost();
      const rad = pr.frostRadius || 2.0;
      spawnRing(zx, zy, rad * TILE_SIZE, "#38bdf8", 0.38);
      spawnBurst(zx, zy, "#bae6fd", 16, 1.15);
      state.frostZones.push({
        x: zx,
        y: zy,
        radius: rad,
        timer: pr.frostDuration || 4.0,
        maxTimer: pr.frostDuration || 4.0,
        chillDur: typeof pr.chill === "number" ? pr.chill : 2.5,
        freezeDur: pr.frostFreezeDur || 1.5,
        shatterDmg: pr.frostShatterDmg || 3,
        dwell: new Map(),
        frozenIds: new Set(),
        particleCd: 0,
      });
    };

    const blocked = isBlockedAt(tx, ty);
    if (pr.life <= 0 || blocked) {
      if (pr.isFrostLance) {
        const zx = blocked ? pr.x - pr.vx * dt * 0.6 : pr.x;
        const zy = blocked ? pr.y - pr.vy * dt * 0.6 : pr.y;
        spawnFrostZone(zx, zy);
      } else {
        spawnBurst(pr.x, pr.y, pr.color, 6, 0.7);
      }
      state.projectiles.splice(i, 1);
      continue;
    }

    if (pr.isEnemy) {
      if (Math.hypot(pr.x - p.x, pr.y - p.y) <= pr.radius + 0.3) {
        hurtPlayer(pr.dmg, pr.sourceName || "Void Orb", pr.vx * 0.4, pr.vy * 0.4);
        state.projectiles.splice(i, 1);
      }
    } else {
      let hit = false;
      for (const e of [...state.level.enemies]) {
        if (pr.pierce && pr.hitIds?.has(e.uid)) continue;
        if (Math.hypot(pr.x - e.x, pr.y - e.y) <= pr.radius + (e.isBoss ? 0.45 : 0.35)) {
          if (pr.chill) e.chilled = typeof pr.chill === "number" ? pr.chill : 3.0;
          if (pr.sunderDur) {
            e.sunderTimer = Math.max(e.sunderTimer || 0, pr.sunderDur);
            addFloat(e.x, e.y - 0.4, "SUNDERED", "#fb923c");
          }
          damageEnemy(e, pr.dmg, Boolean(pr.isCrit), pr.label || "Spell", pr.vx * 0.25, pr.vy * 0.25);
          if (pr.isSlashWave) {
            spawnBurst(e.x, e.y, "#fb923c", 8, 1.0);
          }
          if (pr.isFrostLance) {
            spawnFrostZone(pr.x, pr.y);
          }
          if (pr.pierce) {
            pr.hitIds?.add(e.uid);
          } else {
            hit = true;
            break;
          }
        }
      }
      if (hit) state.projectiles.splice(i, 1);
    }
  }

  // Update Frost Lance lingering Frost AOE zones (slow continuously, freeze after >1s inside)
  if (state.frostZones?.length) {
    for (let i = state.frostZones.length - 1; i >= 0; i--) {
      const z = state.frostZones[i];
      z.timer -= dt;
      z.particleCd -= dt;
      if (z.particleCd <= 0) {
        z.particleCd = 0.08;
        const ang = Math.random() * Math.PI * 2;
        const dist = Math.sqrt(Math.random()) * z.radius * TILE_SIZE;
        state.particles.push({
          x: z.x * TILE_SIZE + Math.cos(ang) * dist,
          y: z.y * TILE_SIZE + Math.sin(ang) * dist,
          vx: (Math.random() - 0.5) * 14,
          vy: -14 - Math.random() * 14,
          color: Math.random() < 0.5 ? "#bae6fd" : "#38bdf8",
          size: 2.8,
          life: 0.38,
          maxLife: 0.38,
        });
      }

      for (const e of [...state.level.enemies]) {
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
            damageEnemy(e, z.shatterDmg, false, "Frost Lance (Freeze)", 0, 0);
          }
        } else {
          z.dwell.delete(e.uid);
        }
      }

      if (z.timer <= 0) {
        state.frostZones.splice(i, 1);
      }
    }
  }

  // Update Siege Barrage arrow storms (3s raining arrows)
  if (state.arrowStorms?.length) {
    for (let i = state.arrowStorms.length - 1; i >= 0; i--) {
      const st = state.arrowStorms[i];
      st.timer -= dt;
      st.tickTimer -= dt;
      st.spawnTimer -= dt;

      if (st.spawnTimer <= 0) {
        st.spawnTimer = 0.065;
        if (state.fallingArrows.length < 24) {
          for (let k = 0; k < 2; k++) {
            const ang = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * st.radius * TILE_SIZE;
            const landX = st.x * TILE_SIZE + Math.cos(ang) * r;
            const landY = st.y * TILE_SIZE + Math.sin(ang) * r;
            state.fallingArrows.push({
              x: landX - 24,
              y: landY - 96,
              targetX: landX,
              targetY: landY,
              life: 0.18,
              maxLife: 0.18,
            });
          }
        }
      }

      if (st.tickTimer <= 0) {
        st.tickTimer = st.tickInterval;
        sfx.slash();
        spawnRing(st.x, st.y, st.radius * TILE_SIZE, "rgba(250, 204, 21, 0.7)", 0.28);
        for (const e of [...state.level.enemies]) {
          if (Math.hypot(e.x - st.x, e.y - st.y) <= st.radius + 0.35) {
            e.chilled = Math.max(e.chilled || 0, st.chillDur);
            damageEnemy(e, st.dmg, false, st.spell.name, 0, 0);
          }
        }
      }

      if (st.timer <= 0) {
        state.arrowStorms.splice(i, 1);
      }
    }
  }
  if (state.fallingArrows?.length) {
    for (let i = state.fallingArrows.length - 1; i >= 0; i--) {
      const fa = state.fallingArrows[i];
      fa.life -= dt;
      if (fa.life <= 0) {
        state.particles.push({
          x: fa.targetX,
          y: fa.targetY,
          vx: (Math.random() - 0.5) * 28,
          vy: (Math.random() - 0.5) * 28,
          color: "#fde047",
          size: 2.5,
          life: 0.18,
          maxLife: 0.18,
        });
        state.fallingArrows.splice(i, 1);
      }
    }
  }

  // Update visual FX
  for (let i = state.slashes.length - 1; i >= 0; i--) {
    state.slashes[i].life -= dt;
    if (state.slashes[i].life <= 0) state.slashes.splice(i, 1);
  }
  for (let i = state.rings.length - 1; i >= 0; i--) {
    const rg = state.rings[i];
    if ((rg.delay || 0) > 0) {
      rg.delay -= dt;
      continue;
    }
    rg.life -= dt;
    const t = 1 - Math.max(0, rg.life / rg.maxLife);
    rg.radius = 4 + (rg.maxRadius - 4) * t;
    if (rg.life <= 0) state.rings.splice(i, 1);
  }
  for (let i = state.beams.length - 1; i >= 0; i--) {
    state.beams[i].life -= dt;
    if (state.beams[i].life <= 0) state.beams.splice(i, 1);
  }
  for (let i = state.afterimages.length - 1; i >= 0; i--) {
    state.afterimages[i].life -= dt;
    if (state.afterimages[i].life <= 0) state.afterimages.splice(i, 1);
  }
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const pt = state.particles[i];
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.life -= dt;
    if (pt.life <= 0) state.particles.splice(i, 1);
  }
  for (let i = state.floatingTexts.length - 1; i >= 0; i--) {
    const ft = state.floatingTexts[i];
    ft.y += ft.vy * dt;
    ft.life -= dt;
    if (ft.life <= 0) state.floatingTexts.splice(i, 1);
  }
}

function render(ts) {
  requestAnimationFrame(render);
  if (!state || !state.level || !state.player) return;
  try {
    renderFrame(ts);
  } catch (err) {
    console.error("Frame error:", err);
  }
}

function renderFrame(ts) {

  if (!lastFrameTime) lastFrameTime = ts;
  const rawDt = (ts - lastFrameTime) / 1000;
  lastFrameTime = ts;
  const dt = Math.min(0.05, Math.max(0, rawDt));

  const menuOpen = !document.getElementById("main-menu").hidden || !document.getElementById("loading-screen").hidden;
  const modalOpen = Boolean(document.querySelector("dialog[open]")) || menuOpen;
  if (!modalOpen && isCanvasVisible && !document.hidden) {
    animTimer += dt;
    if (animTimer >= 0.095) {
      animFrame = (animFrame + 1) % 24;
      animTimer -= 0.095;
    }
    updateSimulation(dt);
    updateCooldownUI();
    if (uiDirty) updateUI();
  }

  if (isMobileLayout()) {
    const vw = window.innerWidth || 800;
    const vh = window.innerHeight || 360;
    const targetH = 340;
    const targetW = Math.max(420, Math.round(targetH * (vw / vh)));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    let focusX = state.player.x * TILE_SIZE;
    let focusY = state.player.y * TILE_SIZE;
    if (state.camReveal) {
      const cr = state.camReveal;
      const elapsed = cr.duration - cr.timer;
      let blend = 1;
      if (elapsed < 0.5) blend = elapsed / 0.5;
      else if (cr.timer < 0.5) blend = Math.max(0, cr.timer / 0.5);
      const tx = cr.targetX * TILE_SIZE;
      const ty = cr.targetY * TILE_SIZE;
      focusX = focusX + (tx - focusX) * blend;
      focusY = focusY + (ty - focusY) * blend;
    }
    camera.x = focusX - canvas.width / 2;
    camera.y = focusY - canvas.height / 2;
  } else {
    const fullW = MAP_W * TILE_SIZE;
    const fullH = MAP_H * TILE_SIZE;
    if (canvas.width !== fullW || canvas.height !== fullH) {
      canvas.width = fullW;
      canvas.height = fullH;
    }
    camera.x = 0;
    camera.y = 0;
  }

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#06080d";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(-Math.round(camera.x), -Math.round(camera.y));
  const shakeEnabled = meta.settings?.screenShake !== false;
  if (shakeEnabled && state.shake > 0.2) {
    const sx = (Math.random() - 0.5) * state.shake * 2;
    const sy = (Math.random() - 0.5) * state.shake * 2;
    ctx.translate(sx, sy);
  }

  const lvl = state.level;
  const tilesImg = assets.dungeon_tiles;

  // Map tiles (viewport-culled for 60fps even when full floor is revealed)
  const minTX = Math.max(0, Math.floor(camera.x / TILE_SIZE) - 1);
  const maxTX = Math.min(MAP_W - 1, Math.ceil((camera.x + canvas.width) / TILE_SIZE) + 1);
  const minTY = Math.max(0, Math.floor(camera.y / TILE_SIZE) - 1);
  const maxTY = Math.min(MAP_H - 1, Math.ceil((camera.y + canvas.height) / TILE_SIZE) + 1);
  for (let y = minTY; y <= maxTY; y++) {
    for (let x = minTX; x <= maxTX; x++) {
      if (!lvl.explored[y]?.[x]) continue;
      const isVis = lvl.visible[y][x];
      const tile = lvl.grid[y][x];
      const dx = x * TILE_SIZE;
      const dy = y * TILE_SIZE;

      if (tilesImg) {
        const quad = tile === TILE.WALL ? 2 : lvl.act.floorTileIdx;
        const sx = (quad % 2) * 128;
        const sy = Math.floor(quad / 2) * 128;
        ctx.drawImage(tilesImg, sx, sy, 128, 128, dx, dy, TILE_SIZE, TILE_SIZE);
      } else {
        ctx.fillStyle = tile === TILE.WALL ? "#1e2436" : "#2e3548";
        ctx.fillRect(dx, dy, TILE_SIZE, TILE_SIZE);
      }

      if (tile === TILE.STAIRS) {
        // Grey stone stairwell descending into shadow
        ctx.fillStyle = "#11151e";
        ctx.fillRect(dx + 2, dy + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        ctx.strokeStyle = "#475569";
        ctx.lineWidth = 2;
        ctx.strokeRect(dx + 2, dy + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        const steps = 5;
        for (let s = 0; s < steps; s++) {
          const sy = dy + 4 + s * 5;
          const v = 148 - s * 22;
          ctx.fillStyle = `rgb(${v}, ${v + 4}, ${v + 10})`;
          ctx.fillRect(dx + 4, sy, TILE_SIZE - 8, 4);
          ctx.fillStyle = `rgb(${v + 24}, ${v + 28}, ${v + 34})`;
          ctx.fillRect(dx + 4, sy, TILE_SIZE - 8, 1);
        }
      }

      if (!isVis) {
        ctx.fillStyle = "rgba(6, 8, 13, 0.65)";
        ctx.fillRect(dx, dy, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  // Props
  for (const pr of lvl.props) {
    if (!lvl.explored[pr.y][pr.x]) continue;
    let img = null;
    if (pr.kind === "chest") img = pr.opened ? assets.chest_open : assets.chest_closed;
    else if (pr.kind === "door") img = pr.locked ? assets.door_locked : pr.opened ? assets.door_open : assets.door_closed;
    else if (pr.kind === "crate") img = pr.broken ? assets.crate_damaged : assets.crate_intact;
    else if (pr.kind === "barrel") img = pr.broken ? null : assets.barrel;
    else if (pr.kind === "urn") img = pr.broken ? null : assets.urn;
    else if (pr.kind === "torch") img = assets.torch_stand;
    else if (pr.kind === "well") img = assets.stone_well;

    if (img) {
      if (pr.kind === "door") {
        ctx.drawImage(img, pr.x * TILE_SIZE, pr.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      } else {
        ctx.drawImage(img, pr.x * TILE_SIZE + 2, pr.y * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4);
      }
      if (pr.kind === "torch" && lvl.visible[pr.y][pr.x]) {
        const flicker = 0.14 + Math.sin(ts * 0.012 + pr.x) * 0.045;
        const grad = ctx.createRadialGradient(
          pr.x * TILE_SIZE + 16,
          pr.y * TILE_SIZE + 10,
          2,
          pr.x * TILE_SIZE + 16,
          pr.y * TILE_SIZE + 10,
          46
        );
        grad.addColorStop(0, `rgba(251, 146, 60, ${flicker})`);
        grad.addColorStop(1, "rgba(251, 146, 60, 0)");
        ctx.fillStyle = grad;
        ctx.fillRect(pr.x * TILE_SIZE - 30, pr.y * TILE_SIZE - 36, 92, 92);
      }
    }
  }

  // Shops (near Boss Chamber)
  if (Array.isArray(lvl.shops)) {
    const nonBossLeft = lvl.enemies.filter((e) => !e.isBoss && !e.isClone).length;
    const isShopOpen = nonBossLeft === 0;
    for (const shop of lvl.shops) {
      if (!lvl.explored[shop.y]?.[shop.x]) continue;
      const isVis = Boolean(lvl.visible[shop.y]?.[shop.x]);
      const sx = shop.x * TILE_SIZE;
      const sy = shop.y * TILE_SIZE;
      ctx.save();
      ctx.globalAlpha = isVis ? 1 : 0.6;
      // Golden shop stall awning & counter
      ctx.fillStyle = "rgba(250, 204, 21, 0.18)";
      ctx.beginPath();
      ctx.arc(sx + TILE_SIZE / 2, sy + TILE_SIZE / 2, 16, 0, Math.PI * 2);
      ctx.fill();
      if (assets.pirate_idle) {
        drawSheetFrame(ctx, assets.pirate_idle, animFrame, sx - 2, sy - 6, TILE_SIZE + 4, TILE_SIZE + 4);
      }
      ctx.fillStyle = "#78350f";
      ctx.fillRect(sx + 3, sy + TILE_SIZE - 8, TILE_SIZE - 6, 6);
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 3, sy + TILE_SIZE - 8, TILE_SIZE - 6, 6);

      const bob = Math.sin(ts * 0.005) * 1.5;
      ctx.fillStyle = isShopOpen ? "#facc15" : "#fca5a5";
      ctx.font = "bold 9px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(isShopOpen ? "SHOP" : "LOCKED", sx + TILE_SIZE / 2, sy - 3 + bob);
      ctx.restore();
    }
  }

  // NPCs
  for (const npc of lvl.npcs) {
    if (!lvl.visible[npc.y][npc.x]) continue;
    const tpl = NPC_ENCOUNTERS[npc.id];
    const sheet = assets[tpl.sprite];
    drawSheetFrame(ctx, sheet, animFrame, npc.x * TILE_SIZE - 2, npc.y * TILE_SIZE - 4, TILE_SIZE + 4, TILE_SIZE + 4);
    const bob = Math.sin(ts * 0.006) * 2;
    ctx.fillStyle = "#c4b5fd";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("!", npc.x * TILE_SIZE + TILE_SIZE / 2, npc.y * TILE_SIZE - 3 + bob);
  }

  // Shockwave & telegraph rings
  for (const rg of state.rings) {
    if ((rg.delay || 0) > 0) continue;
    ctx.save();
    ctx.globalAlpha = Math.max(0, rg.life / rg.maxLife);
    ctx.strokeStyle = rg.color;
    ctx.lineWidth = rg.lineWidth || 2.5;
    ctx.beginPath();
    ctx.arc(rg.x, rg.y, rg.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Boss surprise attack / teleport / stun telegraphs
  for (const e of lvl.enemies) {
    if (!e.isBoss || !e.bossAction || !state.bossFightStarted) continue;
    const act = e.bossAction;
    const progress = Math.min(1, 1 - Math.max(0, act.timer) / act.duration);
    const ax = act.tx * TILE_SIZE;
    const ay = act.ty * TILE_SIZE;
    const radPx = act.radius * TILE_SIZE;
    ctx.save();
    ctx.strokeStyle = act.color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(ax, ay, radPx, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = act.color;
    ctx.globalAlpha = 0.14 + progress * 0.24;
    ctx.beginPath();
    ctx.arc(ax, ay, radPx * progress, 0, Math.PI * 2);
    ctx.fill();

    if (act.type === "teleport_stun" || act.type === "teleport_strike" || act.type === "void_sigil_stun") {
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(ax, ay, 6 + Math.sin(ts * 0.02) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Ground items on floor
  if (Array.isArray(lvl.groundItems)) {
    for (const gItem of lvl.groundItems) {
      const gx = Math.floor(gItem.x);
      const gy = Math.floor(gItem.y);
      if (!lvl.explored[gy]?.[gx]) continue;
      const isVis = Boolean(lvl.visible[gy]?.[gx]);
      const px = gItem.x * TILE_SIZE;
      const py = gItem.y * TILE_SIZE + Math.sin(ts * 0.006 + (gItem.bobPhase || 0)) * 2.5;
      const rInfo = getRarityInfo(gItem.item);
      ctx.save();
      ctx.globalAlpha = isVis ? 1 : 0.55;
      ctx.fillStyle = rInfo.bg;
      ctx.beginPath();
      ctx.arc(px, py, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rInfo.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const iconImg = assets[gItem.item?.icon];
      if (iconImg) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(iconImg, px - 10, py - 10, 20, 20);
      } else {
        ctx.fillStyle = rInfo.color;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      if ((gItem.item?.qty || 1) > 1) {
        ctx.fillStyle = "#fde047";
        ctx.font = "bold 9px sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(`x${gItem.item.qty}`, px + 11, py + 11);
      }
      ctx.restore();
    }
  }

  // Boss Key drop on floor
  if (state.bossKeyDrop) {
    const kx = state.bossKeyDrop.x * TILE_SIZE;
    const ky = state.bossKeyDrop.y * TILE_SIZE + Math.sin(ts * 0.007) * 3;
    ctx.save();
    ctx.fillStyle = "rgba(250, 204, 21, 0.25)";
    ctx.beginPath();
    ctx.arc(kx, ky, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(kx - 4, ky, 4, 0, Math.PI * 2);
    ctx.moveTo(kx, ky);
    ctx.lineTo(kx + 8, ky);
    ctx.moveTo(kx + 5, ky);
    ctx.lineTo(kx + 5, ky + 4);
    ctx.moveTo(kx + 8, ky);
    ctx.lineTo(kx + 8, ky + 4);
    ctx.stroke();
    ctx.restore();
  }

  // Boss summon rune when floor enemies are 0 and boss hasn't dropped yet
  if (lvl.isBossFloor && !state.bossFightStarted && lvl.enemies.filter((e) => !e.isBoss && !e.isClone).length === 0) {
    const rooms = lvl.rooms || [];
    const bossRoom = rooms[rooms.length - 1];
    if (bossRoom) {
      const rx = (bossRoom.cx + 0.5) * TILE_SIZE;
      const ry = (bossRoom.cy + 0.5) * TILE_SIZE;
      ctx.save();
      ctx.strokeStyle = `rgba(250, 204, 21, ${0.45 + Math.sin(ts * 0.008) * 0.25})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(rx, ry, 18 + Math.sin(ts * 0.006) * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Enemies
  for (const e of lvl.enemies) {
    if (e.isBoss && (!state.bossFightStarted || state.bossIntroTimer > 0)) continue;
    const ex = Math.floor(e.x);
    const ey = Math.floor(e.y);
    if (!lvl.visible[ey]?.[ex] && !e.falling) continue;

    const cx = e.x * TILE_SIZE;
    const cy = e.y * TILE_SIZE;
    const ez = e.z || 0;
    const size = e.isBoss ? TILE_SIZE + 10 : TILE_SIZE;
    const speedAnim = e.id === "bat" ? 0.014 : 0.008;
    const bob = e.isSheet || ez > 0 ? 0 : Math.sin(ts * speedAnim + e.bobPhase) * (e.id === "bat" ? 4 : 2.2);
    const squash = e.id === "slime" ? 1 + Math.sin(ts * 0.01 + e.bobPhase) * 0.1 : 1;

    if (ez > 0) {
      ctx.save();
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      const s = Math.max(0.4, 1 - ez / 150);
      ctx.beginPath();
      ctx.ellipse(cx, cy + 14, 15 * s, 6 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const drawW = size * squash * (e.drawScale || 1);
    const drawH = (size / squash) * (e.drawScale || 1);
    const dx = cx - drawW / 2;
    const dy = cy - drawH / 2 + bob - ez - (e.isBoss ? 3 : 0);

    ctx.save();
    if (e.isClone) {
      ctx.globalAlpha = 0.72;
    }
    if (e.isSheet) {
      let spriteKey = e.sprite;
      if (e.anim === "attack" && e.attackSprite) spriteKey = e.attackSprite;
      else if (e.anim === "walk" && e.walkSprite) spriteKey = e.walkSprite;
      drawSheetFrame(ctx, assets[spriteKey] || assets[e.sprite], animFrame, dx, dy, drawW, drawH, e.facingLeft);
    } else if (assets[e.sprite]) {
      if (e.facingLeft && e.id !== "slime") {
        ctx.translate(dx + drawW, dy);
        ctx.scale(-1, 1);
        ctx.drawImage(assets[e.sprite], 0, 0, drawW, drawH);
      } else {
        ctx.drawImage(assets[e.sprite], dx, dy, drawW, drawH);
      }
    }
    ctx.restore();

    if (e.isBoss && e.id === "royal_goblin" && e.hp < e.maxHp * 0.75) {
      const rageAlpha = 0.25 + (1 - e.hp / e.maxHp) * 0.45;
      ctx.save();
      ctx.strokeStyle = `rgba(239, 68, 68, ${rageAlpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.56 + Math.sin(ts * 0.015) * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if ((e.reflectTimer || 0) > 0) {
      ctx.save();
      ctx.strokeStyle = `rgba(253, 224, 71, ${0.65 + Math.sin(ts * 0.014) * 0.25})`;
      ctx.fillStyle = "rgba(250, 204, 21, 0.14)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    if ((e.frozenTimer || 0) > 0) {
      ctx.save();
      ctx.fillStyle = "rgba(125, 211, 252, 0.42)";
      ctx.strokeStyle = "#e0f2fe";
      ctx.lineWidth = 2;
      const r = size * 0.44;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 1.15);
      ctx.lineTo(cx + r * 0.85, cy - r * 0.25);
      ctx.lineTo(cx + r * 0.65, cy + r * 0.9);
      ctx.lineTo(cx - r * 0.65, cy + r * 0.9);
      ctx.lineTo(cx - r * 0.85, cy - r * 0.25);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else if (e.hurtTimer > 0) {
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillRect(cx - size * 0.35, cy - size * 0.35, size * 0.7, size * 0.7);
    } else if (e.chilled > 0) {
      ctx.fillStyle = "rgba(56, 189, 248, 0.32)";
      ctx.fillRect(cx - size * 0.35, cy - size * 0.35, size * 0.7, size * 0.7);
    }

    if (e.windupTimer > 0) {
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.45, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (e.stunTimer > 0) {
      const spin = ts * 0.008;
      ctx.save();
      ctx.strokeStyle = "#facc15";
      ctx.fillStyle = "#fef08a";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.ellipse(cx, cy - size * 0.52, 10, 4, 0, 0, Math.PI * 2);
      ctx.stroke();
      for (let s = 0; s < 3; s++) {
        const a = spin + (s * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * 10, cy - size * 0.52 + Math.sin(a) * 4, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // HP bar
    const hpPct = Math.max(0, e.hp / e.maxHp);
    const barW = e.isBoss ? 36 : 26;
    ctx.fillStyle = "#111";
    ctx.fillRect(cx - barW / 2, cy - size / 2 - 6, barW, 4);
    ctx.fillStyle = e.isBoss ? "#facc15" : "#ef4444";
    ctx.fillRect(cx - barW / 2, cy - size / 2 - 6, barW * hpPct, 4);
  }

  // Dash afterimages
  const heroPrefix =
    state.player.heroClass === "gilded"
      ? "gilded"
      : state.player.heroClass === "soldier"
        ? "soldier"
        : "paladin";
  const heroDrawSize = heroPrefix === "soldier" ? 64 : 40;
  for (const aft of state.afterimages) {
    ctx.save();
    ctx.globalAlpha = (aft.life / aft.maxLife) * 0.45;
    drawSheetFrame(
      ctx,
      assets[`${heroPrefix}_walk`] || assets[`${heroPrefix}_idle`] || assets.paladin_idle,
      aft.frame,
      aft.x * TILE_SIZE - heroDrawSize / 2,
      aft.y * TILE_SIZE - heroDrawSize / 2 - 2,
      heroDrawSize,
      heroDrawSize,
      aft.facingLeft
    );
    ctx.restore();
  }

  // Player
  const p = state.player;
  const pz = p.z || 0;
  // Ground shadow (scales down slightly as hero leaps high)
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.42)";
  const shadowScale = Math.max(0.45, 1 - pz / 90);
  ctx.beginPath();
  ctx.ellipse(p.x * TILE_SIZE, p.y * TILE_SIZE + 12, 11 * shadowScale, 5 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const pSheet = assets[`${heroPrefix}_${p.anim}`] || assets[`${heroPrefix}_idle`] || assets.paladin_idle;
  ctx.save();
  if (p.iFrames > 0 && !p.leap && Math.floor(ts / 60) % 2 === 0) {
    ctx.globalAlpha = 0.55;
  }
  drawSheetFrame(
    ctx,
    pSheet,
    animFrame,
    p.x * TILE_SIZE - heroDrawSize / 2,
    p.y * TILE_SIZE - heroDrawSize / 2 - 2 - pz,
    heroDrawSize,
    heroDrawSize,
    p.facingLeft
  );
  ctx.restore();

  if ((p.stunTimer || 0) > 0) {
    const spin = ts * 0.01;
    const pcx = p.x * TILE_SIZE;
    const pcy = p.y * TILE_SIZE - 22 - pz;
    ctx.save();
    ctx.strokeStyle = "#facc15";
    ctx.fillStyle = "#fef08a";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.ellipse(pcx, pcy, 10, 4, 0, 0, Math.PI * 2);
    ctx.stroke();
    for (let s = 0; s < 3; s++) {
      const a = spin + (s * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc(pcx + Math.cos(a) * 10, pcy + Math.sin(a) * 4, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Facing / Aim direction arrow around hero
  if (!state.runEnded && state.dyingTimer <= 0) {
    const ang = getAimAngle();
    const orbit = 21;
    const ax = p.x * TILE_SIZE + Math.cos(ang) * orbit;
    const ay = p.y * TILE_SIZE + Math.sin(ang) * orbit - pz * 0.5;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(ang);
    ctx.fillStyle = "#38bdf8";
    ctx.strokeStyle = "#0c0e14";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-4, -5);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }

  // Animated sweeping melee slash arcs
  for (const sl of state.slashes) {
    const t = 1 - Math.max(0, sl.life / sl.maxLife);
    const sweepStart = sl.angle - 1.15 + t * 0.75;
    const sweepEnd = sl.angle - 0.35 + t * 1.55;
    const rad = 26 + t * 14;
    ctx.save();
    ctx.globalAlpha = Math.max(0, (1 - t) * 0.95);
    ctx.strokeStyle = sl.color;
    ctx.lineWidth = 7 * (1 - t * 0.45);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(sl.x, sl.y, rad, sweepStart, sweepEnd);
    ctx.stroke();

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.5 * (1 - t * 0.5);
    ctx.beginPath();
    ctx.arc(sl.x, sl.y, rad + 2, sweepStart + 0.15, sweepEnd);
    ctx.stroke();
    ctx.restore();
  }

  // Projectiles (Frost Lance spear & Void Orbs) - no shadowBlur for smooth mobile WebView FPS
  for (const pr of state.projectiles) {
    ctx.save();
    ctx.translate(pr.x * TILE_SIZE, pr.y * TILE_SIZE);
    if (!pr.isEnemy) {
      const ang = Math.atan2(pr.vy, pr.vx);
      ctx.rotate(ang);
      if (pr.isArrow && assets.arrow_proj) {
        if (pr.fireTrail) {
          ctx.fillStyle = "rgba(250, 204, 21, 0.35)";
          ctx.beginPath();
          ctx.arc(0, 0, 9, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.drawImage(assets.arrow_proj, -12, -12, 24, 24);
      } else if (pr.isSlashWave) {
        const lifeFrac = Math.max(0.25, pr.life / (pr.maxLife || 0.6));
        const rad = Math.max(24, pr.radius * TILE_SIZE);
        ctx.globalAlpha = Math.min(1, lifeFrac + 0.2);

        // Outer solar fiery wake arc
        ctx.strokeStyle = "#f97316";
        ctx.lineWidth = 11;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(-10, 0, rad, -1.08, 1.08);
        ctx.stroke();

        // Mid golden crescent blade
        ctx.strokeStyle = "#facc15";
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(-6, 0, rad, -1.0, 1.0);
        ctx.stroke();

        // White-hot cutting edge
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(-3, 0, rad, -0.92, 0.92);
        ctx.stroke();
      } else if (pr.isMagicOrb) {
        const rad = pr.radius * TILE_SIZE;
        ctx.globalAlpha = 0.32;
        ctx.fillStyle = pr.color;
        ctx.beginPath();
        ctx.arc(0, 0, rad * 1.65, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = pr.color;
        ctx.beginPath();
        ctx.arc(0, 0, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(1.5, -1, rad * 0.45, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = pr.color;
        ctx.beginPath();
        ctx.moveTo(12, 0);
        ctx.lineTo(-8, -4);
        ctx.lineTo(-4, 0);
        ctx.lineTo(-8, 4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#e0f2fe";
        ctx.fillRect(-2, -1.5, 10, 3);
      }
    } else {
      ctx.fillStyle = pr.color;
      ctx.beginPath();
      ctx.arc(0, 0, pr.radius * TILE_SIZE, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Frost Lance lingering Frost AOE zones
  if (state.frostZones?.length) {
    for (const z of state.frostZones) {
      const fade = Math.min(1, z.timer / 0.6);
      const zx = z.x * TILE_SIZE;
      const zy = z.y * TILE_SIZE;
      const radPx = z.radius * TILE_SIZE;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.fillStyle = "rgba(56, 189, 248, 0.16)";
      ctx.strokeStyle = `rgba(186, 230, 253, ${0.55 + Math.sin(ts * 0.012) * 0.2})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(zx, zy, radPx, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Inner crystal ring & snowflake spokes
      ctx.strokeStyle = "rgba(125, 211, 252, 0.38)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(zx, zy, radPx * 0.58, 0, Math.PI * 2);
      ctx.stroke();
      const rot = ts * 0.0012;
      for (let k = 0; k < 3; k++) {
        const a = rot + (k * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(zx + Math.cos(a) * radPx * 0.85, zy + Math.sin(a) * radPx * 0.85);
        ctx.lineTo(zx - Math.cos(a) * radPx * 0.85, zy - Math.sin(a) * radPx * 0.85);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Siege Barrage (3s raining arrows) zone & falling arrow visuals
  if (state.arrowStorms?.length) {
    for (const st of state.arrowStorms) {
      ctx.save();
      ctx.strokeStyle = `rgba(250, 204, 21, ${0.45 + Math.sin(ts * 0.015) * 0.2})`;
      ctx.fillStyle = "rgba(250, 204, 21, 0.08)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(st.x * TILE_SIZE, st.y * TILE_SIZE, st.radius * TILE_SIZE, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
  if (state.fallingArrows?.length) {
    for (const fa of state.fallingArrows) {
      const t = 1 - Math.max(0, fa.life / fa.maxLife);
      const cx = fa.x + (fa.targetX - fa.x) * t;
      const cy = fa.y + (fa.targetY - fa.y) * t;
      const ang = Math.atan2(fa.targetY - fa.y, fa.targetX - fa.x);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      if (assets.arrow_proj) {
        ctx.drawImage(assets.arrow_proj, -11, -11, 22, 22);
      } else {
        ctx.strokeStyle = "#fde047";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-10, 0);
        ctx.lineTo(10, 0);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Radiant Sky-Beams (Holy Smite)
  for (const bm of state.beams) {
    const alpha = Math.max(0, bm.life / bm.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    const w = 18 * alpha + 6;
    const grad = ctx.createLinearGradient(bm.x - w / 2, bm.y - 160, bm.x + w / 2, bm.y);
    grad.addColorStop(0, "rgba(253, 224, 71, 0)");
    grad.addColorStop(0.5, bm.color);
    grad.addColorStop(1, "#ffffff");
    ctx.fillStyle = grad;
    ctx.fillRect(bm.x - w / 2, bm.y - 160, w, 160);
    ctx.restore();
  }

  // Radiant Cleave 0.5s solar wave charge-up
  if (p.radiantCharge) {
    const rc = p.radiantCharge;
    const prog = Math.min(1, 1 - rc.timer / rc.duration);
    const pxCenter = p.x * TILE_SIZE;
    const pyCenter = p.y * TILE_SIZE;
    const arcRad = 22 + prog * 14;

    ctx.save();
    // Converging charge aura ring around hero
    ctx.strokeStyle = `rgba(251, 146, 60, ${0.4 + prog * 0.45})`;
    ctx.fillStyle = `rgba(250, 204, 21, ${0.08 + prog * 0.14})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pxCenter, pyCenter, 28 - prog * 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Directional solar crescent charging forward
    ctx.translate(pxCenter, pyCenter);
    ctx.rotate(rc.angle);
    ctx.strokeStyle = `rgba(249, 115, 22, ${0.5 + prog * 0.5})`;
    ctx.lineWidth = 5 + prog * 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(6, 0, arcRad, -1.05, 1.05);
    ctx.stroke();

    ctx.strokeStyle = `rgba(254, 240, 138, ${0.45 + prog * 0.55})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(9, 0, arcRad, -0.95 * prog, 0.95 * prog);
    ctx.stroke();
    ctx.restore();
  }

  // Ultimate charging AOE circle & raised golden greatsword above hero
  if (p.ultCharge) {
    const uc = p.ultCharge;
    const prog = Math.min(1, 1 - uc.timer / uc.duration);
    const radPx = uc.spell.radii[uc.rankIdx] * TILE_SIZE;
    const pxCenter = p.x * TILE_SIZE;
    const pyCenter = p.y * TILE_SIZE;

    ctx.save();
    // Outer pulsing AOE indicator
    ctx.strokeStyle = `rgba(251, 191, 36, ${0.45 + Math.sin(ts * 0.015) * 0.25})`;
    ctx.fillStyle = `rgba(251, 191, 36, ${0.08 + prog * 0.14})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(pxCenter, pyCenter, radPx, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Expanding charge ring
    ctx.strokeStyle = "#fef08a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pxCenter, pyCenter, radPx * prog, 0, Math.PI * 2);
    ctx.stroke();

    // Raised golden sword above hero
    const lift = 24 + Math.sin(prog * Math.PI * 0.5) * 10;
    const sy = pyCenter - lift - pz;
    ctx.translate(pxCenter + (p.facingLeft ? -4 : 4), sy);
    // Blade
    ctx.fillStyle = "#fef9c3";
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -28);
    ctx.lineTo(4, -6);
    ctx.lineTo(-4, -6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Crossguard & hilt
    ctx.fillStyle = "#eab308";
    ctx.fillRect(-8, -6, 16, 4);
    ctx.fillStyle = "#78350f";
    ctx.fillRect(-2, -2, 4, 8);
    ctx.restore();
  }

  // Temporary Armor Ward / Retribution / Haste auras around hero
  if (p.retributionTimer > 0) {
    ctx.save();
    ctx.strokeStyle = `rgba(239, 68, 68, ${0.55 + Math.sin(ts * 0.012) * 0.25})`;
    ctx.lineWidth = 2.2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(p.x * TILE_SIZE, p.y * TILE_SIZE, (p.retributionRadius || 2.1) * TILE_SIZE, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if (p.hasteTimer > 0) {
    ctx.save();
    ctx.strokeStyle = `rgba(52, 211, 153, ${0.55 + Math.sin(ts * 0.014) * 0.25})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x * TILE_SIZE, p.y * TILE_SIZE - pz * 0.5, 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if (p.tempDefTimer > 0) {
    ctx.save();
    ctx.strokeStyle = `rgba(250, 204, 21, ${0.55 + Math.sin(ts * 0.01) * 0.25})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(p.x * TILE_SIZE, p.y * TILE_SIZE - pz * 0.5, 19, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Valiant Charge extending spear thrust (windup) & dynamic war-lance surge (dash)
  if (p.valiantCharge) {
    const vc = p.valiantCharge;
    const ang = Math.atan2(vc.dirY, vc.dirX);
    const sx = vc.startX * TILE_SIZE;
    const sy = vc.startY * TILE_SIZE;
    const ex = vc.targetX * TILE_SIZE;
    const ey = vc.targetY * TILE_SIZE;
    const spearMaxPx = (vc.spearDistMax || 1.35) * TILE_SIZE;
    const spearEx = sx + Math.cos(ang) * spearMaxPx;
    const spearEy = sy + Math.sin(ang) * spearMaxPx;

    if (vc.phase === "windup") {
      const prog = Math.min(1, 1 - vc.timer / vc.windupDur);
      const eased = 1 - Math.pow(1 - prog, 2.2);
      const spearLen = (0.55 + ((vc.spearDistMax || 1.35) - 0.55) * eased) * TILE_SIZE;
      const tipX = sx + Math.cos(ang) * spearLen;
      const tipY = sy + Math.sin(ang) * spearLen;

      ctx.save();
      // Faint guide rail to spear endpoint
      ctx.strokeStyle = `rgba(56, 189, 248, ${0.28 + prog * 0.25})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(spearEx, spearEy);
      ctx.stroke();

      // Target landing ring
      ctx.setLineDash([]);
      ctx.strokeStyle = `rgba(250, 204, 21, ${0.5 + prog * 0.45})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(spearEx, spearEy, 11 + (1 - eased) * 10, 0, Math.PI * 2);
      ctx.stroke();

      // Extending tapered spear shaft (cyan-white-gold gradient)
      const grad = ctx.createLinearGradient(sx, sy, tipX, tipY);
      grad.addColorStop(0, "rgba(56, 189, 248, 0.25)");
      grad.addColorStop(0.55, "rgba(250, 204, 21, 0.85)");
      grad.addColorStop(1, "#ffffff");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 7;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();

      // Inner bright core along extending spear
      ctx.strokeStyle = "#e0f2fe";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();

      // Thrusting spearhead & shock-cones at tip
      ctx.translate(tipX, tipY);
      ctx.rotate(ang);
      ctx.strokeStyle = "rgba(56, 189, 248, 0.8)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-14, -13);
      ctx.lineTo(6, 0);
      ctx.lineTo(-14, 13);
      ctx.stroke();

      ctx.fillStyle = "#fde047";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(-10, -8);
      ctx.lineTo(-5, 0);
      ctx.lineTo(-10, 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#38bdf8";
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(-4, -3.5);
      ctx.lineTo(-4, 3.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else {
      const hx = p.x * TILE_SIZE;
      const hy = p.y * TILE_SIZE;
      const wakeGrad = ctx.createLinearGradient(sx, sy, hx, hy);
      wakeGrad.addColorStop(0, "rgba(56, 189, 248, 0.15)");
      wakeGrad.addColorStop(0.5, "rgba(56, 189, 248, 0.65)");
      wakeGrad.addColorStop(1, "rgba(250, 204, 21, 0.95)");

      ctx.save();
      ctx.strokeStyle = wakeGrad;
      ctx.lineWidth = 14;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(hx, hy);
      ctx.stroke();

      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(hx, hy);
      ctx.stroke();

      // Dynamic spearhead leading the hero
      ctx.translate(hx, hy - pz * 0.5);
      ctx.rotate(ang);
      ctx.strokeStyle = "rgba(56, 189, 248, 0.9)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-4, -18);
      ctx.lineTo(24, 0);
      ctx.lineTo(-4, 18);
      ctx.stroke();

      ctx.fillStyle = "#fde047";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(38, 0);
      ctx.lineTo(6, -13);
      ctx.lineTo(12, 0);
      ctx.lineTo(6, 13);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#38bdf8";
      ctx.beginPath();
      ctx.moveTo(30, 0);
      ctx.lineTo(13, -5);
      ctx.lineTo(13, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // Skyfall Judgment airborne landing AOE reticle & countdown indicator
  if (p.leap) {
    const radPx = p.leap.spell.radii[p.leap.rankIdx] * TILE_SIZE;
    const lx = p.x * TILE_SIZE;
    const ly = p.y * TILE_SIZE;
    const frac = Math.max(0, 1 - (p.leap.progress || 0));
    ctx.save();
    ctx.fillStyle = "rgba(249, 115, 22, 0.12)";
    ctx.beginPath();
    ctx.arc(lx, ly, radPx, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(249, 115, 22, 0.85)";
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.arc(lx, ly, radPx, 0, Math.PI * 2);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(253, 224, 71, 0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(lx, ly, Math.max(8, radPx * frac), 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(lx, ly, radPx * 0.45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Particles
  for (const pt of state.particles) {
    ctx.fillStyle = pt.color;
    ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
    ctx.fillRect(pt.x, pt.y, pt.size, pt.size);
    ctx.globalAlpha = 1;
  }

  // Floating combat texts
  ctx.font = "bold 12px sans-serif";
  ctx.textAlign = "center";
  for (const ft of state.floatingTexts) {
    ctx.globalAlpha = Math.min(1, (ft.life / ft.maxLife) * 1.4);
    ctx.fillStyle = "#000";
    ctx.fillText(ft.text, ft.x + 1, ft.y + 1);
    ctx.fillStyle = ft.color;
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.globalAlpha = 1;
  }

  // Aim reticle
  if (mouse.inside && mouse.x !== null && !modalOpen && !state.runEnded) {
    ctx.save();
    ctx.strokeStyle = "rgba(250, 204, 21, 0.7)";
    ctx.lineWidth = 1.5;
    const rx = mouse.x * TILE_SIZE;
    const ry = mouse.y * TILE_SIZE;
    ctx.beginPath();
    ctx.arc(rx, ry, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();

  // Portrait canvas sync
  const pAnimSheet = assets[`${heroPrefix}_${p.anim}`] || assets[`${heroPrefix}_idle`] || assets.paladin_idle;
  portraitCtx.clearRect(0, 0, 64, 64);
  portraitCtx.imageSmoothingEnabled = false;
  drawSheetFrame(portraitCtx, pAnimSheet, animFrame, 4, 4, 56, 56);
  if (mobilePortraitCtx) {
    mobilePortraitCtx.clearRect(0, 0, 44, 44);
    mobilePortraitCtx.imageSmoothingEnabled = false;
    drawSheetFrame(mobilePortraitCtx, pAnimSheet, animFrame, 2, 2, 40, 40);
  }
  if (!renderMinimap._lastTs || ts - renderMinimap._lastTs >= 150) {
    renderMinimap._lastTs = ts;
    renderMinimap();
  }
}

function renderMinimap() {
  const mmCanvas = document.getElementById("minimap-canvas");
  if (!mmCanvas || !state) return;
  const mCtx = mmCanvas.getContext("2d");
  const mw = mmCanvas.width;
  const mh = mmCanvas.height;
  const sx = mw / MAP_W;
  const sy = mh / MAP_H;

  mCtx.fillStyle = "#06080d";
  mCtx.fillRect(0, 0, mw, mh);

  const lvl = state.level;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (!lvl.explored[y][x]) continue; // Unvisited fog
      const tile = lvl.grid[y][x];
      if (tile === TILE.WALL) {
        mCtx.fillStyle = "#2b354f";
      } else if (tile === TILE.STAIRS) {
        mCtx.fillStyle = "#38bdf8";
      } else {
        mCtx.fillStyle = lvl.visible[y][x] ? "#4b5b7c" : "#1e2638";
      }
      mCtx.fillRect(Math.floor(x * sx), Math.floor(y * sy), Math.ceil(sx), Math.ceil(sy));
    }
  }

  // Boss room highlight if explored
  if (lvl.isBossFloor && lvl.rooms?.length) {
    const br = lvl.rooms[lvl.rooms.length - 1];
    if (lvl.explored[br.cy]?.[br.cx]) {
      mCtx.strokeStyle = "#ef4444";
      mCtx.lineWidth = 1;
      mCtx.strokeRect(br.x * sx, br.y * sy, br.w * sx, br.h * sy);
    }
  }

  // Shop markers
  if (Array.isArray(lvl.shops)) {
    for (const shop of lvl.shops) {
      if (!lvl.explored[shop.y]?.[shop.x]) continue;
      mCtx.fillStyle = "#fb923c";
      mCtx.fillRect((shop.x + 0.5) * sx - 2, (shop.y + 0.5) * sy - 2, 4, 4);
    }
  }

  // Ground item markers
  if (Array.isArray(lvl.groundItems)) {
    for (const gItem of lvl.groundItems) {
      const gx = Math.floor(gItem.x);
      const gy = Math.floor(gItem.y);
      if (!lvl.explored[gy]?.[gx]) continue;
      mCtx.fillStyle = getRarityInfo(gItem.item).color;
      mCtx.fillRect(gItem.x * sx - 1.5, gItem.y * sy - 1.5, 3, 3);
    }
  }

  // Boss Key drop marker
  if (state.bossKeyDrop) {
    mCtx.fillStyle = "#facc15";
    mCtx.fillRect(state.bossKeyDrop.x * sx - 1.5, state.bossKeyDrop.y * sy - 1.5, 3, 3);
  }

  // Player dot
  mCtx.fillStyle = "#22d3ee";
  mCtx.fillRect(state.player.x * sx - 2, state.player.y * sy - 2, 4, 4);
}

function showMainMenu() {
  keys.clear();
  bgm.play("town");
  const menu = document.getElementById("main-menu");
  const resumeBtn = document.getElementById("menu-btn-resume");
  const saved = loadSavedRun();
  const hasRealProgress = saved && (saved.floor > 1 || saved.kills > 0 || (saved.elapsed || 0) > 1);
  if (hasRealProgress) {
    resumeBtn.hidden = false;
    resumeBtn.disabled = false;
    resumeBtn.textContent = `Resume (Floor ${saved.floor} — ${saved.player?.name || "Sir Aldric"})`;
  } else {
    resumeBtn.hidden = true;
    resumeBtn.disabled = true;
  }
  menu.hidden = false;
}

function hideMainMenu() {
  document.getElementById("main-menu").hidden = true;
  lastFrameTime = performance.now();
}

const VOLUME_CYCLE = ["off", "low", "med", "high"];
const VOLUME_LABELS = { off: "Off", low: "Low", med: "Med", high: "High" };

function syncSettingsUI() {
  if (!meta.settings) meta.settings = { sfxLevel: "high", musicLevel: "low", screenShake: true };
  if (!meta.settings.sfxLevel) meta.settings.sfxLevel = meta.settings.sfx === false ? "off" : "high";
  if (!meta.settings.musicLevel) meta.settings.musicLevel = "low";

  sfx.setLevel(meta.settings.sfxLevel);
  bgm.setLevel(meta.settings.musicLevel);

  const muteBtn = document.getElementById("btn-mute");
  if (muteBtn) {
    muteBtn.setAttribute("aria-pressed", String(sfx.muted));
    muteBtn.textContent = sfx.muted ? "SFX: Off" : "SFX: On";
  }

  const musicSettingBtn = document.getElementById("setting-music-btn");
  if (musicSettingBtn) musicSettingBtn.textContent = VOLUME_LABELS[meta.settings.musicLevel] || "Low";

  const sfxSettingBtn = document.getElementById("setting-sfx-btn");
  if (sfxSettingBtn) sfxSettingBtn.textContent = VOLUME_LABELS[meta.settings.sfxLevel] || "High";

  const shakeSettingBtn = document.getElementById("setting-shake-btn");
  if (shakeSettingBtn) shakeSettingBtn.textContent = meta.settings.screenShake !== false ? "On" : "Off";
}

function renderTitleSanctum() {
  const nameInput = document.getElementById("hero-name-input");
  if (nameInput && !nameInput.value.trim()) {
    nameInput.value = meta.heroName || "Sir Aldric";
  }
  const diffSel = document.getElementById("difficulty-select");
  if (diffSel) {
    diffSel.value = meta.difficulty || "normal";
  }
  document.getElementById("sanctum-shards").textContent = meta.soulShards;
  const list = document.getElementById("meta-upgrades-list");
  list.innerHTML = "";

  for (const upg of META_UPGRADES) {
    const rank = meta.upgrades[upg.id] || 0;
    const cost = upg.baseCost + rank * 2;
    const maxed = rank >= upg.maxRank;

    const card = document.createElement("div");
    card.className = "meta-card";
    card.innerHTML = `
      <strong>${upg.name} (${rank}/${upg.maxRank})</strong>
      <span style="color:var(--muted)">${upg.desc}</span>
    `;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary";
    btn.textContent = maxed ? "Maxed" : `Bless (${cost} Shards)`;
    btn.disabled = maxed || meta.soulShards < cost;
    btn.addEventListener("click", () => {
      meta.soulShards -= cost;
      meta.upgrades[upg.id] = rank + 1;
      saveMeta(meta);
      sfx.levelUp();
      renderTitleSanctum();
      document.getElementById("soul-shards-count").textContent = meta.soulShards;
    });
    card.appendChild(btn);
    list.appendChild(card);
  }
}

function renderCodex() {
  const el = document.getElementById("codex-entries");
  el.innerHTML = "";
  for (const entry of LORE_CODEX) {
    const unlocked = meta.unlockedCodex.includes(entry.id);
    const div = document.createElement("div");
    div.className = "codex-item";
    div.innerHTML = unlocked
      ? `<h4>${entry.title}</h4><p>${entry.text}</p>`
      : `<h4>??? (Undiscovered)</h4><p>Explore deeper floors and speak with allies to uncover this chronicle.</p>`;
    el.appendChild(div);
  }
}

function setupControls() {
  const unlockAudio = () => bgm.unlock();
  window.addEventListener("pointerdown", unlockAudio, { passive: true });
  window.addEventListener("keydown", unlockAudio, { passive: true });
  window.addEventListener("keydown", (e) => {
    if (document.querySelector("dialog[open]")) return;
    if (!document.getElementById("main-menu").hidden || !document.getElementById("loading-screen").hidden) return;
    if (!state || state.runEnded) return;

    const key = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) {
      e.preventDefault();
    }
    keys.add(key);

    if (key === " ") {
      performDash();
    } else if (key === "j") {
      performMeleeAttack();
    } else if (key === "q") {
      quickPotion("health_potion");
    } else if (key === "e") {
      quickPotion("mana_potion");
    } else if (["1", "2", "3", "4"].includes(key)) {
      const sp = getActiveSpells(state.player)[Number(key) - 1];
      if (sp) castSpell(sp.id);
    }
  });

  window.addEventListener("keyup", (e) => {
    keys.delete(e.key.toLowerCase());
  });

  window.addEventListener("blur", () => keys.clear());

  canvas.addEventListener("mousemove", (e) => {
    if (isMobileLayout()) return;
    const pos = clientToTile(e.clientX, e.clientY);
    mouse.x = pos.x;
    mouse.y = pos.y;
    mouse.inside = true;
  });

  canvas.addEventListener("mouseleave", () => {
    mouse.inside = false;
  });

  canvas.addEventListener("mousedown", (e) => {
    if (isMobileLayout()) return;
    if (e.button === 0) {
      const pos = clientToTile(e.clientX, e.clientY);
      mouse.x = pos.x;
      mouse.y = pos.y;
      mouse.inside = true;
      performMeleeAttack();
    }
  });

  document.getElementById("btn-skills").addEventListener("click", openSkillDialog);
  document.getElementById("btn-attack").addEventListener("click", performMeleeAttack);
  document.getElementById("btn-dash").addEventListener("click", performDash);

  // Mobile drawers (Stats & Bag)
  const panelStats = document.getElementById("panel-stats");
  const panelBag = document.getElementById("panel-bag");
  document.getElementById("btn-mobile-stats").addEventListener("click", () => {
    panelBag.classList.remove("mobile-open");
    panelStats.classList.toggle("mobile-open");
  });
  document.getElementById("btn-mobile-bag").addEventListener("click", () => {
    panelStats.classList.remove("mobile-open");
    panelBag.classList.toggle("mobile-open");
  });
  document.getElementById("btn-close-stats").addEventListener("click", () => panelStats.classList.remove("mobile-open"));
  document.getElementById("btn-close-bag").addEventListener("click", () => panelBag.classList.remove("mobile-open"));

  // Mobile Touch Controller (Floating Free Joystick + ATK / DASH)
  const joyZone = document.getElementById("touch-joy-zone");
  const joy = document.getElementById("touch-joystick");
  const knob = document.getElementById("touch-stick-knob");
  let joyPointerId = null;
  let joyOriginX = 0;
  let joyOriginY = 0;

  const updateJoystick = (clientX, clientY) => {
    const maxR = 42;
    let dx = clientX - joyOriginX;
    let dy = clientY - joyOriginY;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const norm = dist > 6 ? Math.min(1, dist / maxR) : 0;
    if (norm > 0) {
      touchMove.x = (dx / dist) * norm;
      touchMove.y = (dy / dist) * norm;
      touchMove.active = true;
    } else {
      touchMove.x = 0;
      touchMove.y = 0;
      touchMove.active = false;
    }
  };

  const resetJoystick = () => {
    joyPointerId = null;
    touchMove.x = 0;
    touchMove.y = 0;
    touchMove.active = false;
    joy.classList.remove("active");
    joy.style.left = "";
    joy.style.bottom = "";
    joy.style.top = "";
    knob.style.transform = "translate(-50%, -50%)";
  };

  joyZone.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const zRect = joyZone.getBoundingClientRect();
    joyPointerId = e.pointerId;
    joyZone.setPointerCapture(e.pointerId);
    const localX = Math.max(52, Math.min(zRect.width - 52, e.clientX - zRect.left));
    const localY = Math.max(52, Math.min(zRect.height - 52, e.clientY - zRect.top));
    joyOriginX = zRect.left + localX;
    joyOriginY = zRect.top + localY;
    joy.classList.add("active");
    joy.style.left = `${localX - 52}px`;
    joy.style.top = `${localY - 52}px`;
    joy.style.bottom = "auto";
    updateJoystick(e.clientX, e.clientY);
  });
  joyZone.addEventListener("pointermove", (e) => {
    if (e.pointerId === joyPointerId) updateJoystick(e.clientX, e.clientY);
  });
  joyZone.addEventListener("pointerup", (e) => {
    if (e.pointerId === joyPointerId) resetJoystick();
  });
  joyZone.addEventListener("pointercancel", resetJoystick);

  document.getElementById("touch-btn-attack").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    performMeleeAttack();
  });
  document.getElementById("touch-btn-dash").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    performDash();
  });

  for (const tBtn of document.querySelectorAll(".touch-skill-btn")) {
    tBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const spId = tBtn.dataset.spellId;
      if (spId) castSpell(spId);
    });
  }

  document.getElementById("mhud-btn-skills").addEventListener("click", openSkillDialog);
  document.getElementById("mhud-btn-menu").addEventListener("click", () => {
    saveRun();
    showMainMenu();
  });
  document.getElementById("btn-potion-hp").addEventListener("click", () => quickPotion("health_potion"));
  document.getElementById("btn-potion-mp").addEventListener("click", () => quickPotion("mana_potion"));

  document.getElementById("btn-mute").addEventListener("click", () => {
    if (!meta.settings) meta.settings = { sfxLevel: "high", musicLevel: "low", screenShake: true };
    meta.settings.sfxLevel = meta.settings.sfxLevel === "off" ? "high" : "off";
    saveMeta(meta);
    syncSettingsUI();
  });

  document.getElementById("setting-music-btn").addEventListener("click", () => {
    if (!meta.settings) meta.settings = { sfxLevel: "high", musicLevel: "low", screenShake: true };
    const idx = VOLUME_CYCLE.indexOf(meta.settings.musicLevel || "low");
    meta.settings.musicLevel = VOLUME_CYCLE[(idx + 1) % VOLUME_CYCLE.length];
    saveMeta(meta);
    syncSettingsUI();
  });

  document.getElementById("setting-sfx-btn").addEventListener("click", () => {
    if (!meta.settings) meta.settings = { sfxLevel: "high", musicLevel: "low", screenShake: true };
    const idx = VOLUME_CYCLE.indexOf(meta.settings.sfxLevel || "high");
    meta.settings.sfxLevel = VOLUME_CYCLE[(idx + 1) % VOLUME_CYCLE.length];
    saveMeta(meta);
    syncSettingsUI();
  });

  document.getElementById("setting-shake-btn").addEventListener("click", () => {
    if (!meta.settings) meta.settings = { sfx: true, screenShake: true };
    meta.settings.screenShake = !meta.settings.screenShake;
    saveMeta(meta);
    syncSettingsUI();
  });

  document.getElementById("setting-controls-btn").addEventListener("click", () => {
    document.getElementById("settings-dialog").close();
    document.getElementById("help-dialog").showModal();
  });

  document.getElementById("btn-menu").addEventListener("click", () => {
    saveRun();
    showMainMenu();
  });

  document.getElementById("menu-btn-play").addEventListener("click", () => {
    hideMainMenu();
    renderTitleSanctum();
    document.getElementById("title-dialog").showModal();
  });

  document.getElementById("menu-btn-resume").addEventListener("click", () => {
    const saved = loadSavedRun();
    if (saved) {
      restoreRun(saved);
      hideMainMenu();
    }
  });

  document.getElementById("menu-btn-settings").addEventListener("click", () => {
    syncSettingsUI();
    document.getElementById("settings-dialog").showModal();
  });

  document.getElementById("menu-btn-exit").addEventListener("click", () => {
    saveRun();
    if (window.AndroidApp && typeof window.AndroidApp.exitApp === "function") {
      window.AndroidApp.exitApp();
      return;
    }
    const capApp = window.Capacitor?.Plugins?.App;
    if (capApp && typeof capApp.exitApp === "function") {
      capApp.exitApp();
      return;
    }
    window.close();
    const status = document.querySelector("#main-menu .story-lead");
    if (status) {
      status.textContent = "Progress saved. You may now safely close this window or tab.";
    }
  });

  document.getElementById("btn-codex").addEventListener("click", () => {
    renderCodex();
    document.getElementById("codex-dialog").showModal();
  });
  document.getElementById("btn-help").addEventListener("click", () => {
    document.getElementById("help-dialog").showModal();
  });
  document.getElementById("btn-new-run").addEventListener("click", () => {
    renderTitleSanctum();
    document.getElementById("title-dialog").showModal();
  });
  document.getElementById("btn-stairs-stay").addEventListener("click", () => {
    state.stairsCooldown = 2.0;
    document.getElementById("stairs-dialog").close("stay");
  });
  document.getElementById("btn-stairs-proceed").addEventListener("click", () => {
    document.getElementById("stairs-dialog").close("proceed");
    descendFloor();
  });

function openHeroDialog(onSelectHero) {
  const dlg = document.getElementById("hero-dialog");
  const paladinBtn = document.getElementById("btn-hero-paladin");
  const gildedBtn = document.getElementById("btn-hero-gilded");
  const soldierBtn = document.getElementById("btn-hero-soldier");
  const nextBtn = document.getElementById("btn-hero-next");
  const backBtn = document.getElementById("btn-hero-back");

  const paladinCtx = document.getElementById("hero-preview-paladin")?.getContext("2d");
  const gildedCtx = document.getElementById("hero-preview-gilded")?.getContext("2d");
  const soldierCtx = document.getElementById("hero-preview-soldier")?.getContext("2d");

  let selectedHero = null;
  let attackFlash = { paladin: 0, gilded: 0, soldier: 0 };
  let frame = 0;
  let lastTick = performance.now();
  let rafId = 0;

  function drawPreview(pCtx, prefix, isSel, now) {
    if (!pCtx) return;
    pCtx.clearRect(0, 0, 72, 72);
    pCtx.imageSmoothingEnabled = false;
    if (isSel) {
      pCtx.save();
      pCtx.strokeStyle = `rgba(250, 204, 21, ${0.55 + Math.sin(now * 0.008) * 0.25})`;
      pCtx.lineWidth = 2;
      pCtx.beginPath();
      pCtx.arc(36, 40, 28, 0, Math.PI * 2);
      pCtx.stroke();
      pCtx.restore();
    }
    let sheet = assets[`${prefix}_idle`];
    if (attackFlash[prefix] > 0) {
      sheet = assets[`${prefix}_attack`] || sheet;
    } else if (isSel) {
      sheet = assets[`${prefix}_walk`] || sheet;
    }
    if (sheet) {
      const pad = prefix === "soldier" ? -14 : 4;
      const sz = prefix === "soldier" ? 100 : 64;
      drawSheetFrame(pCtx, sheet, frame, pad, pad, sz, sz);
    }
  }

  function tickPreview(now) {
    if (!dlg.open) return;
    if (now - lastTick >= 110) {
      lastTick = now;
      frame = (frame + 1) % 24;
      if (attackFlash.paladin > 0) attackFlash.paladin -= 1;
      if (attackFlash.gilded > 0) attackFlash.gilded -= 1;
      if (attackFlash.soldier > 0) attackFlash.soldier -= 1;
    }
    drawPreview(paladinCtx, "paladin", selectedHero === "paladin", now);
    drawPreview(gildedCtx, "gilded", selectedHero === "gilded", now);
    drawPreview(soldierCtx, "soldier", selectedHero === "soldier", now);
    rafId = requestAnimationFrame(tickPreview);
  }

  function updateSelection() {
    paladinBtn.classList.toggle("selected", selectedHero === "paladin");
    gildedBtn.classList.toggle("selected", selectedHero === "gilded");
    soldierBtn?.classList.toggle("selected", selectedHero === "soldier");
    nextBtn.disabled = !selectedHero;
  }

  paladinBtn.onclick = () => {
    selectedHero = "paladin";
    attackFlash.paladin = 5;
    frame = 0;
    sfx.slash();
    updateSelection();
  };
  gildedBtn.onclick = () => {
    selectedHero = "gilded";
    attackFlash.gilded = 5;
    frame = 0;
    sfx.slash();
    updateSelection();
  };
  if (soldierBtn) {
    soldierBtn.onclick = () => {
      selectedHero = "soldier";
      attackFlash.soldier = 5;
      frame = 0;
      sfx.slash();
      updateSelection();
    };
  }
  nextBtn.onclick = () => {
    if (!selectedHero) return;
    cancelAnimationFrame(rafId);
    dlg.close("next");
    onSelectHero(selectedHero);
  };
  backBtn.onclick = () => {
    cancelAnimationFrame(rafId);
    dlg.close("back");
    document.getElementById("title-dialog").showModal();
  };
  dlg.addEventListener(
    "close",
    () => {
      if (rafId) cancelAnimationFrame(rafId);
    },
    { once: true }
  );

  updateSelection();
  dlg.showModal();
  rafId = requestAnimationFrame(tickPreview);
}

function openLoadoutDialog(onConfirm, onBack) {
  const dlg = document.getElementById("loadout-dialog");
  const basicList = document.getElementById("loadout-basic-list");
  const ultList = document.getElementById("loadout-ult-list");
  const badge = document.getElementById("loadout-count-badge");
  const confirmBtn = document.getElementById("btn-loadout-confirm");
  const cancelBtn = document.getElementById("btn-loadout-cancel");

  const basicSpells = SPELLS.filter((s) => !s.isUltimate);
  const ultSpells = SPELLS.filter((s) => s.isUltimate);

  let selectedBasic = [];
  let selectedUlt = null;

  function renderLoadout() {
    badge.textContent = `${selectedBasic.length}/3 Basic · ${selectedUlt ? 1 : 0}/1 Ult`;
    confirmBtn.disabled = selectedBasic.length !== 3 || !selectedUlt;

    basicList.innerHTML = "";
    for (const sp of basicSpells) {
      const isSel = selectedBasic.includes(sp.id);
      const card = document.createElement("button");
      card.type = "button";
      card.className = `loadout-card ${isSel ? "selected" : ""}`;
      card.innerHTML = `
        <img src="${sp.icon}" alt="" />
        <div class="loadout-card-body">
          <strong>${sp.name} · ${sp.mpCost} MP</strong>
          <span>${sp.desc}</span>
        </div>
      `;
      card.addEventListener("click", () => {
        if (isSel) {
          selectedBasic = selectedBasic.filter((id) => id !== sp.id);
        } else if (selectedBasic.length < 3) {
          selectedBasic.push(sp.id);
        } else {
          selectedBasic = [...selectedBasic.slice(1), sp.id];
        }
        renderLoadout();
      });
      basicList.appendChild(card);
    }

    ultList.innerHTML = "";
    for (const sp of ultSpells) {
      const isSel = selectedUlt === sp.id;
      const card = document.createElement("button");
      card.type = "button";
      card.className = `loadout-card ult ${isSel ? "selected" : ""}`;
      card.innerHTML = `
        <img src="${sp.icon}" alt="" />
        <div class="loadout-card-body">
          <strong>${sp.name} (ULT) · ${sp.mpCost} MP</strong>
          <span>${sp.desc}</span>
        </div>
      `;
      card.addEventListener("click", () => {
        selectedUlt = sp.id;
        renderLoadout();
      });
      ultList.appendChild(card);
    }
  }

  confirmBtn.onclick = () => {
    if (selectedBasic.length !== 3 || !selectedUlt) return;
    dlg.close("confirm");
    onConfirm([...selectedBasic, selectedUlt]);
  };
  cancelBtn.onclick = () => {
    dlg.close("cancel");
    if (onBack) onBack();
    else document.getElementById("title-dialog").showModal();
  };

  renderLoadout();
  dlg.showModal();
}

  document.getElementById("btn-start-adventure").addEventListener("click", () => {
    document.getElementById("panel-stats").classList.remove("mobile-open");
    document.getElementById("panel-bag").classList.remove("mobile-open");
    document.getElementById("title-dialog").close("start");
    const startHeroAndSkills = () => {
      openHeroDialog((chosenHero) => {
        openLoadoutDialog(
          (chosenLoadout) => {
            createNewRun(getEnteredHeroName(), getSelectedDifficulty(), chosenLoadout, chosenHero);
          },
          startHeroAndSkills
        );
      });
    };
    startHeroAndSkills();
  });
  document.getElementById("btn-end-sanctum").addEventListener("click", () => {
    document.getElementById("end-dialog").close("sanctum");
    renderTitleSanctum();
    document.getElementById("title-dialog").showModal();
  });

  const pauseAll = () => {
    saveRun();
    keys.clear();
    touchMove.active = false;
    touchMove.x = 0;
    touchMove.y = 0;
    bgm.pauseForBackground();
    if (sfx.ctx && sfx.ctx.state === "running") {
      sfx.ctx.suspend().catch(() => {});
    }
  };
  const resumeAll = () => {
    lastFrameTime = performance.now();
    bgm.resumeFromBackground();
    if (sfx.ctx && sfx.ctx.state === "suspended") {
      sfx.ctx.resume().catch(() => {});
    }
  };

  window.addEventListener("pagehide", pauseAll);
  window.addEventListener("blur", pauseAll);
  window.addEventListener("focus", () => {
    if (!document.hidden) resumeAll();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pauseAll();
    else resumeAll();
  });

  // Pause simulation when canvas is off-screen
  const canvasFrame = document.querySelector(".canvas-frame");
  if (canvasFrame) {
    canvasFrame.addEventListener("contentvisibilityautostatechange", (event) => {
      isCanvasVisible = !event.skipped;
      if (isCanvasVisible) lastFrameTime = performance.now();
    });
  }

  for (const dlg of document.querySelectorAll("dialog")) {
    dlg.addEventListener("close", () => {
      dlg.returnValue = "";
      keys.clear();
      lastFrameTime = performance.now();
    });
  }
  if (!("closedBy" in HTMLDialogElement.prototype)) {
    const outside = (e, dialog) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
      let pressedOutside = false;
      dialog.addEventListener("pointerdown", (e) => {
        pressedOutside = outside(e, dialog);
      });
      dialog.addEventListener("pointerup", (e) => {
        if (pressedOutside && outside(e, dialog)) dialog.close();
      });
    }
  }
}

async function init() {
  let deferredInstallPrompt = null;
  const mobileAppBox = document.getElementById("menu-mobile-app-box");
  const mobileAppHint = document.getElementById("menu-mobile-app-hint");
  const installBtn = document.getElementById("btn-install-pwa");
  const isNativeApk = Boolean(window.Capacitor || window.AndroidApp);
  const isStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;

  if (mobileAppBox && !isNativeApk) {
    mobileAppBox.hidden = false;
    if (installBtn && isStandalone) {
      installBtn.hidden = true;
    }
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (installBtn && !isNativeApk) {
      installBtn.hidden = false;
    }
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    if (installBtn) installBtn.hidden = true;
    if (mobileAppHint) mobileAppHint.textContent = "App installed! Launch from your home screen.";
  });

  if (installBtn) {
    installBtn.addEventListener("click", async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice.catch(() => null);
        deferredInstallPrompt = null;
        if (choice?.outcome === "accepted" && mobileAppHint) {
          mobileAppHint.textContent = "Installing Chronicles of the Shattered Crown...";
        }
        return;
      }
      const isIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent || "");
      if (mobileAppHint) {
        mobileAppHint.textContent = isIOS
          ? "On iPhone/iPad: tap Share, then choose 'Add to Home Screen'."
          : "Open browser menu -> 'Install app' / 'Add to Home Screen', or download the Android APK.";
      }
    });
  }

  if ("serviceWorker" in navigator) {
    if (window.Capacitor) {
      // Native APK already bundles all assets offline; clear any stale SW cache
      navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister())).catch(() => {});
      if ("caches" in window) {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
      }
    } else {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }
  syncSettingsUI();

  const studioIntro = document.getElementById("studio-intro");
  const loadingScreen = document.getElementById("loading-screen");

  // 1. Show JAN GAMEDEV intro animation (click/tap skips early)
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (studioIntro) studioIntro.hidden = true;
      resolve();
    };
    const timer = setTimeout(finish, 2100);
    if (studioIntro) {
      studioIntro.addEventListener(
        "click",
        () => {
          clearTimeout(timer);
          finish();
        },
        { once: true }
      );
    }
  });

  // 2. Show game loading screen & smooth 3.8s loading bar while preloading assets
  if (loadingScreen) loadingScreen.hidden = false;
  const barFill = document.getElementById("loading-bar-fill");
  const statusEl = document.getElementById("loading-status");
  let assetProgress = 0;
  let assetsReady = false;
  let loadedCount = 0;
  let totalCount = 1;

  const assetsPromise = loadAllAssets((loaded, total) => {
    loadedCount = loaded;
    totalCount = total;
    assetProgress = loaded / total;
  }).then((res) => {
    assetsReady = true;
    return res;
  });

  const minLoadMs = 3800;
  const loadStart = performance.now();
  await new Promise((resolve) => {
    function step(now) {
      const timeProgress = Math.min(1, (now - loadStart) / minLoadMs);
      const displayPct = Math.round(Math.min(timeProgress, assetProgress || timeProgress * 0.9) * 100);
      if (barFill) barFill.style.width = `${displayPct}%`;
      if (statusEl) {
        statusEl.textContent =
          displayPct < 100
            ? `Loading realms & sprites... (${loadedCount}/${totalCount}) ${displayPct}%`
            : "Entering Oakhaven Bastion...";
      }
      if (timeProgress >= 1 && assetsReady) {
        if (barFill) barFill.style.width = "100%";
        resolve();
      } else {
        requestAnimationFrame(step);
      }
    }
    requestAnimationFrame(step);
  });

  assets = await assetsPromise;

  try {
    setupControls();
    const saved = loadSavedRun();
    if (saved) {
      try {
        restoreRun(saved);
      } catch (err) {
        console.warn("Failed to restore saved run, starting fresh:", err);
        clearSavedRun();
        createNewRun(meta.heroName || "Sir Aldric", "normal", DEFAULT_LOADOUT, "paladin", true);
      }
    } else {
      createNewRun(meta.heroName || "Sir Aldric", "normal", DEFAULT_LOADOUT, "paladin", true);
    }
  } catch (err) {
    console.error("Init run error:", err);
  }

  await new Promise((r) => setTimeout(r, 200));
  if (loadingScreen) loadingScreen.hidden = true;
  showMainMenu();
  requestAnimationFrame(render);
}

init();
