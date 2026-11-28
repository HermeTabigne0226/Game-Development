import { DEFAULT_LOADOUT, DIFFICULTIES, EQUIPMENT_SETS, HERO_CLASSES, RARITIES, RELICS, SPELLS } from "./data.js";
import { MAP_H, MAP_W } from "./dungeon.js";

export const TILE_SIZE = 32;
export const DEFAULT_MAX_INVENTORY = 15;
export const SAVE_KEY = "shattered_crown_meta_v1";
export const RUN_SAVE_KEY = "shattered_crown_run_v1";

export const canvas = document.getElementById("game-canvas");
export const ctx = canvas.getContext("2d");
canvas.width = MAP_W * TILE_SIZE;
canvas.height = MAP_H * TILE_SIZE;

export const portraitCanvas = document.getElementById("hero-portrait");
export const portraitCtx = portraitCanvas.getContext("2d");
export const mobilePortraitCanvas = document.getElementById("mobile-portrait");
export const mobilePortraitCtx = mobilePortraitCanvas ? mobilePortraitCanvas.getContext("2d") : null;
export const storyPortraitCanvas = document.getElementById("story-portrait");
export const storyPortraitCtx = storyPortraitCanvas.getContext("2d");

export const keys = new Set();
export const mouse = { x: null, y: null, inside: false, down: false };
export const touchMove = { x: 0, y: 0, active: false };
export const touchAim = { x: 0, y: 0, angle: 0, active: false };
export const camera = { x: 0, y: 0 };

export const runtime = {
  assets: {},
  animFrame: 0,
  animTimer: 0,
  lastFrameTime: 0,
  isCanvasVisible: true,
  meta: null,
  state: null,
  uiDirty: true,
};

export function loadMeta() {
  let loaded = null;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) loaded = JSON.parse(raw);
  } catch {}
  const base = {
    heroName: "Sir Aldric",
    difficulty: "normal",
    soulShards: 0,
    upgrades: { vitality: 0, might: 0, arcane: 0, provisions: 0 },
    soulForge: { relic_pouch: 0, gold_reserve: 0, forge_mastery: 0, scholar_tome: 0 },
    unlockedCodex: ["crown"],
    bestiary: {},
    runHistory: [],
    bestFloor: 1,
    endlessBestFloor: 0,
    victories: 0,
    lastSeenPatchVersion: "",
    settings: { sfxLevel: "high", musicLevel: "low", screenShake: true, showPerf: true, mobileButtonSize: "small", floatingText: "all" },
  };
  if (!loaded || typeof loaded !== "object") return base;
  return {
    ...base,
    ...loaded,
    upgrades: { ...base.upgrades, ...(loaded.upgrades || {}) },
    soulForge: { ...base.soulForge, ...(loaded.soulForge || {}) },
    unlockedCodex: Array.isArray(loaded.unlockedCodex) ? loaded.unlockedCodex : ["crown"],
    bestiary: loaded.bestiary && typeof loaded.bestiary === "object" ? loaded.bestiary : {},
    runHistory: Array.isArray(loaded.runHistory) ? loaded.runHistory : [],
    settings: { ...base.settings, ...(loaded.settings || {}) },
  };
}

export function saveMeta(nextMeta = runtime.meta) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(nextMeta));
  } catch {}
}

runtime.meta = loadMeta();

export function saveRun() {
  const s = runtime.state;
  if (!s || s.isPvp || s.runEnded || s.dyingTimer > 0 || !s.startedByUser) return;
  try {
    const snapshot = {
      floor: s.floor,
      difficulty: s.difficulty,
      isEndless: Boolean(s.isEndless),
      bossFightStarted: s.bossFightStarted,
      hasBossKey: s.hasBossKey,
      bossKeyDrop: s.bossKeyDrop,
      level: s.level,
      elapsed: s.elapsed,
      kills: s.kills,
      seenBosses: Array.from(s.seenBosses),
      shardsCollected: s.shardsCollected,
      spellCooldowns: s.spellCooldowns,
      player: s.player,
    };
    localStorage.setItem(RUN_SAVE_KEY, JSON.stringify(snapshot));
  } catch {}
}

