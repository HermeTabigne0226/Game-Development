import { sfx } from "./audio.js";
import { drawSheetFrame } from "./assets.js";
import { CLASS_DEFAULT_LOADOUTS, DEFAULT_LOADOUT, HERO_CLASSES, ITEMS, SPELLS } from "./data.js";
import { MAP_H, MAP_W, TILE, computeFOV } from "./dungeon.js";
import {
  addFloat,
  addLog,
  getActiveSpells,
  getPlayerStats,
  runtime,
  saveMeta,
  showFloorBanner,
  spawnBurst,
  spawnGroundDecal,
  spawnRing,
  spawnVfxAnim,
  TILE_SIZE,
} from "./state.js";

export const PVP_SERVER_URL_KEY = "shattered_crown_pvp_server_v1";
export const PVP_LAN_URL_KEY = "shattered_crown_pvp_lan_url_v1";
export const PVP_MODE_KEY = "shattered_crown_pvp_mode_v1";
export const DEFAULT_PVP_SERVER_URL = "wss://game-development-v1fo.onrender.com/ws";

export const PVP_MAPS = [
  {
    id: 0,
    name: "Goblin Catacombs Pit",
    subtitle: "Stone Pillars & Power Vials",
    splash: "assets/generated/maps/goblin_catacombs_pit_1795795312387.jpg",
    floorTileIdx: 0,
    accentTileIdx: 0,
    w: 22,
    h: 16,
    desc: "Classic 4-pillar stone chamber with breakable crates and 15s arena power-up vials.",
  },
  {
    id: 1,
    name: "Sunken Foundry Crucible",
    subtitle: "Forge Lanes & Arena Vials",
    splash: "assets/generated/maps/sunken_foundry_crucible_1795795321692.jpg",
    floorTileIdx: 1,
    accentTileIdx: 0,
    w: 24,
    h: 16,
    desc: "Gilded metal arena with forge choke points and rotating top/center/bottom power-up vials.",
  },
  {
    id: 2,
    name: "Abyssal Sanctum Arena",
    subtitle: "Open Void & Power Vials",
    splash: "assets/generated/maps/abyssal_sanctum_arena_1795795331171.jpg",
    floorTileIdx: 3,
    accentTileIdx: 0,
    w: 26,
    h: 18,
    desc: "Spacious dark obsidian sanctum with staggered cover obelisks and 15s power-up vials.",
  },
  {
    id: 3,
    name: "Crimson Courtyard",
    subtitle: "3-Lane Fortress & Center Vial",
    splash: "assets/generated/maps/crimson_courtyard_1795795340338.jpg",
    floorTileIdx: 0,
    accentTileIdx: 0,
    w: 24,
    h: 16,
    desc: "Bastion courtyard split into 3 tactical lanes contesting 15s arena power-up vials.",
  },
];

export const PVP_POWERUP_TYPES = [
  { kind: "hp", name: "Vitality Vial", color: "#ef4444", glow: "rgba(239, 68, 68, 0.36)" },
  { kind: "regen", name: "Regen Vial", color: "#22c55e", glow: "rgba(34, 197, 94, 0.36)", label: "2.5%/s REGEN · 5s" },
  { kind: "damage", name: "Fury Vial", color: "#facc15", glow: "rgba(250, 204, 21, 0.38)", label: "+30% DMG · 7s" },
  { kind: "haste", name: "Haste Vial", color: "#a855f7", glow: "rgba(168, 85, 247, 0.38)", label: "+30% SPEED · 6s" },
  { kind: "ward", name: "Aegis Vial", color: "#38bdf8", glow: "rgba(56, 189, 248, 0.36)", label: "+8 DEF · -1.5s CD" },
];

export function getPvpMode() {
  try {
    const saved = localStorage.getItem(PVP_MODE_KEY);
    if (saved === "lan" || saved === "network") return saved;
  } catch {}
  const host = window.location.hostname || "";
  const proto = window.location.protocol;
  const isLocalHttp = proto === "http:" && host;
  return isLocalHttp ? "lan" : "network";
}

export function setPvpMode(mode) {
  try {
    localStorage.setItem(PVP_MODE_KEY, mode === "lan" ? "lan" : "network");
  } catch {}
}

export function getDefaultLanUrl() {
  const host = window.location.hostname || "";
  const proto = window.location.protocol;
  if (proto === "http:" && window.location.host) {
    return `ws://${window.location.host}/ws`;
  }
  try {
    if (window.AndroidApp?.getLanStatus) {
      const st = JSON.parse(window.AndroidApp.getLanStatus());
      if (st?.running) return "ws://127.0.0.1:8080/ws";
    }
    if (window.AndroidApp?.getLanIp) {
      const ip = String(window.AndroidApp.getLanIp() || "").trim();
      if (ip && ip !== "127.0.0.1") return `ws://${ip}:8080/ws`;
    }
  } catch {}
  return "ws://localhost:8080/ws";
}

export function getSavedLanUrl() {
  try {
    const saved = localStorage.getItem(PVP_LAN_URL_KEY);
    if (saved) return saved;
  } catch {}
  return getDefaultLanUrl();
}

export function setSavedLanUrl(url) {
  try {
    localStorage.setItem(PVP_LAN_URL_KEY, String(url || "").trim());
  } catch {}
}

export function getSavedPvpServerUrl() {
  const host = window.location.hostname || "";
  const proto = window.location.protocol;
  const isNativeOrVercel =
    proto === "capacitor:" ||
    proto === "file:" ||
    Boolean(window.Capacitor || window.AndroidApp) ||
    host.endsWith("vercel.app") ||
    (proto === "https:" && host === "localhost");
  try {
    const saved = localStorage.getItem(PVP_SERVER_URL_KEY);
    if (saved) {
      const staleLocal = isNativeOrVercel && /^ws:\/\/(localhost|127\.0\.0\.1|[^/:]+\.vercel\.app)(:|\/|$)/i.test(saved);
      const blockedMixed = proto === "https:" && !window.Capacitor && !window.AndroidApp && host !== "localhost" && saved.startsWith("ws://");
      if (!staleLocal && !blockedMixed) return saved;
    }
  } catch {}
  if (!isNativeOrVercel && window.location.host) {
    const wsProto = proto === "https:" ? "wss:" : "ws:";
    return `${wsProto}//${window.location.host}/ws`;
  }
  return DEFAULT_PVP_SERVER_URL;
}

export function setSavedPvpServerUrl(url) {
  try {
    localStorage.setItem(PVP_SERVER_URL_KEY, String(url || "").trim());
  } catch {}
}

export function normalizeWsUrl(raw, { defaultLan = false } = {}) {
  let u = String(raw || "").trim();
  if (!u) return "";
  if (u.startsWith("https://")) u = `wss://${u.slice(8)}`;
  else if (u.startsWith("http://")) u = `ws://${u.slice(7)}`;
  else if (!u.startsWith("ws://") && !u.startsWith("wss://")) {
    const bareHost = u.split("/")[0];
    const looksLocal =
      defaultLan ||
      /^(localhost|127\.0\.0\.1|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?$/i.test(bareHost);
    if (looksLocal) {
      const hasPort = /:\d+$/.test(bareHost);
      u = hasPort ? `ws://${u}` : `ws://${bareHost}:8080${u.slice(bareHost.length)}`;
    } else {
      u = `wss://${u}`;
    }
  }
  u = u.replace(/\/+$/, "");
  if (!u.endsWith("/ws")) u += "/ws";
  return u;
}

export function buildPvpArenaLevel(mapId = 0) {
  const cfg = PVP_MAPS[Math.max(0, Math.min(PVP_MAPS.length - 1, Number(mapId) || 0))];
  const grid = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(TILE.WALL));
  const explored = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(false));
  const visible = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(false));

  const x0 = Math.floor((MAP_W - cfg.w) / 2);
  const y0 = Math.floor((MAP_H - cfg.h) / 2);
  const x1 = x0 + cfg.w - 1;
  const y1 = y0 + cfg.h - 1;
  const cx = Math.floor((x0 + x1) / 2);
  const cy = Math.floor((y0 + y1) / 2);

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      grid[y][x] = TILE.FLOOR;
      explored[y][x] = true;
      visible[y][x] = false;
    }
  }
  // Reveal 1-tile outer wall perimeter around arena (dimmed until within vision radius)
  for (let y = Math.max(0, y0 - 1); y <= Math.min(MAP_H - 1, y1 + 1); y++) {
    for (let x = Math.max(0, x0 - 1); x <= Math.min(MAP_W - 1, x1 + 1); x++) {
      explored[y][x] = true;
      visible[y][x] = false;
    }
  }

  const setWall = (wx, wy) => {
    if (wx > x0 && wx < x1 && wy > y0 && wy < y1) {
      grid[wy][wx] = TILE.WALL;
    }
  };

  const props = [];
  const addProp = (prop) => {
    if (grid[prop.y]?.[prop.x] === TILE.FLOOR) props.push(prop);
  };

  // Perimeter corner torches
  addProp({ kind: "torch", x: x0, y: y0, solid: false });
  addProp({ kind: "torch", x: x1, y: y0, solid: false });
  addProp({ kind: "torch", x: x0, y: y1, solid: false });
  addProp({ kind: "torch", x: x1, y: y1, solid: false });

  let powerupSpots = [
    { x: cx, y: cy },
    { x: cx, y: y0 + 2 },
    { x: cx, y: y1 - 2 },
  ];

  if (cfg.id === 0) {
    // Goblin Catacombs Pit: 4 symmetrical 2x2 stone pillars + power-up vial spots
    for (const [ox, oy] of [[-4, -3], [3, -3], [-4, 2], [3, 2]]) {
      setWall(cx + ox, cy + oy);
      setWall(cx + ox + 1, cy + oy);
      setWall(cx + ox, cy + oy + 1);
      setWall(cx + ox + 1, cy + oy + 1);
    }
    addProp({ kind: "crate", x: cx, y: y0 + 2, solid: true, broken: false });
    addProp({ kind: "barrel", x: cx, y: y1 - 2, solid: true, broken: false });
    powerupSpots = [
      { x: cx, y: cy },
      { x: cx, y: y0 + 3 },
      { x: cx, y: y1 - 3 },
    ];
  } else if (cfg.id === 1) {
    // Sunken Foundry Crucible: staggered forge walls + rotating arena power-up vials
    for (const [ox, oy] of [[-5, -2], [-5, -1], [-5, 1], [-5, 2], [5, -2], [5, -1], [5, 1], [5, 2]]) {
      setWall(cx + ox, cy + oy);
    }
    setWall(cx - 1, cy - 4);
    setWall(cx + 1, cy + 4);
    addProp({ kind: "barrel", x: cx - 2, y: cy, solid: true, broken: false });
    addProp({ kind: "barrel", x: cx + 2, y: cy, solid: true, broken: false });
  } else if (cfg.id === 2) {
    // Abyssal Sanctum Arena: open kiting grounds + diagonal void obelisks + power-up vials
    for (const [ox, oy] of [[-6, -4], [6, -4], [-6, 4], [6, 4], [-3, 0], [3, 0], [0, -4], [0, 4]]) {
      setWall(cx + ox, cy + oy);
    }
    addProp({ kind: "urn", x: cx - 5, y: cy, solid: true, broken: false });
    addProp({ kind: "urn", x: cx + 5, y: cy, solid: true, broken: false });
  } else {
    // Crimson Courtyard: 3 lanes guarded by horizontal bastion walls & power-up vials
    for (let dx = -4; dx <= -2; dx++) {
      setWall(cx + dx, cy - 3);
      setWall(cx + dx, cy + 3);
    }
    for (let dx = 2; dx <= 4; dx++) {
      setWall(cx + dx, cy - 3);
      setWall(cx + dx, cy + 3);
    }
    addProp({ kind: "crate", x: cx - 6, y: cy - 1, solid: true, broken: false });
    addProp({ kind: "crate", x: cx + 6, y: cy + 1, solid: true, broken: false });
  }

  const spawns = [
    { x: x0 + 2, y: cy },
    { x: x1 - 2, y: cy },
  ];

  return {
    floor: 1,
    isPvp: true,
    pvpMap: cfg,
    act: { id: cfg.id + 1, name: `PvP Arena — ${cfg.name}`, floorTileIdx: cfg.floorTileIdx, accentTileIdx: cfg.accentTileIdx },
    isBossFloor: false,
    grid,
    explored,
    visible,
    rooms: [{ id: 0, x: x0, y: y0, w: cfg.w, h: cfg.h, cx, cy }],
    playerStart: spawns[0],
    pvpSpawns: spawns,
    pvpPowerupSpots: powerupSpots,
    stairsPos: null,
    props,
    traps: [],
    enemies: [],
    npcs: [],
    shops: [],
    groundItems: [],
  };
}

