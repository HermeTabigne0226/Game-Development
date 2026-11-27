import { sfx } from "./audio.js";
import { DEFAULT_LOADOUT, HERO_CLASSES, ITEMS, SPELLS } from "./data.js";
import { MAP_H, MAP_W, TILE } from "./dungeon.js";
import {
  addFloat,
  addLog,
  getActiveSpells,
  getPlayerStats,
  runtime,
  saveMeta,
  showFloorBanner,
  spawnBurst,
  spawnRing,
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
    subtitle: "Stone Pillars & Center Well",
    floorTileIdx: 0,
    accentTileIdx: 0,
    w: 22,
    h: 16,
    desc: "Classic 4-pillar stone chamber with breakable crates and a central healing well.",
  },
  {
    id: 1,
    name: "Sunken Foundry Crucible",
    subtitle: "Forge Lanes & Twin Shrines",
    floorTileIdx: 1,
    accentTileIdx: 0,
    w: 24,
    h: 16,
    desc: "Gilded metal arena with forge choke points plus top Aegis and bottom Magic shrines.",
  },
  {
    id: 2,
    name: "Abyssal Sanctum Arena",
    subtitle: "Open Void Kiting Grounds",
    floorTileIdx: 3,
    accentTileIdx: 0,
    w: 26,
    h: 18,
    desc: "Spacious dark obsidian sanctum with staggered cover obelisks built for ranged duels.",
  },
  {
    id: 3,
    name: "Crimson Courtyard",
    subtitle: "3-Lane Fortress & Blood Altar",
    floorTileIdx: 0,
    accentTileIdx: 0,
    w: 24,
    h: 16,
    desc: "Bastion courtyard split into 3 tactical lanes guarding a central Shrine of Blood.",
  },
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
      visible[y][x] = true;
    }
  }
  // Reveal 1-tile outer wall perimeter around arena
  for (let y = Math.max(0, y0 - 1); y <= Math.min(MAP_H - 1, y1 + 1); y++) {
    for (let x = Math.max(0, x0 - 1); x <= Math.min(MAP_W - 1, x1 + 1); x++) {
      explored[y][x] = true;
      visible[y][x] = true;
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

  if (cfg.id === 0) {
    // Goblin Catacombs Pit: 4 symmetrical 2x2 stone pillars + mid Healing Well + corner crates
    for (const [ox, oy] of [[-4, -3], [3, -3], [-4, 2], [3, 2]]) {
      setWall(cx + ox, cy + oy);
      setWall(cx + ox + 1, cy + oy);
      setWall(cx + ox, cy + oy + 1);
      setWall(cx + ox + 1, cy + oy + 1);
    }
    addProp({ id: "pvp_well", kind: "well", x: cx, y: cy, solid: false, used: false });
    addProp({ kind: "crate", x: cx, y: y0 + 2, solid: true, broken: false });
    addProp({ kind: "barrel", x: cx, y: y1 - 2, solid: true, broken: false });
  } else if (cfg.id === 1) {
    // Sunken Foundry Crucible: staggered forge walls + Top Aegis & Bottom Magic Shrines
    for (const [ox, oy] of [[-5, -2], [-5, -1], [-5, 1], [-5, 2], [5, -2], [5, -1], [5, 1], [5, 2]]) {
      setWall(cx + ox, cy + oy);
    }
    setWall(cx - 1, cy - 4);
    setWall(cx + 1, cy + 4);
    addProp({ id: "pvp_shrine_top", kind: "shrine", shrineId: "aegis", x: cx, y: y0 + 2, solid: false, used: false });
    addProp({ id: "pvp_shrine_bot", kind: "shrine", shrineId: "sanctum", x: cx, y: y1 - 2, solid: false, used: false });
    addProp({ kind: "barrel", x: cx - 2, y: cy, solid: true, broken: false });
    addProp({ kind: "barrel", x: cx + 2, y: cy, solid: true, broken: false });
  } else if (cfg.id === 2) {
    // Abyssal Sanctum Arena: open kiting grounds + diagonal void obelisks
    for (const [ox, oy] of [[-6, -4], [6, -4], [-6, 4], [6, 4], [-3, 0], [3, 0], [0, -4], [0, 4]]) {
      setWall(cx + ox, cy + oy);
    }
    addProp({ id: "pvp_well", kind: "well", x: cx, y: cy, solid: false, used: false });
    addProp({ kind: "urn", x: cx - 5, y: cy, solid: true, broken: false });
    addProp({ kind: "urn", x: cx + 5, y: cy, solid: true, broken: false });
  } else {
    // Crimson Courtyard: 3 lanes guarded by horizontal bastion walls & central Blood Shrine
    for (let dx = -4; dx <= -2; dx++) {
      setWall(cx + dx, cy - 3);
      setWall(cx + dx, cy + 3);
    }
    for (let dx = 2; dx <= 4; dx++) {
      setWall(cx + dx, cy - 3);
      setWall(cx + dx, cy + 3);
    }
    addProp({ id: "pvp_shrine_blood", kind: "shrine", shrineId: "blood", x: cx, y: cy, solid: false, used: false });
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
  const cls = HERO_CLASSES[heroClassId] || HERO_CLASSES.paladin;
  const chosen = Array.isArray(loadoutIds) && loadoutIds.length >= 4 ? [...loadoutIds] : [...DEFAULT_LOADOUT[cls.id]];
  const skillRanks = Object.fromEntries(SPELLS.map((sp) => [sp.id, 0]));
  for (const id of chosen) {
    const sp = SPELLS.find((x) => x.id === id);
    if (!sp) continue;
    skillRanks[id] = sp.isUltimate ? 1 : 2;
  }

  const clone = (it) => (it ? { ...it } : null);
  let equipment;
  if (cls.id === "ranger") {
    equipment = {
      weapon: clone(ITEMS.emerald_recurve),
      subweapon: clone(ITEMS.hunter_quiver),
      armor: clone(ITEMS.ranger_coat),
      helmet: clone(ITEMS.warden_hood),
      boots: clone(ITEMS.windstep_boots),
      accessory: clone(ITEMS.blood_ring),
    };
  } else if (cls.id === "gilded") {
    equipment = {
      weapon: clone(ITEMS.steel_blade),
      subweapon: clone(ITEMS.iron_shield),
      armor: clone(ITEMS.chainmail),
      helmet: clone(ITEMS.iron_helm),
      boots: clone(ITEMS.swift_greaves),
      accessory: clone(ITEMS.blood_ring),
    };
  } else {
    equipment = {
      weapon: clone(ITEMS.iron_sword),
      subweapon: clone(ITEMS.wooden_buckler),
      armor: clone(ITEMS.chainmail),
      helmet: clone(ITEMS.iron_helm),
      boots: clone(ITEMS.swift_greaves),
      accessory: clone(ITEMS.sunfire_ring),
    };
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
    nextXp: 999,
    skillPoints: 0,
    loadout: chosen,
    skillRanks,
    maxHp: 74 + cls.bonusHp * 2,
    hp: 74 + cls.bonusHp * 2,
    maxMp: 38 + cls.bonusMp * 2,
    mp: 38 + cls.bonusMp * 2,
    baseAtk: 8 + cls.bonusAtk,
    baseDef: 3 + cls.bonusDef,
    baseCrit: 10 + cls.bonusCrit,
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
  const stats = getPlayerStats(player);
  player.hp = stats.maxHp;
  player.mp = stats.maxMp;
  return player;
}

export const pvpHooks = {
  buildSpellButtons: null,
  updateUI: null,
  hideMainMenu: null,
  showMainMenu: null,
  onLobbyStateChange: null,
};

class PvpNetworkClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.connecting = false;
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

  connect(rawUrl) {
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
    this.disconnect();
    this.connecting = true;
    this.lastError = "";
    this.emitUI("connecting");

    try {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      ws.onopen = () => {
        if (this.ws !== ws) return;
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
        this.lastError = "Connection failed — check Server URL and ensure host/relay is awake.";
        this.emitUI("error", { message: this.lastError });
      };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.connected = false;
        this.connecting = false;
        this.stopPingLoop();
        runtime.netPingMs = null;
        this.room = null;
        this.mySlot = -1;
        this.emitUI("disconnected");
      };
    } catch (err) {
      this.connecting = false;
      this.lastError = err?.message || "Invalid WebSocket URL.";
      this.emitUI("error", { message: this.lastError });
    }
  }

  disconnect() {
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
    }
  }
}