export function loadSavedRun() {
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

export function clearSavedRun() {
  try {
    localStorage.removeItem(RUN_SAVE_KEY);
  } catch {}
}

export function isMobileLayout() {
  return window.innerWidth <= 960 || window.matchMedia("(pointer: coarse)").matches;
}

export function clientToTile(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const px = ((clientX - rect.left) / rect.width) * canvas.width + camera.x;
  const py = ((clientY - rect.top) / rect.height) * canvas.height + camera.y;
  return { x: px / TILE_SIZE, y: py / TILE_SIZE };
}

export function getEnteredHeroName() {
  const input = document.getElementById("hero-name-input");
  const raw = input ? input.value.trim() : "";
  const name = raw || runtime.meta.heroName || "Sir Aldric";
  runtime.meta.heroName = name;
  saveMeta();
  return name;
}

export function getSelectedDifficulty() {
  const sel = document.getElementById("difficulty-select");
  const id = sel ? sel.value : runtime.meta.difficulty || "normal";
  runtime.meta.difficulty = DIFFICULTIES[id] ? id : "normal";
  saveMeta();
  return runtime.meta.difficulty;
}

export function getActiveSpells(player = runtime.state?.player) {
  const ids = Array.isArray(player?.loadout) && player.loadout.length === 4 ? player.loadout : DEFAULT_LOADOUT;
  return ids
    .map((id, idx) => {
      const sp = SPELLS.find((s) => s.id === id);
      return sp ? { ...sp, hotkey: String(idx + 1) } : null;
    })
    .filter(Boolean);
}

export function hasRelic(id, p = runtime.state?.player) {
  return Array.isArray(p?.relics) && p.relics.includes(id);
}

export function grantRandomRelic(p = runtime.state?.player) {
  if (!p) return null;
  if (!Array.isArray(p.relics)) p.relics = [];
  const pool = Object.values(RELICS).filter((r) => !p.relics.includes(r.id));
  if (pool.length === 0) return null;
  const picked = pool[Math.floor(Math.random() * pool.length)];
  p.relics.push(picked.id);
  runtime.uiDirty = true;
  return picked;
}

export function getActiveSetBonuses(p = runtime.state?.player) {
  const counts = {};
  if (p?.equipment) {
    for (const item of Object.values(p.equipment)) {
      if (item?.setId) counts[item.setId] = (counts[item.setId] || 0) + 1;
    }
  }
  const totals = { atk: 0, def: 0, crit: 0, maxHp: 0, maxMp: 0, speed: 0 };
  const passives = new Set();
  const activeLabels = [];
  for (const [setId, count] of Object.entries(counts)) {
    const def = EQUIPMENT_SETS[setId];
    if (!def) continue;
    let best = null;
    for (const b of def.bonuses) {
      if (count >= b.count) {
        best = b;
        if (b.passiveId) passives.add(b.passiveId);
      }
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
  return { counts, totals, passives, activeLabels };
}

export function getPlayerStats(p = runtime.state?.player) {
  if (!p) return { atk: 7, def: 2, crit: 10, maxHp: 42, maxMp: 20, moveSpeed: 4.5, setPassives: new Set() };
  const resolvedId = p.heroClass === "paladin" ? "gilded" : p.heroClass;
  const cls = HERO_CLASSES[resolvedId] || HERO_CLASSES.gilded;
  const tempDefBonus = p.tempDef || 0;
  let atk = p.baseAtk + (p.tempAtk || 0);
  let def = p.baseDef + tempDefBonus;
  let crit = p.baseCrit;
  let bonusHp = 0;
  let bonusMp = 0;
  let speedBonus = cls.bonusSpeed || 0;

  for (const item of Object.values(p.equipment || {})) {
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

  if (hasRelic("greedy_idol", p)) {
    atk += Math.min(10, Math.floor((p.gold || 0) / 100));
  }

  const critCap = runtime.state?.isPvp ? 75 : 55;
  return {
    atk,
    def,
    crit: Math.min(critCap, crit),
    maxHp: p.maxHp + bonusHp,
    maxMp: p.maxMp + bonusMp,
    moveSpeed: 4.5 + speedBonus + (p.hasteTimer > 0 ? (p.hasteBonus || 0.7) : 0),
    setPassives: sets.passives,
  };
}

export function addLog(text, kind = "info") {
  const logEl = document.getElementById("combat-log");
  if (!logEl) return;
  const div = document.createElement("div");
  div.className = `log-entry ${kind}`;
  div.textContent = text;
  logEl.prepend(div);
  while (logEl.children.length > 60) logEl.removeChild(logEl.lastChild);
}

export function clearLog() {
  const logEl = document.getElementById("combat-log");
  if (logEl) logEl.innerHTML = "";
}

export function showFloorBanner(text) {
  const banner = document.getElementById("floor-banner");
  if (!banner) return;
  banner.textContent = text;
  banner.classList.add("visible");
  clearTimeout(showFloorBanner._t);
  showFloorBanner._t = setTimeout(() => banner.classList.remove("visible"), 2600);
}

export function addFloat(tx, ty, text, color = "#fff", kind = null) {
  const s = runtime.state;
  if (!s) return;
  const mode = runtime.meta?.settings?.floatingText || "all";
  if (mode === "off") return;
  const resolvedKind = kind || (/^[+-]?\d+!?$/.test(String(text).trim()) ? "damage" : "skill");
  if (mode === "damage" && resolvedKind !== "damage") return;
  if (s.floatingTexts.length >= 18) s.floatingTexts.shift();
  const x = tx * TILE_SIZE;
  let y = ty * TILE_SIZE - 10;
  for (let pass = 0; pass < 4; pass++) {
    if (s.floatingTexts.some((ft) => Math.abs(ft.x - x) < 64 && Math.abs(ft.y - y) < 14)) {
      y -= 15;
    } else {
      break;
    }
  }
  s.floatingTexts.push({
    x,
    y,
    vy: resolvedKind === "skill" ? -22 : -28,
    text,
    color,
    kind: resolvedKind,
    life: 0.78,
    maxLife: 0.78,
  });
}

export function spawnBurst(tx, ty, color, count = 10, speedScale = 1) {
  const s = runtime.state;
  if (!s) return;
  const cx = tx * TILE_SIZE;
  const cy = ty * TILE_SIZE;
  const maxParticles = 80;
  if (s.particles.length >= maxParticles) {
    s.particles.splice(0, s.particles.length - maxParticles + Math.min(count, 16));
  }
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = (28 + Math.random() * 72) * speedScale;
    const life = 0.32 + Math.random() * 0.28;
    s.particles.push({
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

export function spawnRing(tx, ty, maxRadiusPx, color, duration = 0.35, { delay = 0, lineWidth = 2.5 } = {}) {
  const s = runtime.state;
  if (!s) return;
  if (s.rings.length >= 30) s.rings.shift();
  s.rings.push({
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

export function spawnGroundDecal(
  tx,
  ty,
  spriteKey,
  sizePx,
  duration = 0.65,
  { angle = 0, spin = 0, scaleStart = 1, scaleEnd = 1 } = {}
) {
  const s = runtime.state;
  if (!s) return;
  if (!Array.isArray(s.groundDecals)) s.groundDecals = [];
  if (s.groundDecals.length >= 24) s.groundDecals.shift();
  s.groundDecals.push({
    x: tx * TILE_SIZE,
    y: ty * TILE_SIZE,
    spriteKey,
    sizePx,
    life: duration,
    maxLife: duration,
    angle,
    spin,
    scaleStart,
    scaleEnd,
  });
}

export function spawnVfxAnim(
  tx,
  ty,
  sheetKey,
  sizePx = 64,
  duration = 0.55,
  { angle = 0, flipX = false, scaleStart = 1, scaleEnd = 1, anchorX = 0.5, anchorY = 0.5, alpha = 1 } = {}
) {
  const s = runtime.state;
  if (!s) return;
  if (!Array.isArray(s.vfxAnims)) s.vfxAnims = [];
  if (s.vfxAnims.length >= 28) s.vfxAnims.shift();
  s.vfxAnims.push({
    x: tx * TILE_SIZE,
    y: ty * TILE_SIZE,
    sheetKey,
    sizePx,
    life: duration,
    maxLife: duration,
    angle,
    flipX: Boolean(flipX),
    scaleStart,
    scaleEnd,
    anchorX,
    anchorY,
    alpha,
  });
}

export function getWeaponCategory(weapon) {
  if (!weapon) return null;
  if (weapon.weaponType === "bow") return "bow";
  if (weapon.weaponType === "wand" || weapon.weaponType === "staff") return "wand";
  return "melee";
}

export function getSubWeaponCategory(sub) {
  if (!sub) return null;
  if (sub.subType === "arrows") return "bow";
  if (sub.subType === "book") return "wand";
  return "melee";
}

export function isWeaponSubPairValid(weapon, sub) {
  if (!weapon || !sub) return true;
  return getWeaponCategory(weapon) === getSubWeaponCategory(sub);
}

export function getRequiredClassForItem(item) {
  if (!item || !item.slot) return null;
  if (item.heroClass) return item.heroClass;
  if (item.weaponType === "wand" || item.weaponType === "staff" || item.subType === "book") return "mage";
  if (item.weaponType === "melee" || item.subType === "shield") return "gilded";
  if (item.weaponType === "bow" || item.subType === "arrows") return "ranger";
  if (item.setId === "astral" || item.setId === "sunfire") return "mage";
  if (item.setId === "vanguard" || item.setId === "voidbreaker") return "gilded";
  if (item.setId === "ranger") return "ranger";
  return null;
}

export function isItemAllowedForClass(item, heroClass = runtime.state?.player?.heroClass) {
  const req = getRequiredClassForItem(item);
  if (!req) return true;
  const resolved = heroClass === "paladin" ? "gilded" : (heroClass || "gilded");
  return req === resolved;
}

export function isBetterEquipmentItem(item, p = runtime.state?.player) {
  if (!item || !item.slot || !p) return false;
  if (!isItemAllowedForClass(item, p.heroClass)) return false;
  if (item.slot === "subweapon" && p.equipment?.weapon && !isWeaponSubPairValid(p.equipment.weapon, item)) {
    return false;
  }
  const currentInSlot = p.equipment?.[item.slot] || null;
  if (!currentInSlot) return true;

  const nextEquipment = { ...p.equipment, [item.slot]: item };
  if (item.slot === "weapon" && nextEquipment.subweapon && !isWeaponSubPairValid(item, nextEquipment.subweapon)) {
    nextEquipment.subweapon = null;
  }
  const curStats = getPlayerStats(p);
  const nextStats = getPlayerStats({ ...p, equipment: nextEquipment });
  const score = (st) => (st.atk || 0) * 3 + (st.def || 0) * 2.5 + (st.crit || 0) * 0.8 + (st.maxHp || 0) * 0.35 + (st.maxMp || 0) * 0.3;
  return score(nextStats) > score(curStats) + 0.05;
}

export function getRarityInfo(item) {
  const key =
    item?.rarity ||
    (item?.tier === 3 ? "legendary" : item?.tier === 2 ? "unique" : item?.setId ? "rare" : "common");
  return RARITIES[key] || RARITIES.common;
}

export function getMaxInventory(p = runtime.state?.player) {
  return p?.maxInventory || DEFAULT_MAX_INVENTORY;
}

export function getDashMpCost(p = runtime.state?.player) {
  const discount = Math.min(3, Math.max(0, p?.dashMpDiscount || 0));
  return Math.max(7, 10 - discount);
}

export function getDashCooldown(p = runtime.state?.player) {
  const discount = Math.min(0.45, Math.max(0, p?.dashCdDiscount || 0));
  return Math.max(0.6, 1.05 - discount);
}

export function isBlockedAt(tx, ty) {
  const s = runtime.state;
  if (!s?.level) return true;
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
  if (s.level.grid[ty][tx] === 0) return true;
  return s.level.props.some((pr) => pr.solid && pr.x === tx && pr.y === ty);
}

export function distPointToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const abSq = abx * abx + aby * aby;
  if (abSq <= 0.00001) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / abSq));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

export function canOccupy(cx, cy, radius) {
  for (const [ox, oy] of [
    [-radius, -radius],
    [radius, -radius],
    [-radius, radius],
    [radius, radius],
  ]) {
    if (isBlockedAt(Math.floor(cx + ox), Math.floor(cy + oy))) return false;
  }
  return true;
}

export function moveWithSlide(entity, dx, dy, radius) {
  if (canOccupy(entity.x + dx, entity.y, radius)) entity.x += dx;
  if (canOccupy(entity.x, entity.y + dy, radius)) entity.y += dy;
}

export function addItemToInventory(itemTpl, qty = itemTpl?.qty || 1, { silentFull = false } = {}) {
  const inv = runtime.state.player.inventory;
  const maxInv = getMaxInventory();
  if (itemTpl.type === "consumable") {
    const existing = inv.find((i) => i.id === itemTpl.id);
    if (existing) {
      existing.qty += qty;
      runtime.uiDirty = true;
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
  runtime.uiDirty = true;
  return true;
}

export function spawnGroundItem(itemTpl, x, y, options = {}) {
  const s = runtime.state;
  if (!s?.level) return null;
  if (!Array.isArray(s.level.groundItems)) s.level.groundItems = [];
  const { requireLeave = false, fullMsgCd = 0, qty = itemTpl?.qty || 1 } = options;

  let spawnX = x;
  let spawnY = y;
  const existing = s.level.groundItems;
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
  s.level.groundItems.push(entry);
  return entry;
}

export function giveOrDropItem(itemTpl, x, y, options = {}) {
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

export function dropInventoryItem(index, amount = 1) {
  const s = runtime.state;
  if (!s || s.runEnded || s.dyingTimer > 0) return;
  const p = s.player;
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
  const label = dropQty > 1 ? `${dropped.name} (x${dropQty})` : dropped.name;
  addFloat(p.x, p.y - 0.3, `Dropped ${label}`, "#cbd5e1");
  addLog(`Dropped ${label} on the ground.`, "info");
  runtime.uiDirty = true;
  saveRun();
}