export function buildBalancedPvpPlayer(heroName, heroClassId, loadoutIds) {
  const safeId = heroClassId === "paladin" ? "gilded" : heroClassId;
  const cls = HERO_CLASSES[safeId] || HERO_CLASSES.gilded;
  const defaultSet = CLASS_DEFAULT_LOADOUTS[cls.id] || DEFAULT_LOADOUT;
  const chosen = Array.isArray(loadoutIds) && loadoutIds.length >= 4 ? [...loadoutIds] : [...defaultSet];
  const skillRanks = Object.fromEntries(SPELLS.map((sp) => [sp.id, 0]));
  for (const id of chosen) {
    const sp = SPELLS.find((x) => x.id === id);
    if (!sp) continue;
    skillRanks[id] = sp.isUltimate ? 1 : 2;
  }

  const clone = (it) => (it ? { ...it } : null);
  let equipment;
  let baseAtk;
  let baseDef;
  let baseCrit;
  if (cls.id === "ranger") {
    equipment = {
      weapon: clone(ITEMS.emerald_recurve),
      subweapon: clone(ITEMS.hunter_arrows),
      armor: clone(ITEMS.ranger_tunic),
      helmet: clone(ITEMS.ranger_hood),
      boots: clone(ITEMS.ranger_boots),
      ring: clone(ITEMS.ember_ring),
    };
    baseAtk = 6;
    baseDef = 9;
    baseCrit = 0;
  } else if (cls.id === "mage") {
    equipment = {
      weapon: clone(ITEMS.frost_wand),
      subweapon: clone(ITEMS.apprentice_tome),
      armor: clone(ITEMS.astral_robes),
      helmet: clone(ITEMS.steel_helm),
      boots: clone(ITEMS.swift_boots),
      ring: clone(ITEMS.astral_ring),
    };
    baseAtk = 3;
    baseDef = 5;
    baseCrit = 7;
  } else {
    equipment = {
      weapon: clone(ITEMS.vanguard_blade),
      subweapon: clone(ITEMS.oak_shield),
      armor: clone(ITEMS.plate_armor),
      helmet: clone(ITEMS.steel_helm),
      boots: clone(ITEMS.swift_boots),
      ring: clone(ITEMS.ember_ring),
    };
    baseAtk = 10;
    baseDef = 2;
    baseCrit = 8;
  }

  const player = {
    name: heroName || cls.name,
    heroClass: cls.id,
    className: cls.name,
    x: 5.5,
    y: 5.5,
    z: 0,
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
    stunTimer: 0,
    frozenTimer: 0,
    chilled: 0,
    tempDef: 0,
    tempDefTimer: 0,
    tempAtk: 0,
    tempAtkTimer: 0,
    hasteTimer: 0,
    retributionTimer: 0,
    sunderTimer: 0,
    level: 5,
    xp: 0,
    xpNext: 999,
    skillPoints: 0,
    loadout: chosen,
    skillRanks,
    maxHp: 1000,
    hp: 1000,
    maxMp: 38 + cls.bonusMp * 2,
    mp: 38 + cls.bonusMp * 2,
    baseAtk,
    baseDef,
    baseCrit,
    gold: 0,
    basicShotCount: 0,
    hitCounter: 0,
    relics: [],
    inventory: [
      { ...ITEMS.health_potion, qty: 2 },
      { ...ITEMS.mana_potion, qty: 2 },
    ],
    shortcuts: ["health_potion", "mana_potion", null, null],
    equipment,
    leap: null,
    valiantCharge: null,
    radiantCharge: null,
    ultCharge: null,
    rapidSlash: null,
    aegisBlast: null,
  };
  const gearBonusStats = getPlayerStats({ ...player, maxHp: 0 });
  player.maxHp = Math.max(100, 1000 - gearBonusStats.maxHp);
  const stats = getPlayerStats(player);
  player.hp = stats.maxHp;
  player.mp = stats.maxMp;
  return player;
}

export const pvpHooks = {
  buildSpellButtons: null,
  updateUI: null,
  updateRoomAndBossHUD: null,
  hideMainMenu: null,
  showMainMenu: null,
  openPvpDialog: null,
  onLobbyStateChange: null,
};

let pvpEndCountdownTimer = null;
let pvpEndBackupTimer = null;
let pvpRoundLostRetryTimer = null;
let pvpBgHeartbeatTimer = null;

export function clearPvpBgHeartbeat() {
  if (pvpBgHeartbeatTimer) {
    clearInterval(pvpBgHeartbeatTimer);
    pvpBgHeartbeatTimer = null;
  }
}

export function startPvpBgHeartbeat() {
  clearPvpBgHeartbeat();
  let lastTick = Date.now();
  pvpBgHeartbeatTimer = setInterval(() => {
    const now = Date.now();
    const elapsed = Math.min(2.0, Math.max(0, (now - lastTick) / 1000));
    lastTick = now;
    const s = runtime.state;
    if (!s?.isPvp) {
      clearPvpBgHeartbeat();
      return;
    }
    if (s.runEnded || s.pvpRoundEnded) return;
    if ((s.pvpIntroTimer || 0) > 0) {
      syncPvpIntroTimer(s);
    }
    const p = s.player;
    if (p && (document.hidden || !document.hasFocus())) {
      if (p.iFrames > 0) {
        const wallNow = performance.now();
        const dtSec = p.pvpLastIFrameTs ? Math.max(0, (wallNow - p.pvpLastIFrameTs) / 1000) : elapsed;
        p.iFrames = Math.max(0, p.iFrames - dtSec);
        p.pvpLastIFrameTs = wallNow;
      }
      if ((s.pvpIntroTimer || 0) <= 0) {
        s.pvpRoundTimer = Math.max(0, (s.pvpRoundTimer ?? 99) - elapsed);
        if (s.pvpRoundTimer <= 0 && !s.pvpTimeoutSent) {
          s.pvpTimeoutSent = true;
          notifyLocalPvpTimeout();
        }
      }
      if (p.hp <= 0) {
        notifyLocalPvpDefeat();
        return;
      }
      if (pvpNet.connected) {
        const stats = getPlayerStats(p);
        pvpNet.send({
          type: "pvp_sync",
          round: s.pvpRound || 1,
          x: Math.round(p.x * 100) / 100,
          y: Math.round(p.y * 100) / 100,
          z: Math.round((p.z || 0) * 10) / 10,
          anim: p.anim,
          facingLeft: Boolean(p.facingLeft),
          aimAngle: Math.round((p.aimAngle || 0) * 1000) / 1000,
          hp: Math.max(0, Math.round(p.hp)),
          maxHp: Math.round(stats.maxHp),
        });
      }
    }
  }, 400);
}

export function clearPvpEndCountdown() {
  if (pvpEndCountdownTimer) {
    clearInterval(pvpEndCountdownTimer);
    pvpEndCountdownTimer = null;
  }
  if (pvpEndBackupTimer) {
    clearTimeout(pvpEndBackupTimer);
    pvpEndBackupTimer = null;
  }
}

export function clearPvpRoundLostRetry() {
  if (pvpRoundLostRetryTimer) {
    clearInterval(pvpRoundLostRetryTimer);
    pvpRoundLostRetryTimer = null;
  }
}

function closeModalIfOpen(id, reason = "pvp_cleanup") {
  const el = document.getElementById(id);
  if (el?.open) {
    try { el.close(reason); } catch {}
  }
}