export const pvpNet = new PvpNetworkClient();

export function createOpponentEntity(playerData, spawn) {
  const cls = HERO_CLASSES[playerData.heroClass] || HERO_CLASSES.paladin;
  const maxHp = 74 + cls.bonusHp * 2 + (cls.id === "paladin" ? 6 : 4);
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
    bobPhase: 0,
  };
}

function setupPvpMatchEntities(room, mySlot) {
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

  runtime.state = {
    startedByUser: true,
    isPvp: true,
    pvpRoomId: room.id,
    pvpMySlot: mySlot,
    pvpRound: room.round || 1,
    pvpScores: [...(room.scores || [0, 0])],
    pvpRoundEnded: false,
    pvpOpponent: opp,
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
    shardsCollected: [false, false, false],
    spellCooldowns: Object.fromEntries(SPELLS.map((sp) => [sp.id, 0])),
    player,
    projectiles: [],
    slashes: [],
    rings: [],
    groundDecals: [],
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

export function startPvpMatchSession(room, mySlot) {
  setupPvpMatchEntities(room, mySlot);
  const mpDlg = document.getElementById("pvp-dialog");
  if (mpDlg?.open) mpDlg.close("match_start");
  if (pvpHooks.hideMainMenu) pvpHooks.hideMainMenu();
  if (pvpHooks.buildSpellButtons) pvpHooks.buildSpellButtons();
  if (pvpHooks.updateUI) pvpHooks.updateUI();
  runtime.uiDirty = true;
  showFloorBanner(`PvP Round ${room.round || 1} — ${runtime.state.level.pvpMap.name}`);
  addLog(`PvP Duel started on ${runtime.state.level.pvpMap.name}! Best of 3 rounds.`, "story");
}

export function startPvpRound(room, mySlot) {
  startPvpMatchSession(room, mySlot);
}

export function updatePvpFrame(dt) {
  const s = runtime.state;
  if (!s?.isPvp) return;

  // Interpolate opponent hero smoothly
  const opp = s.pvpOpponent;
  if (opp) {
    opp.x += (opp.targetX - opp.x) * Math.min(1, dt * 16);
    opp.y += (opp.targetY - opp.y) * Math.min(1, dt * 16);
    if (opp.hurtTimer > 0) opp.hurtTimer = Math.max(0, opp.hurtTimer - dt);
    if (opp.frozenTimer > 0) opp.frozenTimer = Math.max(0, opp.frozenTimer - dt);
    if (opp.stunTimer > 0) opp.stunTimer = Math.max(0, opp.stunTimer - dt);
  }

  // Broadcast local player snapshot ~22Hz
  pvpNet.syncAccum += dt;
  if (pvpNet.syncAccum >= 0.045 && pvpNet.connected && s.player) {
    pvpNet.syncAccum = 0;
    const p = s.player;
    const stats = getPlayerStats(p);
    pvpNet.send({
      type: "pvp_sync",
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
    });
  }
}

export function broadcastPvpAction(action) {
  const s = runtime.state;
  if (!s?.isPvp || !pvpNet.connected) return;
  pvpNet.send({ type: "pvp_action", action });
}

export function sendPvpHit(payload) {
  const s = runtime.state;
  if (!s?.isPvp || !pvpNet.connected) return;
  pvpNet.send({ type: "pvp_hit", ...payload });
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
}

function applyRemoteOpponentAction(msg) {
  const s = runtime.state;
  if (!s?.isPvp || !msg.action) return;
  const act = msg.action;
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
      pierce: Boolean(act.pierce),
      hitIds: new Set(),
      life: act.life || 0.7,
      maxLife: act.life || 0.7,
    });
    if (act.isArrow) sfx.arrow();
    else if (act.isFrostLance) sfx.frost();
    else sfx.magicOrb();
  } else if (act.kind === "ring") {
    spawnRing(act.x, act.y, act.radPx || 40, act.color || "#facc15", act.dur || 0.35);
    spawnBurst(act.x, act.y, act.color || "#facc15", 14, 1.2);
  } else if (act.kind === "beam") {
    s.beams.push({
      x: act.x * TILE_SIZE,
      y: act.y * TILE_SIZE,
      color: act.color || "#fde047",
      life: 0.36,
      maxLife: 0.36,
    });
    sfx.smite();
  }
}