export function returnToPvpLobbyFromMatch({ leaveRoom = false, openLobby = true } = {}) {
  clearPvpEndCountdown();
  clearPvpRoundLostRetry();
  clearPvpBgHeartbeat();
  closeModalIfOpen("confirm-dialog", "pvp_return");
  closeModalIfOpen("pvp-guide-dialog", "pvp_return");
  closeModalIfOpen("end-dialog", "pvp_return");
  const vsOverlay = document.getElementById("pvp-vs-screen");
  if (vsOverlay) vsOverlay.hidden = true;
  const matchOverlay = document.getElementById("pvp-match-overlay");
  if (matchOverlay) matchOverlay.hidden = true;
  if (leaveRoom && pvpNet.connected && pvpNet.room) {
    pvpNet.send({ type: "leave_lobby" });
  }
  if (runtime.state) {
    runtime.state.isPvp = false;
    runtime.state.runEnded = true;
    runtime.state.pvpRoundEnded = true;
    runtime.state.pvpMatchOverShown = false;
  }
  document.body.classList.remove("pvp-active");
  const sfHud = document.getElementById("pvp-sf-hud");
  if (sfHud) sfHud.hidden = true;
  if (pvpHooks.updateRoomAndBossHUD) pvpHooks.updateRoomAndBossHUD();
  if (pvpHooks.showMainMenu) pvpHooks.showMainMenu();
  if (openLobby && pvpHooks.openPvpDialog) pvpHooks.openPvpDialog();
}

const CLOUD_WAKE_BACKOFFS_MS = [2500, 4000, 5000, 6500, 8000];

class PvpNetworkClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.connecting = false;
    this.waking = false;
    this.retryAttempt = 0;
    this.maxRetries = CLOUD_WAKE_BACKOFFS_MS.length;
    this.retryTimer = null;
    this.connectTimeoutTimer = null;
    this.targetUrl = "";
    this.manualDisconnect = false;
    this.clientId = null;
    this.clientIp = "";
    this.lobbies = [];
    this.room = null;
    this.mySlot = -1;
    this.lastError = "";
    this.syncAccum = 0;
    this.pingTimer = null;
    this.handlers = new Set();
  }

  subscribe(fn) {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  emitUI(event, data = {}) {
    for (const fn of this.handlers) {
      try { fn(event, data); } catch (err) { console.error(err); }
    }
    if (pvpHooks.onLobbyStateChange) pvpHooks.onLobbyStateChange(event, data);
  }

  clearRetryTimers() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.connectTimeoutTimer) {
      clearTimeout(this.connectTimeoutTimer);
      this.connectTimeoutTimer = null;
    }
  }

  pingCloudHealth(wsUrl) {
    if (!wsUrl || !wsUrl.startsWith("wss://")) return;
    const healthUrl = wsUrl.replace(/^wss:/i, "https:").replace(/\/ws$/i, "/health");
    try {
      fetch(healthUrl, { mode: "cors", cache: "no-store" }).catch(() => {});
    } catch {}
  }

  scheduleCloudRetry(wsUrl) {
    if (this.manualDisconnect || !wsUrl || !wsUrl.startsWith("wss://") || this.targetUrl !== wsUrl) {
      return false;
    }
    if (this.retryAttempt >= this.maxRetries) {
      this.waking = false;
      this.connecting = false;
      return false;
    }
    const delay = CLOUD_WAKE_BACKOFFS_MS[this.retryAttempt] || 6000;
    this.retryAttempt += 1;
    this.waking = true;
    this.connecting = true;
    this.lastError = "";
    this.emitUI("waking", { attempt: this.retryAttempt, maxRetries: this.maxRetries });
    this.pingCloudHealth(wsUrl);
    this.clearRetryTimers();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.manualDisconnect && this.targetUrl === wsUrl && !this.connected) {
        this.connect(wsUrl, { isRetry: true });
      }
    }, delay);
    return true;
  }

  connect(rawUrl, { isRetry = false } = {}) {
    const wsUrl = normalizeWsUrl(rawUrl);
    if (!wsUrl) {
      this.lastError = "Enter a Server URL first: use wss://your-service.onrender.com/ws (Online) or ws://<PC-IP>:8080/ws (Same Wi-Fi).";
      this.emitUI("error", { message: this.lastError });
      return;
    }
    if (
      window.location.protocol === "https:" &&
      !window.Capacitor &&
      !window.AndroidApp &&
      wsUrl.startsWith("ws://") &&
      !/^ws:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(wsUrl)
    ) {
      this.lastError = "Browser security blocks ws:// from HTTPS pages (Vercel). Use a wss:// Render URL, OR open http://<PC-IP>:8080 directly on your browser.";
      this.emitUI("error", { message: this.lastError });
      return;
    }
    setSavedPvpServerUrl(wsUrl);
    this.disconnect({ preserveRetry: isRetry });
    this.manualDisconnect = false;
    this.targetUrl = wsUrl;
    if (!isRetry) {
      this.retryAttempt = 0;
      this.waking = false;
    }
    this.connecting = true;
    this.lastError = "";
    if (!isRetry && wsUrl.startsWith("wss://")) {
      this.pingCloudHealth(wsUrl);
    }
    this.emitUI(this.waking ? "waking" : "connecting", {
      attempt: this.retryAttempt,
      maxRetries: this.maxRetries,
    });

    try {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      let opened = false;
      let retryQueuedForSocket = false;

      if (wsUrl.startsWith("wss://")) {
        this.connectTimeoutTimer = setTimeout(() => {
          if (this.ws === ws && !opened) {
            try { ws.close(); } catch {}
          }
        }, 12000);
      }

      ws.onopen = () => {
        if (this.ws !== ws) return;
        opened = true;
        this.clearRetryTimers();
        this.waking = false;
        this.retryAttempt = 0;
        this.connected = true;
        this.connecting = false;
        this.lastError = "";
        this.send({ type: "list_lobbies" });
        this.startPingLoop();
        this.emitUI("connected");
      };
      ws.onmessage = (ev) => {
        if (this.ws !== ws) return;
        try {
          const msg = JSON.parse(ev.data);
          this.handleMessage(msg);
        } catch {}
      };
      ws.onerror = () => {
        if (this.ws !== ws) return;
        if (!opened && !this.manualDisconnect && wsUrl.startsWith("wss://")) {
          if (!retryQueuedForSocket && this.scheduleCloudRetry(wsUrl)) {
            retryQueuedForSocket = true;
            return;
          }
        }
        const isNative = Boolean(window.Capacitor || window.AndroidApp);
        if (isNative && /^ws:\/\/(localhost|127\.0\.0\.1)(:|\/)/i.test(wsUrl)) {
          this.lastError = "Phone cannot join PC via localhost — enter PC's Wi-Fi IP (e.g. 192.168.x.x) or tap Scan Wi-Fi.";
        } else if (wsUrl.startsWith("ws://") && !wsUrl.includes("localhost") && !wsUrl.includes("127.0.0.1")) {
          this.lastError = "Cannot reach LAN Host — verify same Wi-Fi, allow port 8080 in Firewall, or Host LAN on Phone.";
        } else {
          this.lastError = "Connection failed — check Server URL and ensure host/relay is awake.";
        }
        this.emitUI("error", { message: this.lastError });
      };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.clearRetryTimers();
        this.connected = false;
        this.stopPingLoop();
        runtime.netPingMs = null;
        this.room = null;
        this.mySlot = -1;
        if (!opened && !this.manualDisconnect && wsUrl.startsWith("wss://")) {
          if (retryQueuedForSocket || this.scheduleCloudRetry(wsUrl)) {
            retryQueuedForSocket = true;
            return;
          }
        }
        this.waking = false;
        this.connecting = false;
        this.emitUI("disconnected");
        if (opened && !this.manualDisconnect && runtime.state?.isPvp && !runtime.state.runEnded && !runtime.state.pvpMatchOverShown) {
          handlePvpConnectionLost();
        }
      };
    } catch (err) {
      this.connecting = false;
      this.waking = false;
      this.lastError = err?.message || "Invalid WebSocket URL.";
      this.emitUI("error", { message: this.lastError });
    }
  }

  disconnect({ preserveRetry = false } = {}) {
    if (!preserveRetry) {
      this.manualDisconnect = true;
      this.targetUrl = "";
      this.waking = false;
      this.retryAttempt = 0;
    }
    this.clearRetryTimers();
    this.stopPingLoop();
    runtime.netPingMs = null;
    if (this.ws) {
      const old = this.ws;
      this.ws = null;
      try { old.close(); } catch {}
    }
    this.connected = false;
    this.connecting = false;
    this.room = null;
    this.mySlot = -1;
  }

  startPingLoop() {
    this.stopPingLoop();
    const doPing = () => {
      if (this.connected) this.send({ type: "ping", t: performance.now() });
    };
    doPing();
    this.pingTimer = setInterval(doPing, 2000);
  }

  stopPingLoop() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(obj));
    } catch {}
  }

  handleMessage(msg) {
    switch (msg.type) {
      case "welcome":
        this.clientId = msg.id;
        this.clientIp = msg.ip || "";
        this.emitUI("welcome", msg);
        break;
      case "pong":
        if (typeof msg.t === "number") {
          runtime.netPingMs = Math.max(1, performance.now() - msg.t);
        }
        break;
      case "lobbies":
        this.lobbies = Array.isArray(msg.lobbies) ? msg.lobbies : [];
        this.emitUI("lobbies", { lobbies: this.lobbies });
        break;
      case "lobby_joined":
        this.room = msg.room;
        this.mySlot = msg.slot;
        this.emitUI("lobby_joined", msg);
        break;
      case "lobby_update":
        this.room = msg.room;
        this.emitUI("lobby_update", msg);
        break;
      case "lobby_left":
        this.room = null;
        this.mySlot = -1;
        this.send({ type: "list_lobbies" });
        this.emitUI("lobby_left");
        break;
      case "error":
        this.lastError = msg.message || "Multiplayer error.";
        this.emitUI("error", msg);
        break;
      case "match_start":
        this.room = msg.room;
        this.mySlot = msg.slot;
        startPvpMatchSession(this.room, this.mySlot);
        this.emitUI("match_start", msg);
        break;
      case "next_round":
        this.room = msg.room;
        this.mySlot = msg.slot;
        startPvpRound(this.room, this.mySlot);
        this.emitUI("next_round", msg);
        break;
      case "round_over":
        handleRemoteRoundOver(msg);
        break;
      case "match_over":
        handleRemoteMatchOver(msg);
        break;
      case "opponent_left":
        this.room = msg.room;
        handleOpponentDisconnected();
        this.emitUI("opponent_left", msg);
        break;
      case "pvp_sync":
        applyRemoteOpponentSync(msg);
        break;
      case "pvp_action":
        applyRemoteOpponentAction(msg);
        break;
      case "pvp_hit":
        applyIncomingPvpHit(msg);
        break;
      case "pvp_server_hp":
        applyServerHpSync(msg);
        break;
    }
  }
}

export const pvpNet = new PvpNetworkClient();

export function createOpponentEntity(playerData, spawn) {
  const safeId = playerData.heroClass === "paladin" ? "gilded" : playerData.heroClass;
  const cls = HERO_CLASSES[safeId] || HERO_CLASSES.gilded;
  const maxHp = 1000;
  return {
    uid: `pvp_rival_${playerData.id || playerData.slot}`,
    id: `pvp_${cls.id}`,
    name: playerData.heroName || cls.name,
    role: "pvp_rival",
    isPvpPlayer: true,
    isSheet: true,
    sprite: `${cls.id}_idle`,
    walkSprite: `${cls.id}_walk`,
    attackSprite: `${cls.id}_attack`,
    heroClass: cls.id,
    x: spawn.x + 0.5,
    y: spawn.y + 0.5,
    targetX: spawn.x + 0.5,
    targetY: spawn.y + 0.5,
    z: 0,
    vx: 0,
    vy: 0,
    kbX: 0,
    kbY: 0,
    facingLeft: playerData.slot === 1,
    aimAngle: playerData.slot === 1 ? Math.PI : 0,
    anim: "idle",
    hp: maxHp,
    maxHp,
    def: 3 + cls.bonusDef,
    frozenTimer: 0,
    stunTimer: 0,
    chilled: 0,
    sunderTimer: 0,
    hurtTimer: 0,
    tempDefTimer: 0,
    hasteTimer: 0,
    retributionTimer: 0,
    pvpDmgTimer: 0,
    regenTimer: 0,
    bobPhase: 0,
  };
}

function setupPvpMatchEntities(room, mySlot, isNextRound = false) {
  const level = buildPvpArenaLevel(room.mapId);
  const myInfo = room.players[mySlot];
  const oppSlot = mySlot === 0 ? 1 : 0;
  const oppInfo = room.players[oppSlot];
  const mySpawn = level.pvpSpawns[mySlot];
  const oppSpawn = level.pvpSpawns[oppSlot];

  const player = buildBalancedPvpPlayer(myInfo.heroName, myInfo.heroClass, myInfo.loadout);
  player.x = mySpawn.x + 0.5;
  player.y = mySpawn.y + 0.5;
  player.facingLeft = mySlot === 1;
  player.aimAngle = mySlot === 1 ? Math.PI : 0;

  const opp = createOpponentEntity(oppInfo, oppSpawn);
  level.enemies = [opp];
  computeFOV(level, mySpawn.x, mySpawn.y, 6);

  const introDur = isNextRound ? 3.0 : 6.5;
  runtime.state = {
    startedByUser: true,
    isPvp: true,
    pvpRoomId: room.id,
    pvpMySlot: mySlot,
    pvpRound: room.round || 1,
    pvpScores: [...(room.scores || [0, 0])],
    pvpRoundEnded: false,
    pvpMatchOverShown: false,
    pvpTimeoutSent: false,
    pvpRoundTimer: 99,
    pvpRoundBanner: null,
    pvpIntroTimer: introDur,
    pvpIntroEndsAt: performance.now() + introDur * 1000,
    pvpPowerups: [],
    pvpPowerupTimer: 0.25,
    pvpNextPowerupId: 1,
    pvpClaimedPowerupIds: new Set(),
    pvpOpponent: opp,
    pvpMyInfo: myInfo,
    pvpOppInfo: oppInfo,
    floor: 1,
    difficulty: "normal",
    isEndless: false,
    level,
    elapsed: 0,
    kills: 0,
    bossFightStarted: false,
    hasBossKey: false,
    bossKeyDrop: null,
    runEnded: false,
    dyingTimer: 0,
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
    lastFovTile: { x: mySpawn.x, y: mySpawn.y },
    seenBosses: new Set(),
    shardsCollected: [false, false, false, false],
    spellCooldowns: Object.fromEntries(SPELLS.map((sp) => [sp.id, 0])),
    player,
    projectiles: [],
    slashes: [],
    rings: [],
    groundDecals: [],
    vfxAnims: [],
    beams: [],
    arrowStorms: [],
    frostZones: [],
    fallingArrows: [],
    enemyHazards: [],
    afterimages: [],
    floatingTexts: [],
    particles: [],
  };
}

function showPvpVsLoadingScreen(room, mySlot, durationMs = 5000) {
  const overlay = document.getElementById("pvp-vs-screen");
  if (!overlay) return;
  const leftInfo = room.players[0] || {};
  const rightInfo = room.players[1] || {};
  const leftClsId = leftInfo.heroClass === "paladin" ? "gilded" : leftInfo.heroClass || "gilded";
  const rightClsId = rightInfo.heroClass === "paladin" ? "gilded" : rightInfo.heroClass || "gilded";
  const leftCls = HERO_CLASSES[leftClsId] || HERO_CLASSES.gilded;
  const rightCls = HERO_CLASSES[rightClsId] || HERO_CLASSES.gilded;
  const map = PVP_MAPS[room.mapId] || PVP_MAPS[0];

  const leftIds = Array.isArray(leftInfo.loadout) && leftInfo.loadout.length >= 4 ? leftInfo.loadout : (CLASS_DEFAULT_LOADOUTS[leftCls.id] || DEFAULT_LOADOUT);
  const rightIds = Array.isArray(rightInfo.loadout) && rightInfo.loadout.length >= 4 ? rightInfo.loadout : (CLASS_DEFAULT_LOADOUTS[rightCls.id] || DEFAULT_LOADOUT);

  const renderSkillsHtml = (ids) =>
    ids
      .map((id) => SPELLS.find((sp) => sp.id === id))
      .filter(Boolean)
      .map(
        (sp) =>
          `<div class="pvp-vs-skill-pill"><img src="${sp.icon}" alt="" /><span>${sp.name}</span></div>`
      )
      .join("");

  document.getElementById("pvp-vs-round").textContent = `ROUND ${room.round || 1} — 1V1 ARENA`;
  document.getElementById("pvp-vs-map-name").textContent = map.name;
  document.getElementById("pvp-vs-map-sub").textContent = map.subtitle;
  const backdropEl = overlay.querySelector(".pvp-vs-backdrop");
  if (backdropEl) {
    backdropEl.style.backgroundImage = map.splash
      ? `linear-gradient(180deg, rgba(11, 15, 26, 0.68), rgba(11, 15, 26, 0.9)), url("${map.splash}")`
      : "";
    backdropEl.style.backgroundSize = "cover";
    backdropEl.style.backgroundPosition = "center";
  }

  const leftIsYou = mySlot === 0;
  const rightIsYou = mySlot === 1;
  const leftCard = document.getElementById("pvp-vs-card-left");
  const rightCard = document.getElementById("pvp-vs-card-right");
  const leftBadge = document.getElementById("pvp-vs-left-badge");
  const rightBadge = document.getElementById("pvp-vs-right-badge");

  if (leftCard) leftCard.className = `pvp-vs-fighter ${leftIsYou ? "you" : "rival"}`;
  if (rightCard) rightCard.className = `pvp-vs-fighter ${rightIsYou ? "you" : "rival"}`;
  if (leftBadge) {
    leftBadge.textContent = leftIsYou ? "YOUR HERO" : "OPPONENT";
    leftBadge.className = `pvp-vs-side-badge ${leftIsYou ? "you" : "rival"}`;
  }
  if (rightBadge) {
    rightBadge.textContent = rightIsYou ? "YOUR HERO" : "OPPONENT";
    rightBadge.className = `pvp-vs-side-badge ${rightIsYou ? "you" : "rival"}`;
  }

  document.getElementById("pvp-vs-left-name").textContent = `${leftInfo.heroName || leftCls.name}${leftIsYou ? " (You)" : ""}`;
  document.getElementById("pvp-vs-left-class").textContent = `${leftCls.name} · 1,000 HP`;
  document.getElementById("pvp-vs-left-skills").innerHTML = renderSkillsHtml(leftIds);

  document.getElementById("pvp-vs-right-name").textContent = `${rightInfo.heroName || rightCls.name}${rightIsYou ? " (You)" : ""}`;
  document.getElementById("pvp-vs-right-class").textContent = `${rightCls.name} · 1,000 HP`;
  document.getElementById("pvp-vs-right-skills").innerHTML = renderSkillsHtml(rightIds);

  const barEl = document.getElementById("pvp-vs-bar-fill");
  const statusEl = document.getElementById("pvp-vs-status");
  if (barEl) barEl.style.width = "0%";
  if (statusEl) statusEl.textContent = "Entering Arena...";
  overlay.hidden = false;
  sfx.levelUp();

  const leftCtx = document.getElementById("pvp-vs-canvas-left")?.getContext("2d");
  const rightCtx = document.getElementById("pvp-vs-canvas-right")?.getContext("2d");
  const startTs = performance.now();
  let animIdx = 0;
  let lastSprTick = startTs;

  const tick = (now) => {
    const elapsed = now - startTs;
    const pct = Math.min(100, (elapsed / durationMs) * 100);
    if (barEl) barEl.style.width = `${pct.toFixed(1)}%`;
    const remSec = Math.max(1, Math.ceil((durationMs - elapsed) / 1000));
    if (statusEl) statusEl.textContent = pct >= 96 ? "Arena Ready!" : `Preparing Arena... ${remSec}s`;

    if (now - lastSprTick >= 120) {
      lastSprTick = now;
      animIdx = (animIdx + 1) % 24;
    }
    const drawSide = (c, clsId, flip) => {
      if (!c) return;
      c.clearRect(0, 0, 112, 112);
      c.imageSmoothingEnabled = false;
      const sheet = runtime.assets[`${clsId}_walk`] || runtime.assets[`${clsId}_idle`] || runtime.assets.gilded_idle;
      if (sheet) drawSheetFrame(c, sheet, animIdx, 8, 8, 96, 96, flip);
    };
    drawSide(leftCtx, leftCls.id, false);
    drawSide(rightCtx, rightCls.id, true);

    if (elapsed < durationMs && !overlay.hidden) {
      requestAnimationFrame(tick);
    } else {
      overlay.hidden = true;
    }
  };
  requestAnimationFrame(tick);
}