function applyIncomingPvpHit(msg) {
  const s = runtime.state;
  if (!s?.isPvp || s.pvpRoundEnded || s.runEnded) return;
  const p = s.player;
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
    s.pvpRoundEnded = true;
    addFloat(p.x, p.y - 0.5, "DEFEATED!", "#ef4444");
    pvpNet.send({ type: "round_lost" });
  }
}

function handleRemoteRoundOver(msg) {
  const s = runtime.state;
  if (!s?.isPvp) return;
  s.pvpRoundEnded = true;
  s.pvpScores = [...(msg.scores || [0, 0])];
  const wonRound = msg.winnerSlot === s.pvpMySlot;
  if (wonRound) {
    sfx.levelUp();
    showFloorBanner(`Round ${msg.round} Won! (${s.pvpScores[s.pvpMySlot]} - ${s.pvpScores[s.pvpMySlot === 0 ? 1 : 0]})`);
  } else {
    showFloorBanner(`Round ${msg.round} Lost (${s.pvpScores[s.pvpMySlot]} - ${s.pvpScores[s.pvpMySlot === 0 ? 1 : 0]})`);
  }
}

function handleRemoteMatchOver(msg) {
  const s = runtime.state;
  if (!s?.isPvp) return;
  s.pvpRoundEnded = true;
  s.runEnded = true;
  s.pvpScores = [...(msg.scores || [0, 0])];
  const won = msg.winnerSlot === s.pvpMySlot;
  if (won) {
    sfx.victory();
    runtime.meta.soulShards = (runtime.meta.soulShards || 0) + 2;
    saveMeta();
  } else {
    sfx.gameOver();
  }

  const dlg = document.getElementById("end-dialog");
  document.getElementById("end-dialog-title").textContent = won ? "PvP Arena Champion!" : "Defeated in the Arena";
  document.getElementById("end-dialog-summary").textContent = won
    ? `You defeated ${s.pvpOpponent?.name || "your rival"} (${s.pvpScores[s.pvpMySlot]} - ${s.pvpScores[s.pvpMySlot === 0 ? 1 : 0]}) and earned +2 Soul Shards!`
    : `${s.pvpOpponent?.name || "Your rival"} claimed victory (${s.pvpScores[s.pvpMySlot]} - ${s.pvpScores[s.pvpMySlot === 0 ? 1 : 0]}).`;
  document.getElementById("end-stats").innerHTML = `
    <div class="stat-pill"><span>YOUR SCORE</span><strong>${s.pvpScores[s.pvpMySlot]}</strong></div>
    <div class="stat-pill"><span>RIVAL SCORE</span><strong>${s.pvpScores[s.pvpMySlot === 0 ? 1 : 0]}</strong></div>
    <div class="stat-pill"><span>ARENA</span><strong>${s.level.pvpMap?.name || "PvP"}</strong></div>
    <div class="stat-pill"><span>PING</span><strong>${runtime.netPingMs ? Math.round(runtime.netPingMs) + " ms" : "--"}</strong></div>
  `;
  const endlessBtn = document.getElementById("btn-end-endless");
  if (endlessBtn) endlessBtn.hidden = true;
  dlg.showModal();
}

function handleOpponentDisconnected() {
  const s = runtime.state;
  if (!s?.isPvp || s.runEnded) return;
  s.pvpRoundEnded = true;
  s.runEnded = true;
  addLog("Opponent disconnected from the PvP Arena.", "story");
  const dlg = document.getElementById("end-dialog");
  document.getElementById("end-dialog-title").textContent = "Rival Disconnected";
  document.getElementById("end-dialog-summary").textContent = "Your opponent left the arena. Returning you cleanly to the Lobby.";
  document.getElementById("end-stats").innerHTML = "";
  const endlessBtn = document.getElementById("btn-end-endless");
  if (endlessBtn) endlessBtn.hidden = true;
  dlg.showModal();
}