export function syncPvpIntroTimer(s = runtime.state) {
  if (!s?.isPvp || !s.pvpIntroEndsAt) return s?.pvpIntroTimer || 0;
  const rem = Math.max(0, (s.pvpIntroEndsAt - performance.now()) / 1000);
  const prev = s.pvpIntroTimer || 0;
  s.pvpIntroTimer = rem;
  if (prev > 0 && rem <= 0) {
    s.pvpIntroEndsAt = 0;
    sfx.nova();
    addFloat(s.player.x, s.player.y - 0.55, "FIGHT!", "#fde047");
  }
  return rem;
}

export function startPvpMatchSession(room, mySlot) {
  clearPvpEndCountdown();
  clearPvpRoundLostRetry();
  closeModalIfOpen("confirm-dialog", "match_start");
  closeModalIfOpen("end-dialog", "match_start");
  const matchOverlay = document.getElementById("pvp-match-overlay");
  if (matchOverlay) matchOverlay.hidden = true;
  setupPvpMatchEntities(room, mySlot, false);
  startPvpBgHeartbeat();
  const st = runtime.state;
  setTimeout(() => { if (runtime.state === st) syncPvpIntroTimer(st); }, 6560);
  runtime.isCanvasVisible = true;
  runtime.lastFrameTime = performance.now();
  document.body.classList.add("pvp-active");
  const mpDlg = document.getElementById("pvp-dialog");
  if (mpDlg?.open) mpDlg.close("match_start");
  if (pvpHooks.hideMainMenu) pvpHooks.hideMainMenu();
  if (pvpHooks.buildSpellButtons) pvpHooks.buildSpellButtons();
  if (pvpHooks.updateUI) pvpHooks.updateUI();
  if (pvpHooks.updateRoomAndBossHUD) pvpHooks.updateRoomAndBossHUD();
  runtime.uiDirty = true;
  showPvpVsLoadingScreen(room, mySlot, 5000);
  addLog(`PvP Duel started on ${runtime.state.level.pvpMap.name}! Best of 3 rounds (1,000 HP).`, "story");
}

export function startPvpRound(room, mySlot) {
  clearPvpEndCountdown();
  clearPvpRoundLostRetry();
  closeModalIfOpen("confirm-dialog", "next_round");
  closeModalIfOpen("end-dialog", "next_round");
  const matchOverlay = document.getElementById("pvp-match-overlay");
  if (matchOverlay) matchOverlay.hidden = true;
  setupPvpMatchEntities(room, mySlot, true);
  startPvpBgHeartbeat();
  const st = runtime.state;
  setTimeout(() => { if (runtime.state === st) syncPvpIntroTimer(st); }, 3060);
  runtime.isCanvasVisible = true;
  runtime.lastFrameTime = performance.now();
  document.body.classList.add("pvp-active");
  const vsOverlay = document.getElementById("pvp-vs-screen");
  if (vsOverlay) vsOverlay.hidden = true;
  if (pvpHooks.hideMainMenu) pvpHooks.hideMainMenu();
  if (pvpHooks.buildSpellButtons) pvpHooks.buildSpellButtons();
  if (pvpHooks.updateUI) pvpHooks.updateUI();
  if (pvpHooks.updateRoomAndBossHUD) pvpHooks.updateRoomAndBossHUD();
  runtime.uiDirty = true;
  sfx.levelUp();
  addLog(`Round ${room.round || 1} — Get Ready!`, "story");
}

export function notifyLocalPvpDefeat() {
  const s = runtime.state;
  if (!s?.isPvp || s.pvpRoundEnded || s.runEnded) return;
  const p = s.player;
  const stats = getPlayerStats(p);
  const roundNum = s.pvpRound || 1;
  s.pvpRoundEnded = true;
  p.hp = 0;
  p.anim = "death";
  p.animTimer = 1.2;
  addFloat(p.x, p.y - 0.5, "K.O.!", "#ef4444");
  runtime.uiDirty = true;
  pvpNet.send({
    type: "pvp_sync",
    round: roundNum,
    x: Math.round(p.x * 100) / 100,
    y: Math.round(p.y * 100) / 100,
    z: Math.round((p.z || 0) * 10) / 10,
    anim: "death",
    facingLeft: Boolean(p.facingLeft),
    aimAngle: Math.round((p.aimAngle || 0) * 1000) / 1000,
    hp: 0,
    maxHp: Math.round(stats.maxHp),
  });
  pvpNet.send({ type: "round_lost", round: roundNum });
  clearPvpRoundLostRetry();
  let retries = 0;
  pvpRoundLostRetryTimer = setInterval(() => {
    const cur = runtime.state;
    if (!cur?.isPvp || cur.runEnded || (cur.pvpRound || 1) !== roundNum) {
      clearPvpRoundLostRetry();
      return;
    }
    if (!pvpNet.connected || retries >= 6) {
      clearPvpRoundLostRetry();
      if (!cur.pvpMatchOverShown && !cur.runEnded) {
        if (pvpNet.room?.status === "lobby") {
          handleRemoteMatchOver({
            winnerSlot: cur.pvpMySlot === 0 ? 1 : 0,
            scores: [...(pvpNet.room.scores || cur.pvpScores || [0, 0])],
            round: roundNum,
            reason: "ko",
          });
        } else {
          handlePvpConnectionLost("Match result timed out. Returning to PvP Lobby.");
        }
      }
      return;
    }
    retries += 1;
    pvpNet.send({ type: "pvp_sync", round: roundNum, hp: 0, maxHp: Math.round(stats.maxHp) });
    pvpNet.send({ type: "round_lost", round: roundNum });
  }, 750);
}

export function notifyLocalPvpTimeout() {
  const s = runtime.state;
  if (!s?.isPvp || s.pvpRoundEnded || s.runEnded) return;
  pvpNet.send({
    type: "round_timeout",
    round: s.pvpRound || 1,
    myHp: Math.max(0, Math.round(s.player?.hp || 0)),
    oppHp: Math.max(0, Math.round(s.pvpOpponent?.hp || 0)),
  });
}

export function updatePvpFrame(dt) {
  const s = runtime.state;
  if (!s?.isPvp) return;

  if (!s.pvpRoundEnded && !s.runEnded && s.player && s.player.hp <= 0) {
    notifyLocalPvpDefeat();
  }
  if (!s.pvpRoundEnded && !s.runEnded && s.pvpOpponent && s.pvpOpponent.hp <= 0 && pvpNet.connected) {
    const now = performance.now();
    if (!s.pvpOppZeroSince) {
      s.pvpOppZeroSince = now;
    } else if (now - s.pvpOppZeroSince >= 1100 && (!s.pvpWinClaimAt || now - s.pvpWinClaimAt >= 900)) {
      s.pvpWinClaimAt = now;
      pvpNet.send({ type: "claim_round_win", round: s.pvpRound || 1 });
    }
  } else {
    s.pvpOppZeroSince = 0;
  }

  // Interpolate opponent hero smoothly & advance remote skill charge timers
  const opp = s.pvpOpponent;
  if (opp) {
    opp.x += (opp.targetX - opp.x) * Math.min(1, dt * 16);
    opp.y += (opp.targetY - opp.y) * Math.min(1, dt * 16);
    if (opp.hurtTimer > 0) opp.hurtTimer = Math.max(0, opp.hurtTimer - dt);
    if (opp.chilled > 0) opp.chilled = Math.max(0, opp.chilled - dt);
    if (opp.sunderTimer > 0) opp.sunderTimer = Math.max(0, opp.sunderTimer - dt);
    if (opp.frozenTimer > 0) opp.frozenTimer = Math.max(0, opp.frozenTimer - dt);
    if (opp.stunTimer > 0) opp.stunTimer = Math.max(0, opp.stunTimer - dt);
    if (opp.ultCharge) {
      opp.ultCharge.timer = Math.max(0, opp.ultCharge.timer - dt);
      if (opp.ultCharge.timer <= 0) opp.ultCharge = null;
    }
    if (opp.radiantCharge) {
      opp.radiantCharge.timer = Math.max(0, opp.radiantCharge.timer - dt);
      if (opp.radiantCharge.timer <= 0) opp.radiantCharge = null;
    }
    if (opp.valiantCharge) {
      opp.valiantCharge.timer = Math.max(0, opp.valiantCharge.timer - dt);
      if (opp.valiantCharge.phase === "dash") {
        s.afterimages.push({
          x: opp.x,
          y: opp.y,
          facingLeft: opp.facingLeft,
          frame: runtime.animFrame,
          heroClass: opp.heroClass,
          life: 0.2,
          maxLife: 0.2,
        });
        if (s.afterimages.length > 14) s.afterimages.shift();
      }
      if (opp.valiantCharge.timer <= 0) {
        if (opp.valiantCharge.phase === "windup") {
          opp.valiantCharge.phase = "dash";
          opp.valiantCharge.timer = opp.valiantCharge.dashDur || 0.38;
        } else {
          opp.valiantCharge = null;
        }
      }
    }
    if (opp.leap) {
      opp.leap.progress += dt / Math.max(0.2, opp.leap.duration || 1.25);
      if (opp.leap.progress >= 1.15) opp.leap = null;
    }
  }

  if (!s.pvpRoundEnded && !s.runEnded && (s.pvpIntroTimer || 0) <= 0) {
    updatePvpPowerups(dt);
  }

  // Broadcast local player snapshot ~22Hz (skip once round has ended so stale hp:0 cannot leak into next round)
  pvpNet.syncAccum += dt;
  if (!s.pvpRoundEnded && !s.runEnded && pvpNet.syncAccum >= 0.045 && pvpNet.connected && s.player) {
    pvpNet.syncAccum = 0;
    const p = s.player;
    const stats = getPlayerStats(p);
    pvpNet.send({
      type: "pvp_sync",
      round: s.pvpRound || 1,
      x: Math.round(p.x * 100) / 100,
      y: Math.round(p.y * 100) / 100,
      z: Math.round((p.z || 0) * 10) / 10,
      anim: p.anim,
      facingLeft: Boolean(p.facingLeft),
      aimAngle: Math.round((p.aimAngle || 0) * 1000) / 1000,
      hp: Math.max(0, Math.round(p.hp)),
      maxHp: Math.round(stats.maxHp),
      tempDefTimer: p.tempDefTimer > 0 ? 1 : 0,
      hasteTimer: p.hasteTimer > 0 ? 1 : 0,
      retributionTimer: p.retributionTimer > 0 ? 1 : 0,
      manaShieldTimer: p.manaShieldTimer > 0 ? 1 : 0,
      pvpDmgTimer: (p.pvpDmgTimer || 0) > 0 ? 1 : 0,
      regenTimer: (p.regenTimer || 0) > 0 ? 1 : 0,
    });
  }
}

/** Spawn a random arena vial every 15s (host-authoritative) and handle walk-over claims. */
function updatePvpPowerups(dt) {
  const s = runtime.state;
  const p = s?.player;
  if (!s || !p) return;

  if (s.pvpMySlot === 0) {
    s.pvpPowerupTimer = (s.pvpPowerupTimer ?? 15) - dt;
    if (s.pvpPowerupTimer <= 0) {
      s.pvpPowerupTimer = 15.0;
      const active = s.pvpPowerups || [];
      if (active.length < 3) {
        const spots = (s.level?.pvpPowerupSpots || []).filter(
          (sp) => !active.some((pu) => pu.x === sp.x && pu.y === sp.y)
        );
        if (spots.length > 0) {
          const spot = s.pvpNextPowerupId === 1
            ? spots[0]
            : spots[Math.floor(Math.random() * spots.length)];
          const tpl = PVP_POWERUP_TYPES[Math.floor(Math.random() * PVP_POWERUP_TYPES.length)];
          const hpPct = tpl.kind === "hp" ? 5 + Math.floor(Math.random() * 16) : 0;
          const powerup = {
            id: s.pvpNextPowerupId++,
            kind: tpl.kind,
            name: tpl.name,
            color: tpl.color,
            glow: tpl.glow,
            hpPct,
            label: tpl.kind === "hp" ? `+${hpPct}% HP` : tpl.label,
            x: spot.x,
            y: spot.y,
          };
          s.pvpPowerups.push(powerup);
          spawnRing(spot.x + 0.5, spot.y + 0.5, 28, powerup.color, 0.35);
          spawnBurst(spot.x + 0.5, spot.y + 0.5, powerup.color, 10, 0.9);
          broadcastPvpAction({ kind: "powerup_spawn", powerup });
        }
      }
    }
  }

  for (let i = (s.pvpPowerups || []).length - 1; i >= 0; i--) {
    const pu = s.pvpPowerups[i];
    if (Math.hypot(p.x - (pu.x + 0.5), p.y - (pu.y + 0.5)) <= 0.85) {
      s.pvpPowerups.splice(i, 1);
      s.pvpClaimedPowerupIds?.add(pu.id);
      applyPvpPowerupToPlayer(pu);
      broadcastPvpAction({
        kind: "powerup_claim",
        id: pu.id,
        x: pu.x + 0.5,
        y: pu.y + 0.5,
        color: pu.color,
        label: pu.label,
        byName: p.name,
      });
    }
  }
}

function applyPvpPowerupToPlayer(pu) {
  const s = runtime.state;
  const p = s?.player;
  if (!s || !p) return;
  const stats = getPlayerStats(p);
  sfx.heal();
  spawnRing(pu.x + 0.5, pu.y + 0.5, 38, pu.color, 0.35);
  spawnBurst(pu.x + 0.5, pu.y + 0.5, pu.color, 16, 1.15);

  if (pu.kind === "hp") {
    const pct = pu.hpPct || 12;
    const heal = Math.max(1, Math.round(stats.maxHp * (pct / 100)));
    p.hp = Math.min(stats.maxHp, p.hp + heal);
    addFloat(p.x, p.y - 0.5, `+${heal} HP (${pct}%)`, pu.color);
    addLog(`Picked up ${pu.name}: restored +${heal} HP (${pct}%).`, "heal");
  } else if (pu.kind === "regen") {
    p.regenTimer = 5.0;
    p.regenTickTimer = 0.5;
    p.regenPctPerSec = 0.025;
    addFloat(p.x, p.y - 0.5, "2.5%/s REGEN (5s)!", pu.color);
    addLog(`Picked up ${pu.name}: regenerating 2.5% HP/s for 5s.`, "heal");
  } else if (pu.kind === "damage") {
    p.pvpDmgTimer = 7.0;
    p.pvpDmgMult = 1.3;
    sfx.levelUp();
    addFloat(p.x, p.y - 0.5, "+30% DMG (7s)!", pu.color);
    addLog(`Picked up ${pu.name}: +30% damage dealt for 7s!`, "story");
  } else if (pu.kind === "haste") {
    p.hasteTimer = 6.0;
    p.hasteBonus = 1.35;
    addFloat(p.x, p.y - 0.5, "+30% SPEED (6s)!", pu.color);
    addLog(`Picked up ${pu.name}: +30% movement speed for 6s!`, "story");
  } else if (pu.kind === "ward") {
    p.tempDef = Math.max(p.tempDef || 0, 8);
    p.tempDefTimer = Math.max(p.tempDefTimer || 0, 6.0);
    for (const key of Object.keys(s.spellCooldowns || {})) {
      if (s.spellCooldowns[key] > 0) s.spellCooldowns[key] = Math.max(0, s.spellCooldowns[key] - 1.5);
    }
    addFloat(p.x, p.y - 0.5, "+8 DEF · -1.5s CD!", pu.color);
    addLog(`Picked up ${pu.name}: +8 DEF for 6s and -1.5s skill cooldowns!`, "story");
  }
  runtime.uiDirty = true;
}

export function broadcastPvpAction(action) {
  const s = runtime.state;
  if (!s?.isPvp || !pvpNet.connected) return;
  pvpNet.send({ type: "pvp_action", action });
}

export function sendPvpHit(payload) {
  const s = runtime.state;
  if (!s?.isPvp || !pvpNet.connected) return;
  pvpNet.send({ type: "pvp_hit", round: s.pvpRound || 1, ...payload });
}

function applyRemoteOpponentSync(msg) {
  const s = runtime.state;
  const opp = s?.pvpOpponent;
  if (!s?.isPvp || !opp) return;
  opp.targetX = Number(msg.x) || opp.x;
  opp.targetY = Number(msg.y) || opp.y;
  opp.z = Number(msg.z) || 0;
  opp.anim = msg.anim || "idle";
  opp.facingLeft = Boolean(msg.facingLeft);
  opp.aimAngle = Number(msg.aimAngle) || 0;
  if (typeof msg.hp === "number") opp.hp = msg.hp;
  if (typeof msg.maxHp === "number") opp.maxHp = msg.maxHp;
  opp.tempDefTimer = msg.tempDefTimer ? 1 : 0;
  opp.hasteTimer = msg.hasteTimer ? 1 : 0;
  opp.retributionTimer = msg.retributionTimer ? 1 : 0;
  opp.manaShieldTimer = msg.manaShieldTimer ? 1 : 0;
  opp.pvpDmgTimer = msg.pvpDmgTimer ? 1 : 0;
  opp.regenTimer = msg.regenTimer ? 1 : 0;
}

function applyRemoteOpponentAction(msg) {
  const s = runtime.state;
  if (!s?.isPvp || !msg.action) return;
  const act = msg.action;
  const opp = s.pvpOpponent;
  if (act.kind === "slash") {
    s.slashes.push({
      x: act.x * TILE_SIZE,
      y: act.y * TILE_SIZE,
      angle: act.angle || 0,
      radius: act.radius || 38,
      variant: act.variant || (act.color === "#38bdf8" ? "steel_cyan" : "gold"),
      flipY: Boolean(act.flipY),
      color: act.color || "#f87171",
      life: act.life || 0.21,
      maxLife: act.life || 0.21,
    });
    sfx.slash();
  } else if (act.kind === "projectile") {
    s.projectiles.push({
      x: act.x,
      y: act.y,
      vx: act.vx,
      vy: act.vy,
      radius: act.radius || 0.25,
      color: act.color || "#ef4444",
      dmg: 0,
      isEnemy: true,
      isPvpVisual: true,
      isArrow: Boolean(act.isArrow),
      isMagicOrb: Boolean(act.isMagicOrb),
      isSlashWave: Boolean(act.isSlashWave),
      isFrostLance: Boolean(act.isFrostLance),
      projKind: act.projKind || null,
      bouncesLeft: Number(act.bouncesLeft) || 0,
      rehitCd: 0,
      lastHitUid: null,
      pierce: Boolean(act.pierce),
      hitIds: new Set(),
      life: act.life || 0.7,
      maxLife: act.life || 0.7,
    });
    if (act.isArrow) sfx.arrow();
    else if (act.isFrostLance) sfx.frost();
    else sfx.magicOrb();
  } else if (act.kind === "vfx") {
    const opts = act.opts || {
      angle: act.angle || 0,
      flipX: Boolean(act.flipX),
      anchorX: act.anchorX ?? 0.5,
      anchorY: act.anchorY ?? 0.5,
    };
    spawnVfxAnim(act.x, act.y, act.sheetKey, act.sizePx || 88, act.duration ?? act.dur ?? 0.45, opts);
  } else if (act.kind === "decal") {
    spawnGroundDecal(act.x, act.y, act.sheetKey, act.sizePx || 84, act.duration || 0.5, act.opts || {});
  } else if (act.kind === "ring") {
    spawnRing(act.x, act.y, act.radPx || 40, act.color || "#facc15", act.dur || 0.35, act.opts || {});
    spawnBurst(act.x, act.y, act.color || "#facc15", act.burstCount ?? 14, act.burstSpeed ?? 1.2);
  } else if (act.kind === "beam") {
    s.beams.push({
      x: act.x * TILE_SIZE,
      y: act.y * TILE_SIZE,
      color: act.color || "#fde047",
      life: act.life || 0.36,
      maxLife: act.life || 0.36,
    });
    sfx.smite();
  } else if (act.kind === "frost_zone") {
    if (!s.frostZones) s.frostZones = [];
    sfx.frost();
    const rad = act.radius || 2.0;
    spawnRing(act.x, act.y, rad * TILE_SIZE, "#38bdf8", 0.38);
    spawnBurst(act.x, act.y, "#bae6fd", 16, 1.15);
    s.frostZones.push({
      x: act.x,
      y: act.y,
      radius: rad,
      timer: act.duration || 4.0,
      maxTimer: act.duration || 4.0,
      isVisualOnly: true,
      dwell: new Map(),
      frozenIds: new Set(),
      particleCd: 0,
    });
  } else if (act.kind === "gravity_well") {
    if (!s.gravityWells) s.gravityWells = [];
    s.gravityWells.push({
      x: act.x,
      y: act.y,
      radius: act.radius || 3.2,
      timer: act.duration || 2.0,
      pullSpeed: act.pullSpeed || 2.35,
      pulseCd: 0.45,
      isVisualOnly: true,
    });
  } else if (act.kind === "arrow_storm") {
    if (!s.arrowStorms) s.arrowStorms = [];
    if (!s.fallingArrows) s.fallingArrows = [];
    const rad = act.radius || 2.4;
    const dur = act.duration || 3.0;
    sfx.ultLeap();
    s.arrowStorms.push({
      x: act.x,
      y: act.y,
      radius: rad,
      duration: dur,
      timer: dur,
      tickInterval: act.tickInterval || 0.35,
      tickTimer: 0,
      spawnTimer: 0,
      isVisualOnly: true,
    });
    spawnRing(act.x, act.y, rad * TILE_SIZE, "#facc15", 0.4);
    addFloat(act.x, act.y - 0.5, "ARROW STORM!", "#fde047");
  } else if (act.kind === "ult_charge" && opp) {
    sfx.ultLeap();
    opp.ultCharge = { timer: act.duration || 1.2, duration: act.duration || 1.2, radius: act.radius || 2.8 };
    addFloat(opp.x, opp.y - 0.5, "CHARGING...", "#fde047");
  } else if (act.kind === "ult_slam") {
    if (opp) opp.ultCharge = null;
    sfx.ultSlam();
    const radPx = (act.radius || 2.8) * TILE_SIZE;
    spawnBurst(act.x, act.y, "#fbbf24", 30, 1.55);
    spawnBurst(act.x, act.y, "#ffffff", 16, 1.25);
    spawnRing(act.x, act.y, radPx, "#fbbf24", 0.45);
    spawnRing(act.x, act.y, radPx * 0.6, "#ffffff", 0.3);
    spawnGroundDecal(act.x, act.y, "vfx_holy_ground_impact", radPx * 2.15, 0.9, { scaleStart: 0.72, scaleEnd: 1.08, spin: 0.35 });
    spawnGroundDecal(act.x, act.y, "vfx_ground_slam_shockwave", radPx * 1.45, 0.24, { scaleStart: 0.15, scaleEnd: 1.85 });
    s.beams.push({ x: act.x * TILE_SIZE, y: act.y * TILE_SIZE, color: "#fde047", life: 0.42, maxLife: 0.42 });
  } else if (act.kind === "radiant_charge" && opp) {
    sfx.heal();
    opp.radiantCharge = { timer: act.duration || 0.65, duration: act.duration || 0.65, angle: act.angle || 0 };
    spawnRing(opp.x, opp.y, 34, "#fb923c", 0.35);
    spawnBurst(opp.x, opp.y, "#fde047", 10, 0.9);
  } else if (act.kind === "radiant_release") {
    if (opp) opp.radiantCharge = null;
    sfx.slash();
    sfx.nova();
    s.slashes.push({
      x: act.slashX * TILE_SIZE,
      y: act.slashY * TILE_SIZE,
      angle: act.angle || 0,
      radius: 44,
      variant: "gold",
      color: act.color || "#fb923c",
      life: 0.24,
      maxLife: 0.24,
    });
    spawnBurst(act.slashX, act.slashY, "#fb923c", 16, 1.2);
    spawnRing(act.x, act.y, 38, "#fde047", 0.28);
  } else if (act.kind === "valiant_windup" && opp) {
    sfx.ultLeap();
    opp.valiantCharge = {
      phase: "windup",
      timer: act.windupDur || 0.62,
      windupDur: act.windupDur || 0.62,
      dashDur: act.dashDur || 0.38,
      startX: act.startX,
      startY: act.startY,
      targetX: act.targetX,
      targetY: act.targetY,
      travelDist: act.travelDist || 0,
      spearDistMax: act.spearDistMax || 1.65,
      dirX: act.dirX || 1,
      dirY: act.dirY || 0,
    };
    spawnRing(act.startX, act.startY, 26, "#38bdf8", 0.35);
  } else if (act.kind === "valiant_dash" && opp) {
    sfx.dash();
    if (opp.valiantCharge) {
      opp.valiantCharge.phase = "dash";
      opp.valiantCharge.timer = act.dashDur || 0.38;
    }
    spawnBurst(act.x, act.y, "#38bdf8", 14, 1.25);
    spawnRing(act.x, act.y, 34, "#facc15", 0.25);
  } else if (act.kind === "valiant_slam") {
    if (opp) opp.valiantCharge = null;
    sfx.smite();
    const ang = act.angle || 0;
    s.beams.push({ x: act.x * TILE_SIZE, y: act.y * TILE_SIZE, color: "#38bdf8", life: 0.28, maxLife: 0.28 });
    s.slashes.push(
      { x: act.x * TILE_SIZE, y: act.y * TILE_SIZE, angle: ang + 0.6, radius: 42, variant: "steel_cyan", flipY: false, life: 0.22, maxLife: 0.22, color: "#38bdf8" },
      { x: act.x * TILE_SIZE, y: act.y * TILE_SIZE, angle: ang - 0.6, radius: 42, variant: "gold", flipY: true, life: 0.22, maxLife: 0.22, color: "#fde047" }
    );
    spawnBurst(act.x, act.y, "#facc15", 20, 1.45);
    spawnBurst(act.x, act.y, "#38bdf8", 14, 1.25);
    spawnRing(act.x, act.y, 1.75 * TILE_SIZE, "#38bdf8", 0.3, { delay: 0, lineWidth: 3 });
    spawnRing(act.x, act.y, 2.05 * TILE_SIZE, "#fde047", 0.38, { delay: 0.06, lineWidth: 2.5 });
    spawnGroundDecal(act.x, act.y, "vfx_spear_impact_crater", 104, 0.95, { scaleStart: 0.55, scaleEnd: 1.05 });
    spawnGroundDecal(act.x, act.y, "vfx_ground_slam_shockwave", 92, 0.25, { angle: ang - Math.PI / 2, scaleStart: 0.45, scaleEnd: 1.55 });
  } else if (act.kind === "leap_start" && opp) {
    sfx.ultLeap();
    opp.leap = { progress: 0, duration: act.duration || 1.25, radius: act.radius || 2.8 };
    spawnBurst(act.x, act.y, "#fde047", 14, 1.1);
    addFloat(act.x, act.y - 0.5, "SKYFALL!", "#f97316");
  } else if (act.kind === "leap_land") {
    if (opp) opp.leap = null;
    sfx.ultSlam();
    sfx.nova();
    const radPx = (act.radius || 2.8) * TILE_SIZE;
    spawnRing(act.x, act.y, radPx * 0.88, "#ffffff", 0.36, { delay: 0, lineWidth: 3.5 });
    spawnRing(act.x, act.y, radPx * 1.0, "#fde047", 0.44, { delay: 0.07, lineWidth: 3 });
    spawnRing(act.x, act.y, radPx * 1.12, "#f97316", 0.52, { delay: 0.14, lineWidth: 2.8 });
    spawnRing(act.x, act.y, radPx * 0.72, "#38bdf8", 0.44, { delay: 0.21, lineWidth: 2.4 });
    spawnRing(act.x, act.y, radPx * 1.24, "#fef08a", 0.56, { delay: 0.28, lineWidth: 2 });
    spawnGroundDecal(act.x, act.y, "vfx_ground_slam_shockwave", radPx * 1.45, 0.24, { scaleStart: 0.1, scaleEnd: 2.0 });
    spawnGroundDecal(act.x, act.y, "vfx_skyfall_impact", radPx * 2.25, 0.8, { scaleStart: 0.72, scaleEnd: 1.12, spin: 0.35 });
    s.beams.push({ x: act.x * TILE_SIZE, y: act.y * TILE_SIZE, color: "#fde047", life: 0.44, maxLife: 0.44 });
    spawnBurst(act.x, act.y, "#f97316", 32, 1.7);
    spawnBurst(act.x, act.y, "#fde047", 20, 1.35);
  } else if (act.kind === "powerup_spawn" && act.powerup) {
    const pu = act.powerup;
    if (!s.pvpPowerups) s.pvpPowerups = [];
    if (!s.pvpClaimedPowerupIds?.has(pu.id) && !s.pvpPowerups.some((x) => x.id === pu.id)) {
      s.pvpPowerups.push(pu);
      spawnRing(pu.x + 0.5, pu.y + 0.5, 28, pu.color, 0.35);
      spawnBurst(pu.x + 0.5, pu.y + 0.5, pu.color, 10, 0.9);
    }
  } else if (act.kind === "powerup_claim") {
    s.pvpClaimedPowerupIds?.add(act.id);
    if (Array.isArray(s.pvpPowerups)) {
      const idx = s.pvpPowerups.findIndex((x) => x.id === act.id);
      if (idx >= 0) s.pvpPowerups.splice(idx, 1);
    }
    spawnRing(act.x, act.y, 34, act.color || "#facc15", 0.32);
    spawnBurst(act.x, act.y, act.color || "#facc15", 12, 1.0);
    if (act.byName && act.label) {
      addFloat(act.x, act.y - 0.35, `${act.byName}: ${act.label}`, act.color || "#fde047");
    }
  } else if (act.kind === "clear_charges" && opp) {
    opp.ultCharge = null;
    opp.radiantCharge = null;
    opp.valiantCharge = null;
    opp.leap = null;
  }
}

function applyServerHpSync(msg) {
  const s = runtime.state;
  if (!s?.isPvp || s.pvpRoundEnded || s.runEnded) return;
  if (typeof msg.round === "number" && msg.round !== (s.pvpRound || 1)) return;
  const p = s.player;
  if (!p || typeof msg.hp !== "number") return;
  const targetHp = Math.max(0, Math.round(msg.hp));
  if (targetHp < p.hp) {
    p.hp = targetHp;
    runtime.uiDirty = true;
    if (p.hp <= 0) {
      notifyLocalPvpDefeat();
    }
  }
}

function applyIncomingPvpHit(msg) {
  const s = runtime.state;
  if (!s?.isPvp || s.pvpRoundEnded || s.runEnded) return;
  const p = s.player;
  const wallNow = performance.now();
  if (p.iFrames > 0 && p.pvpLastIFrameTs) {
    p.iFrames = Math.max(0, p.iFrames - Math.max(0, (wallNow - p.pvpLastIFrameTs) / 1000));
  }
  p.pvpLastIFrameTs = wallNow;
  if (p.iFrames > 0) {
    addFloat(p.x, p.y - 0.35, "EVADED!", "#38bdf8");
    return;
  }

  const stats = getPlayerStats(p);
  const rawDmg = Number(msg.dmg) || 1;
  const effectiveDef = Math.max(0, stats.def - (p.sunderTimer > 0 ? 3 : 0));
  const flatBlock = Math.floor(effectiveDef * 0.25);
  const pctMult = 100 / (100 + effectiveDef * 1.8);
  const dmg = Math.max(1, Math.round(Math.max(1, rawDmg - flatBlock) * pctMult));

  p.hp = Math.max(0, p.hp - dmg);
  p.iFrames = Math.max(p.iFrames || 0, 0.14);
  p.pvpLastIFrameTs = wallNow;
  if (msg.stunDur) p.stunTimer = Math.max(p.stunTimer || 0, Number(msg.stunDur));
  if (msg.freezeDur) p.frozenTimer = Math.max(p.frozenTimer || 0, Number(msg.freezeDur));
  if (msg.sunderDur) p.sunderTimer = Math.max(p.sunderTimer || 0, Number(msg.sunderDur));
  p.kbX += Number(msg.knockX) || 0;
  p.kbY += Number(msg.knockY) || 0;

  sfx.hurt();
  s.shake = Math.max(s.shake, msg.isCrit ? 8 : 5);
  addFloat(p.x, p.y - 0.35, `-${dmg}${msg.isCrit ? "!" : ""}`, "#ef4444");
  spawnBurst(p.x, p.y, "#ef4444", 10, 1.1);
  addLog(`${s.pvpOpponent?.name || "Rival"}'s ${msg.source || "strike"} hit you for ${dmg} damage!`, "combat");
  runtime.uiDirty = true;

  if (p.hp <= 0) {
    notifyLocalPvpDefeat();
  }
}

function handleRemoteRoundOver(msg) {
  clearPvpRoundLostRetry();
  const s = runtime.state;
  if (!s?.isPvp) return;
  s.pvpRoundEnded = true;
  s.pvpScores = [...(msg.scores || [0, 0])];
  const mySc = s.pvpScores[s.pvpMySlot] || 0;
  const oppSc = s.pvpScores[s.pvpMySlot === 0 ? 1 : 0] || 0;
  const isDraw = Boolean(msg.isDraw) || msg.winnerSlot < 0;
  const wonRound = !isDraw && msg.winnerSlot === s.pvpMySlot;
  const isTimeout = msg.reason === "timeout";

  if (wonRound && !isTimeout && s.pvpOpponent) {
    s.pvpOpponent.hp = 0;
  }
  if (wonRound) {
    sfx.levelUp();
  } else {
    sfx.hurt();
  }

  const title = isDraw
    ? "TIME OVER — DRAW!"
    : wonRound
      ? `${isTimeout ? "TIME OVER" : "K.O.!"} — ROUND ${msg.round} WON!`
      : `${isTimeout ? "TIME OVER" : "K.O.!"} — ROUND ${msg.round} LOST`;
  const sub = `Score: ${mySc} - ${oppSc} · Next round starting...`;
  s.pvpRoundBanner = {
    title,
    sub,
    color: isDraw ? "#38bdf8" : wonRound ? "#fde047" : "#f87171",
  };
  showFloorBanner(`${title} (${mySc} - ${oppSc})`);
  runtime.uiDirty = true;
  if (pvpHooks.updateUI) pvpHooks.updateUI();
  if (pvpHooks.updateRoomAndBossHUD) pvpHooks.updateRoomAndBossHUD();
}

function startPvpEndLobbyCountdown() {
  clearPvpEndCountdown();
  const cdEl = document.getElementById("pvp-match-countdown");
  const lobbyBtn = document.getElementById("btn-pvp-match-lobby");
  const endsAt = Date.now() + 4000;
  const finishReturn = () => {
    if (!runtime.state?.isPvp) {
      clearPvpEndCountdown();
      return;
    }
    returnToPvpLobbyFromMatch({ leaveRoom: false, openLobby: true });
  };
  const syncText = () => {
    const rem = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    if (cdEl) {
      cdEl.textContent = rem > 0 ? `Returning to PvP Lobby in ${rem}s...` : "Returning to PvP Lobby...";
    }
    if (lobbyBtn) {
      lobbyBtn.textContent = rem > 0 ? `Go to PvP Lobby (${rem}s)` : "Go to PvP Lobby";
    }
    if (rem <= 0) {
      finishReturn();
    }
  };
  syncText();
  pvpEndCountdownTimer = setInterval(() => {
    if (!runtime.state?.isPvp) {
      clearPvpEndCountdown();
      return;
    }
    syncText();
  }, 250);
  pvpEndBackupTimer = setTimeout(finishReturn, 4200);
}

function showPvpMatchOverlay({ isWin, eyebrow, title, summary, statsHtml = "" }) {
  closeModalIfOpen("confirm-dialog", "match_over");
  closeModalIfOpen("pvp-guide-dialog", "match_over");
  closeModalIfOpen("skill-dialog", "match_over");
  closeModalIfOpen("end-dialog", "match_over");
  const overlay = document.getElementById("pvp-match-overlay");
  const card = document.getElementById("pvp-match-card");
  const eyebrowEl = document.getElementById("pvp-match-eyebrow");
  const titleEl = document.getElementById("pvp-match-title");
  const summaryEl = document.getElementById("pvp-match-summary");
  const statsEl = document.getElementById("pvp-match-stats");
  const lobbyBtn = document.getElementById("btn-pvp-match-lobby");
  const menuBtn = document.getElementById("btn-pvp-match-menu");

  if (card) {
    card.classList.toggle("lose", !isWin);
  }
  if (eyebrowEl) eyebrowEl.textContent = eyebrow || "PVP ARENA · MATCH COMPLETE";
  if (titleEl) titleEl.textContent = title || (isWin ? "VICTORY!" : "DEFEATED");
  if (summaryEl) summaryEl.textContent = summary || "";
  if (statsEl) statsEl.innerHTML = statsHtml || "";

  if (lobbyBtn) {
    lobbyBtn.onclick = () => returnToPvpLobbyFromMatch({ leaveRoom: false, openLobby: true });
  }
  if (menuBtn) {
    menuBtn.onclick = () => returnToPvpLobbyFromMatch({ leaveRoom: true, openLobby: false });
  }
  if (overlay) {
    overlay.hidden = false;
  }
  startPvpEndLobbyCountdown();
}

function handleRemoteMatchOver(msg) {
  clearPvpRoundLostRetry();
  clearPvpBgHeartbeat();
  const s = runtime.state;
  if (!s?.isPvp || s.pvpMatchOverShown) return;
  s.pvpMatchOverShown = true;
  s.pvpRoundEnded = true;
  s.runEnded = true;
  s.pvpScores = [...(msg.scores || [0, 0])];
  const won = msg.winnerSlot === s.pvpMySlot;
  if (won && s.pvpOpponent && msg.reason !== "timeout") {
    s.pvpOpponent.hp = 0;
  }
  if (won) {
    sfx.victory();
    runtime.meta.soulShards = (runtime.meta.soulShards || 0) + 2;
    saveMeta();
  } else {
    sfx.gameOver();
  }
  if (pvpHooks.updateUI) pvpHooks.updateUI();
  if (pvpHooks.updateRoomAndBossHUD) pvpHooks.updateRoomAndBossHUD();

  const myName = s.player?.name || "You";
  const oppName = s.pvpOpponent?.name || "Rival";
  const winnerName = won ? myName : oppName;
  const mySc = s.pvpScores[s.pvpMySlot] ?? 0;
  const oppSc = s.pvpScores[s.pvpMySlot === 0 ? 1 : 0] ?? 0;

  showPvpMatchOverlay({
    isWin: won,
    eyebrow: "PVP ARENA · MATCH COMPLETE",
    title: won ? `VICTORY! ${winnerName} Wins!` : `DEFEATED — ${winnerName} Wins!`,
    summary: won
      ? `You defeated ${oppName} (${mySc} - ${oppSc}) and earned +2 Soul Shards!`
      : `${oppName} claimed the arena (${mySc} - ${oppSc}).`,
    statsHtml: `
      <div class="stat-pill"><span>YOUR SCORE</span><strong>${mySc}</strong></div>
      <div class="stat-pill"><span>RIVAL SCORE</span><strong>${oppSc}</strong></div>
      <div class="stat-pill"><span>ARENA</span><strong>${s.level.pvpMap?.name || "PvP"}</strong></div>
      <div class="stat-pill"><span>PING</span><strong>${runtime.netPingMs ? Math.round(runtime.netPingMs) + " ms" : "--"}</strong></div>
    `,
  });
}

function handleOpponentDisconnected() {
  clearPvpBgHeartbeat();
  clearPvpRoundLostRetry();
  const s = runtime.state;
  if (!s?.isPvp || s.runEnded || s.pvpMatchOverShown) return;
  s.pvpMatchOverShown = true;
  s.pvpRoundEnded = true;
  s.runEnded = true;
  addLog("Opponent disconnected from the PvP Arena.", "story");
  const myName = s.player?.name || "You";
  showPvpMatchOverlay({
    isWin: true,
    eyebrow: "PVP ARENA · FORFEIT VICTORY",
    title: `VICTORY! ${myName} Wins!`,
    summary: "Your opponent left the arena.",
  });
}

function handlePvpConnectionLost(reasonText = "Connection to the PvP server was lost.") {
  clearPvpBgHeartbeat();
  clearPvpRoundLostRetry();
  const s = runtime.state;
  if (!s?.isPvp || s.runEnded || s.pvpMatchOverShown) return;
  s.pvpMatchOverShown = true;
  s.pvpRoundEnded = true;
  s.runEnded = true;
  addLog(reasonText, "story");
  showPvpMatchOverlay({
    isWin: false,
    eyebrow: "PVP ARENA · MATCH ENDED",
    title: "Match Ended",
    summary: reasonText,
  });
}
