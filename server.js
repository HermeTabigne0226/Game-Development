const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const dgram = require("dgram");

const PORT = Number(process.argv[2] || process.env.PORT) || 8080;
const ROOT_DIR = path.resolve(__dirname);
const WWW_DIR = path.resolve(__dirname, "www");
const IS_CLOUD_RELAY = Boolean(process.env.RENDER || process.env.PVP_RELAY_ONLY === "1");
const STATIC_DIR = IS_CLOUD_RELAY ? WWW_DIR : ROOT_DIR;

const MAX_WS_CLIENTS = 200;
const MAX_CLIENTS_PER_IP = 12;
const MAX_ROOMS = 60;
const MAX_ROOMS_PER_IP = 4;
const CREATE_LOBBY_COOLDOWN_MS = 1200;
const WS_MSG_RATE_LIMIT = 80;
const MAX_PVP_HIT_DMG = 340;
const MAX_PVP_HIT_RATE = 14;

const BLOCKED_TOP_PATHS = new Set([
  "server.js",
  "package.json",
  "package-lock.json",
  "render.yaml",
  "vercel.json",
  "capacitor.config.json",
  "capacitor.config.ts",
  "android",
  "scripts",
  "node_modules",
  "agents.md",
]);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

/** Resolve a URL path safely within STATIC_DIR, blocking traversal, dotfiles, and server files. */
function resolveSafePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }
  if (!decoded || decoded.includes("\0")) return null;
  const relative = decoded.replace(/^\/+/, "");
  const segments = relative.split(/[\\/]+/).filter(Boolean);
  if (segments.some((seg) => seg.startsWith(".") || seg === "..")) {
    return null;
  }
  if (!IS_CLOUD_RELAY && segments.length > 0 && BLOCKED_TOP_PATHS.has(segments[0].toLowerCase())) {
    return null;
  }
  const fullPath = path.resolve(STATIC_DIR, relative);
  if (fullPath !== STATIC_DIR && !fullPath.startsWith(STATIC_DIR + path.sep)) {
    return null;
  }
  return fullPath;
}

function sanitizeText(raw, fallback, maxLen = 24) {
  const cleaned = String(raw ?? "")
    .replace(/[\u0000-\u001F\u007F<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
  return cleaned || fallback;
}

function sanitizeLoadout(raw) {
  if (!Array.isArray(raw)) return null;
  const list = raw
    .slice(0, 4)
    .map((id) => String(id ?? "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 32))
    .filter(Boolean);
  return list.length ? list : null;
}

function clampNum(val, min, max, fallback = 0) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeIp(rawIp) {
  if (!rawIp) return "127.0.0.1";
  const first = String(rawIp).split(",")[0].trim();
  if (first === "::1") return "127.0.0.1";
  return first.startsWith("::ffff:") ? first.slice(7) : first;
}

function isPrivateOrLocalIp(ip) {
  return (
    ip === "127.0.0.1" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
}

function isSameNetwork(ipA, ipB) {
  if (ipA === ipB) return true;
  if (isPrivateOrLocalIp(ipA) && isPrivateOrLocalIp(ipB)) return true;
  return false;
}

function hashPassword(pw) {
  return pw ? crypto.createHash("sha256").update(String(pw)).digest("hex") : "";
}

// WebSocket PvP Lobby & Real-Time Relay State
const clients = new Map();
const rooms = new Map();
let nextClientId = 1;
let nextRoomNum = 1;

function sendWsJson(client, payload) {
  if (!client?.socket || client.socket.destroyed || !client.socket.writable) return;
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  const len = json.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    return;
  }
  try {
    client.socket.write(Buffer.concat([header, json]));
  } catch {}
}

function serializeRoomFor(room, viewerIp) {
  const host = room.players[0];
  return {
    id: room.id,
    name: room.name,
    mapId: room.mapId,
    hasPassword: Boolean(room.passwordHash),
    playerCount: room.players.length,
    maxPlayers: 2,
    status: room.status,
    hostName: host?.heroName || "Challenger",
    hostClass: host?.heroClass || "paladin",
    sameNetwork: isSameNetwork(viewerIp, room.hostIp),
  };
}

function normalizeAppVer(v) {
  return String(v || "").replace(/^v\.?/i, "").trim() || "unknown";
}

function hasVersionMismatch(room) {
  if (!room || room.players.length < 2) return false;
  return normalizeAppVer(room.players[0].appVersion) !== normalizeAppVer(room.players[1].appVersion);
}

function serializeRoomDetail(room) {
  return {
    id: room.id,
    name: room.name,
    mapId: room.mapId,
    hasPassword: Boolean(room.passwordHash),
    status: room.status,
    round: room.round,
    versionMismatch: hasVersionMismatch(room),
    autoStartSec: room.autoStartAt ? Math.max(0, Math.ceil((room.autoStartAt - Date.now()) / 1000)) : 0,
    scores: [...room.scores],
    players: room.players.map((pl, idx) => ({
      id: pl.id,
      slot: idx,
      isHost: idx === 0,
      heroName: pl.heroName,
      heroClass: pl.heroClass,
      appVersion: pl.appVersion || "unknown",
      loadout: pl.loadout,
      ready: pl.ready,
    })),
  };
}

function isClientAlive(client) {
  return Boolean(client && clients.has(client.id) && client.socket && !client.socket.destroyed && client.socket.writable);
}

function pruneRooms() {
  let changed = false;
  for (const [id, room] of rooms.entries()) {
    const alive = room.players.filter((pl) => isClientAlive(pl.client));
    if (alive.length !== room.players.length) {
      const wasPlaying = room.status === "playing";
      room.players = alive;
      clearRoomAutoStart(room);
      if (room.roundTimer) {
        clearTimeout(room.roundTimer);
        room.roundTimer = null;
      }
      changed = true;
      if (room.players.length === 0) {
        rooms.delete(id);
        continue;
      }
      room.status = "lobby";
      room.hostIp = room.players[0].client.ip;
      room.players[0].ready = false;
      if (wasPlaying) {
        sendWsJson(room.players[0].client, { type: "opponent_left", room: serializeRoomDetail(room) });
      } else {
        broadcastRoomUpdate(room);
      }
    } else if (room.players.length === 0) {
      rooms.delete(id);
      changed = true;
    }
  }
  return changed;
}

function broadcastLobbies() {
  pruneRooms();
  for (const client of clients.values()) {
    const list = [...rooms.values()]
      .filter((r) => r.status === "lobby" && r.players.length > 0 && r.players.length < 2)
      .map((r) => serializeRoomFor(r, client.ip))
      .sort((a, b) => Number(b.sameNetwork) - Number(a.sameNetwork));
    sendWsJson(client, { type: "lobbies", lobbies: list });
  }
}

function clearRoomAutoStart(room) {
  if (room?.autoStartTimer) {
    clearTimeout(room.autoStartTimer);
    room.autoStartTimer = null;
  }
  if (room) room.autoStartAt = 0;
}

function clearRoomTimers(room) {
  if (!room) return;
  if (room.roundTimer) {
    clearTimeout(room.roundTimer);
    room.roundTimer = null;
  }
  if (room.lethalVerifyTimer) {
    clearTimeout(room.lethalVerifyTimer);
    room.lethalVerifyTimer = null;
  }
}

function finishPvpRound(room, winnerIdx, reason = "ko") {
  if (!room || room.status !== "playing" || room.roundEnded || room.players.length < 2) return;
  room.roundEnded = true;
  if (room.lethalVerifyTimer) {
    clearTimeout(room.lethalVerifyTimer);
    room.lethalVerifyTimer = null;
  }
  if (winnerIdx === 0 || winnerIdx === 1) {
    room.scores[winnerIdx] += 1;
  }

  if (winnerIdx >= 0 && room.scores[winnerIdx] >= 2) {
    for (const pl of room.players) {
      sendWsJson(pl.client, {
        type: "match_over",
        winnerSlot: winnerIdx,
        scores: [...room.scores],
        round: room.round,
        reason,
      });
    }
    room.status = "lobby";
    room.players.forEach((pl) => {
      pl.ready = false;
      pl.lastHp = 1000;
      pl.lastX = null;
      pl.lastY = null;
    });
    room.roundTimer = setTimeout(() => {
      if (rooms.has(room.id)) broadcastRoomUpdate(room);
    }, 600);
    broadcastLobbies();
  } else {
    for (const pl of room.players) {
      sendWsJson(pl.client, {
        type: "round_over",
        winnerSlot: winnerIdx,
        isDraw: winnerIdx < 0,
        scores: [...room.scores],
        round: room.round,
        reason,
      });
    }
    room.round += 1;
    room.roundTimer = setTimeout(() => {
      if (!rooms.has(room.id) || room.players.length < 2) return;
      room.roundEnded = false;
      room.roundStartedAt = Date.now();
      room.players.forEach((pl) => {
        pl.lastHp = 1000;
        pl.estHp = 1000;
        pl.bgDmgApplied = false;
        pl.lastSyncAt = Date.now();
        pl.lastX = null;
        pl.lastY = null;
      });
      const detail = serializeRoomDetail(room);
      for (let i = 0; i < room.players.length; i++) {
        sendWsJson(room.players[i].client, {
          type: "next_round",
          slot: i,
          room: detail,
        });
      }
    }, 2400);
  }
}

function launchPvpRoomMatch(room) {
  clearRoomAutoStart(room);
  clearRoomTimers(room);
  room.status = "playing";
  room.round = 1;
  room.roundEnded = false;
  room.scores = [0, 0];
  room.roundStartedAt = Date.now();
  room.players.forEach((pl) => {
    pl.lastHp = 1000;
    pl.estHp = 1000;
    pl.bgDmgApplied = false;
    pl.lastSyncAt = Date.now();
    pl.lastX = null;
    pl.lastY = null;
  });
  const detail = serializeRoomDetail(room);
  for (let i = 0; i < room.players.length; i++) {
    sendWsJson(room.players[i].client, {
      type: "match_start",
      slot: i,
      room: detail,
    });
  }
  broadcastLobbies();
}

function broadcastRoomUpdate(room) {
  const detail = serializeRoomDetail(room);
  for (const pl of room.players) {
    sendWsJson(pl.client, { type: "lobby_update", room: detail });
  }
}

function removeClientFromRoom(client) {
  if (!client.roomId) return;
  const room = rooms.get(client.roomId);
  client.roomId = null;
  if (!room) return;

  const wasPlaying = room.status === "playing";
  clearRoomAutoStart(room);
  room.players = room.players.filter((pl) => pl.id !== client.id);
  if (room.roundTimer) {
    clearTimeout(room.roundTimer);
    room.roundTimer = null;
  }

  if (room.players.length === 0) {
    rooms.delete(room.id);
  } else {
    room.status = "lobby";
    room.hostIp = room.players[0].client.ip;
    room.players[0].ready = false;
    if (wasPlaying) {
      sendWsJson(room.players[0].client, {
        type: "opponent_left",
        room: serializeRoomDetail(room),
      });
    } else {
      broadcastRoomUpdate(room);
    }
  }
  broadcastLobbies();
}

function handleClientMessage(client, msg) {
  if (!msg || typeof msg.type !== "string") return;

  if (msg.type === "ping") {
    sendWsJson(client, { type: "pong", t: msg.t });
    return;
  }

  if (msg.type === "list_lobbies") {
    pruneRooms();
    const list = [...rooms.values()]
      .filter((r) => r.status === "lobby" && r.players.length > 0 && r.players.length < 2)
      .map((r) => serializeRoomFor(r, client.ip))
      .sort((a, b) => Number(b.sameNetwork) - Number(a.sameNetwork));
    sendWsJson(client, { type: "lobbies", lobbies: list });
    return;
  }

  if (msg.type === "create_lobby") {
    pruneRooms();
    const now = Date.now();
    if (now - (client.lastLobbyCreatedAt || 0) < CREATE_LOBBY_COOLDOWN_MS) {
      sendWsJson(client, { type: "error", message: "Please wait a moment before creating another lobby." });
      return;
    }
    const existingOwn = client.roomId && rooms.has(client.roomId);
    if (!existingOwn && rooms.size >= MAX_ROOMS) {
      sendWsJson(client, { type: "error", message: "Arena lobbies are full right now. Please join an open lobby!" });
      return;
    }
    const hostedByIp = [...rooms.values()].filter((r) => r.hostIp === client.ip && r.id !== client.roomId).length;
    if (hostedByIp >= MAX_ROOMS_PER_IP) {
      sendWsJson(client, { type: "error", message: "Too many active lobbies from your network." });
      return;
    }
    removeClientFromRoom(client);
    client.lastLobbyCreatedAt = now;
    const id = `arena_${nextRoomNum++}_${crypto.randomBytes(2).toString("hex")}`;
    const safeHeroName = sanitizeText(msg.heroName, "Sir Aldric", 20);
    const cleanName = sanitizeText(msg.name, `${safeHeroName}'s Arena`, 28);
    const room = {
      id,
      name: cleanName,
      mapId: Math.max(0, Math.min(3, Number(msg.mapId) || 0)),
      passwordHash: hashPassword(String(msg.password || "").slice(0, 32)),
      hostIp: client.ip,
      status: "lobby",
      round: 1,
      roundEnded: false,
      roundTimer: null,
      autoStartTimer: null,
      autoStartAt: 0,
      scores: [0, 0],
      players: [
        {
          id: client.id,
          client,
          heroName: safeHeroName,
          heroClass: ["mage", "gilded", "ranger"].includes(msg.heroClass) ? msg.heroClass : "gilded",
          appVersion: sanitizeText(msg.appVersion, "unknown", 20),
          loadout: sanitizeLoadout(msg.loadout),
          ready: false,
        },
      ],
    };
    rooms.set(id, room);
    client.roomId = id;
    sendWsJson(client, { type: "lobby_joined", slot: 0, room: serializeRoomDetail(room) });
    broadcastLobbies();
    return;
  }

  if (msg.type === "join_lobby") {
    const room = rooms.get(msg.roomId);
    if (!room) {
      sendWsJson(client, { type: "error", message: "Lobby no longer exists." });
      return;
    }
    if (room.status !== "lobby" || room.players.length >= 2) {
      sendWsJson(client, { type: "error", message: "Lobby is already full or in a match." });
      return;
    }
    if (room.passwordHash && hashPassword(String(msg.password || "").slice(0, 32)) !== room.passwordHash) {
      sendWsJson(client, { type: "error", code: "bad_password", message: "Incorrect room password." });
      return;
    }
    removeClientFromRoom(client);
    room.players.push({
      id: client.id,
      client,
      heroName: sanitizeText(msg.heroName, "Challenger", 20),
      heroClass: ["mage", "gilded", "ranger"].includes(msg.heroClass) ? msg.heroClass : "gilded",
      appVersion: sanitizeText(msg.appVersion, "unknown", 20),
      loadout: sanitizeLoadout(msg.loadout),
      ready: false,
    });
    client.roomId = room.id;
    sendWsJson(client, { type: "lobby_joined", slot: 1, room: serializeRoomDetail(room) });
    broadcastRoomUpdate(room);
    broadcastLobbies();
    return;
  }

  if (msg.type === "leave_lobby") {
    removeClientFromRoom(client);
    sendWsJson(client, { type: "lobby_left" });
    return;
  }

  const room = client.roomId ? rooms.get(client.roomId) : null;
  if (!room) return;
  const pIdx = room.players.findIndex((pl) => pl.id === client.id);
  if (pIdx < 0) return;

  if (msg.type === "update_player") {
    const pl = room.players[pIdx];
    if (typeof msg.heroName === "string") pl.heroName = sanitizeText(msg.heroName, pl.heroName, 20);
    if (["mage", "gilded", "ranger"].includes(msg.heroClass)) pl.heroClass = msg.heroClass;
    if (typeof msg.appVersion === "string" && msg.appVersion.trim()) pl.appVersion = sanitizeText(msg.appVersion, pl.appVersion, 20);
    if (Array.isArray(msg.loadout)) pl.loadout = sanitizeLoadout(msg.loadout) || pl.loadout;
    if (typeof msg.ready === "boolean") pl.ready = msg.ready;
    if (pIdx === 0 && msg.mapId !== undefined) {
      room.mapId = Math.max(0, Math.min(3, Number(msg.mapId) || 0));
    }
    const allReady = room.status === "lobby" && room.players.length === 2 && room.players.every((x) => x.ready) && !hasVersionMismatch(room);
    if (allReady && !room.autoStartTimer) {
      room.autoStartAt = Date.now() + 3200;
      room.autoStartTimer = setTimeout(() => {
        if (rooms.has(room.id) && room.status === "lobby" && room.players.length === 2 && room.players.every((x) => x.ready) && !hasVersionMismatch(room)) {
          launchPvpRoomMatch(room);
        } else {
          clearRoomAutoStart(room);
        }
      }, 3200);
    } else if (!allReady) {
      clearRoomAutoStart(room);
    }
    broadcastRoomUpdate(room);
    broadcastLobbies();
    return;
  }

  if (msg.type === "start_match" && pIdx === 0) {
    if (room.players.length < 2) {
      sendWsJson(client, { type: "error", message: "Waiting for a challenger to join!" });
      return;
    }
    if (hasVersionMismatch(room)) {
      sendWsJson(client, { type: "error", code: "version_mismatch", message: "Game version didn't match! Please update the game before starting." });
      return;
    }
    if (!room.players.every((pl) => pl.ready)) {
      sendWsJson(client, { type: "error", message: "Both fighters must press Ready first!" });
      return;
    }
    launchPvpRoomMatch(room);
    return;
  }

  if (msg.type === "round_lost") {
    if (typeof msg.round === "number" && msg.round < room.round) return;
    finishPvpRound(room, pIdx === 0 ? 1 : 0, "ko");
    return;
  }

  if (msg.type === "claim_round_win") {
    if (room.status !== "playing" || room.roundEnded || room.players.length < 2) return;
    if (typeof msg.round === "number" && msg.round < room.round) return;
    const peer = room.players[pIdx === 0 ? 1 : 0];
    if (!peer) return;
    const peerSilentMs = Date.now() - (peer.lastSyncAt || room.roundStartedAt || 0);
    if ((peer.lastHp ?? 1000) <= 0 || (peer.estHp ?? 1000) <= 0 || peerSilentMs > 900) {
      finishPvpRound(room, pIdx, "ko");
    }
    return;
  }

  if (msg.type === "round_timeout") {
    if (typeof msg.round === "number" && msg.round < room.round) return;
    if (room.status !== "playing" || room.roundEnded || room.players.length < 2) return;
    const hp0 = Number.isFinite(room.players[0].lastHp) ? room.players[0].lastHp : 1000;
    const hp1 = Number.isFinite(room.players[1].lastHp) ? room.players[1].lastHp : 1000;
    const winnerIdx = hp0 === hp1 ? -1 : hp0 > hp1 ? 0 : 1;
    finishPvpRound(room, winnerIdx, "timeout");
    return;
  }

  if (msg.type === "pvp_sync" && typeof msg.hp === "number") {
    if (room.status !== "playing" || room.roundEnded) return;
    if (typeof msg.round === "number" && msg.round < room.round) return;
    const pl = room.players[pIdx];
    const now = Date.now();
    if (Number.isFinite(msg.x)) pl.lastX = clampNum(msg.x, 0, 40, pl.lastX ?? 0);
    if (Number.isFinite(msg.y)) pl.lastY = clampNum(msg.y, 0, 40, pl.lastY ?? 0);
    let clampedHp = clampNum(msg.hp, 0, 1000, pl.lastHp ?? 1000);
    if (pl.bgDmgApplied && Number.isFinite(pl.estHp)) {
      if (clampedHp > pl.estHp) {
        clampedHp = pl.estHp;
        sendWsJson(pl.client, { type: "pvp_server_hp", round: room.round, hp: clampedHp });
      }
      pl.bgDmgApplied = false;
    }
    pl.lastSyncAt = now;
    pl.lastHp = clampedHp;
    pl.estHp = clampedHp;
    if (!room.roundEnded && pl.lastHp <= 0) {
      finishPvpRound(room, pIdx === 0 ? 1 : 0, "ko");
    }
    const peer = room.players[pIdx === 0 ? 1 : 0];
    if (peer) {
      sendWsJson(peer.client, { ...msg, hp: clampedHp, fromSlot: pIdx });
    }
    return;
  }

  if (msg.type === "pvp_hit") {
    if (room.status !== "playing" || room.roundEnded || room.players.length < 2) return;
    if (typeof msg.round === "number" && msg.round !== room.round) return;
    const now = Date.now();
    if (now - (client.hitWindowStart || 0) >= 1000) {
      client.hitWindowStart = now;
      client.hitCount = 0;
    }
    client.hitCount = (client.hitCount || 0) + 1;
    if (client.hitCount > MAX_PVP_HIT_RATE) return;

    const rawDmg = Number(msg.dmg);
    if (!Number.isFinite(rawDmg) || rawDmg <= 0) return;
    const pl = room.players[pIdx];
    const peerIdx = pIdx === 0 ? 1 : 0;
    const peer = room.players[peerIdx];
    if (!peer) return;

    if (
      Number.isFinite(pl.lastX) &&
      Number.isFinite(pl.lastY) &&
      Number.isFinite(peer.lastX) &&
      Number.isFinite(peer.lastY)
    ) {
      const dist = Math.hypot(pl.lastX - peer.lastX, pl.lastY - peer.lastY);
      const maxRange = msg.isSkill || msg.isRanged ? 15.5 : 5.5;
      if (dist > maxRange) return;
    }

    const validatedHit = {
      type: "pvp_hit",
      fromSlot: pIdx,
      round: room.round,
      dmg: Math.max(1, Math.min(MAX_PVP_HIT_DMG, Math.round(rawDmg))),
      isCrit: Boolean(msg.isCrit),
      source: sanitizeText(msg.source, "strike", 32),
      knockX: clampNum(msg.knockX, -8, 8, 0),
      knockY: clampNum(msg.knockY, -8, 8, 0),
      stunDur: clampNum(msg.stunDur, 0, 1.8, 0),
      freezeDur: clampNum(msg.freezeDur, 0, 2.2, 0),
      sunderDur: clampNum(msg.sunderDur, 0, 4.0, 0),
      isSkill: Boolean(msg.isSkill),
      isRanged: Boolean(msg.isRanged),
    };

    // If rival client stopped syncing (Alt+Tab, menu, or mobile Home screen pause), apply server-side damage
    const rivalSilentMs = now - (peer.lastSyncAt || room.roundStartedAt || now);
    const roundAgeMs = now - (room.roundStartedAt || now);
    if (roundAgeMs > 2500 && rivalSilentMs > 800) {
      const srvDmg = Math.max(1, Math.round(validatedHit.dmg * 0.72));
      const baseHp = Number.isFinite(peer.estHp) ? peer.estHp : (peer.lastHp ?? 1000);
      peer.estHp = Math.max(0, baseHp - srvDmg);
      peer.lastHp = peer.estHp;
      peer.bgDmgApplied = true;
      sendWsJson(pl.client, {
        type: "pvp_sync",
        fromSlot: peerIdx,
        round: room.round,
        hp: peer.estHp,
        maxHp: 1000,
      });
      sendWsJson(peer.client, {
        type: "pvp_server_hp",
        round: room.round,
        hp: peer.estHp,
      });
      if (peer.estHp <= 0) {
        finishPvpRound(room, pIdx, "ko");
        return;
      }
    } else if (!room.lethalVerifyTimer && (peer.lastHp ?? 1000) - Math.round(validatedHit.dmg * 0.55) <= 0) {
      const roundSnap = room.round;
      const hitAt = now;
      room.lethalVerifyTimer = setTimeout(() => {
        room.lethalVerifyTimer = null;
        if (!rooms.has(room.id) || room.status !== "playing" || room.roundEnded || room.round !== roundSnap) return;
        const curPeer = room.players[peerIdx];
        if (!curPeer) return;
        const confirmedAlive = (curPeer.lastSyncAt || 0) > hitAt + 150 && (curPeer.lastHp ?? 0) > 0;
        if (!confirmedAlive) {
          finishPvpRound(room, pIdx, "ko");
        }
      }, 1000);
    }

    sendWsJson(peer.client, validatedHit);
    return;
  }

  // Forward real-time gameplay events (pvp_action, pvp_prop)
  const peer = room.players[pIdx === 0 ? 1 : 0];
  if (peer && (msg.type === "pvp_action" || msg.type === "pvp_prop")) {
    sendWsJson(peer.client, { ...msg, fromSlot: pIdx });
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const urlClean = (req.url || "/").split("?")[0];
  if (urlClean === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, clients: clients.size, lobbies: rooms.size }));
    return;
  }
  if (urlClean === "/api/lan-info") {
    const ips = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const addr of list || []) {
        if (addr.family === "IPv4" && !addr.internal) ips.push(addr.address);
      }
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, port: PORT, hostname: os.hostname(), ips, urls: ips.map((ip) => `ws://${ip}:${PORT}/ws`) }));
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method Not Allowed");
    return;
  }

  let filePath = resolveSafePath(req.url || "/");
  if (!filePath) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad Request");
    return;
  }

  try {
    let stat = await fs.promises.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      stat = await fs.promises.stat(filePath);
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size,
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    const stream = fs.createReadStream(filePath);
    stream.on("error", () => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      }
      res.end("Internal Server Error");
    });
    stream.pipe(res);
  } catch (err) {
    const status = err && (err.code === "ENOENT" || err.code === "ENOTDIR") ? 404 : 500;
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(status === 404 ? "Not Found" : "Internal Server Error");
  }
});

// Pure Node RFC 6455 WebSocket upgrade handler on /ws
server.on("upgrade", (req, socket) => {
  const upgradeHdr = String(req.headers.upgrade || "").toLowerCase();
  const key = req.headers["sec-websocket-key"];
  if (upgradeHdr !== "websocket" || !key) {
    socket.destroy();
    return;
  }

  const clientIp = normalizeIp(req.headers["x-forwarded-for"] || req.socket.remoteAddress);
  if (clients.size >= MAX_WS_CLIENTS) {
    socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const ipConnCount = [...clients.values()].filter((c) => c.ip === clientIp).length;
  if (ipConnCount >= MAX_CLIENTS_PER_IP) {
    socket.write("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  const acceptKey = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
  );

  const client = {
    id: `c_${nextClientId++}`,
    ip: clientIp,
    socket,
    roomId: null,
    lastSeen: Date.now(),
    lastLobbyCreatedAt: 0,
    msgWindowStart: Date.now(),
    msgCount: 0,
    hitWindowStart: Date.now(),
    hitCount: 0,
  };
  clients.set(client.id, client);
  sendWsJson(client, { type: "welcome", id: client.id, ip: clientIp });

  let rxBuf = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    const now = Date.now();
    client.lastSeen = now;
    rxBuf = Buffer.concat([rxBuf, chunk]);
    while (rxBuf.length >= 2) {
      const b0 = rxBuf[0];
      const b1 = rxBuf[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (rxBuf.length < 4) break;
        payloadLen = rxBuf.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (rxBuf.length < 10) break;
        payloadLen = Number(rxBuf.readBigUInt64BE(2));
        offset = 10;
      }
      if (payloadLen > 262144) {
        socket.destroy();
        return;
      }
      const maskLen = masked ? 4 : 0;
      if (rxBuf.length < offset + maskLen + payloadLen) break;

      let payload = rxBuf.subarray(offset + maskLen, offset + maskLen + payloadLen);
      if (masked) {
        const maskKey = rxBuf.subarray(offset, offset + 4);
        const decoded = Buffer.alloc(payloadLen);
        for (let i = 0; i < payloadLen; i++) {
          decoded[i] = payload[i] ^ maskKey[i & 3];
        }
        payload = decoded;
      }
      rxBuf = rxBuf.subarray(offset + maskLen + payloadLen);

      if (opcode === 0x8) {
        socket.end();
        return;
      }
      if (opcode === 0x9) {
        try {
          socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
        } catch {}
        continue;
      }
      if (opcode === 0xA) continue;
      if (opcode === 0x1) {
        const msgNow = Date.now();
        if (msgNow - (client.msgWindowStart || 0) >= 1000) {
          client.msgWindowStart = msgNow;
          client.msgCount = 0;
        }
        client.msgCount += 1;
        try {
          const parsed = JSON.parse(payload.toString("utf8"));
          const isCriticalMsg =
            parsed &&
            (parsed.type === "round_lost" ||
              parsed.type === "round_timeout" ||
              parsed.type === "leave_lobby" ||
              (parsed.type === "pvp_sync" && Number(parsed.hp) <= 0));
          if (!isCriticalMsg && client.msgCount > WS_MSG_RATE_LIMIT) {
            continue;
          }
          handleClientMessage(client, parsed);
        } catch {}
      }
    }
  });

  const cleanup = () => {
    if (!clients.has(client.id)) return;
    clients.delete(client.id);
    removeClientFromRoom(client);
  };
  socket.on("close", cleanup);
  socket.on("error", cleanup);
});

// Sweep stale/disconnected clients every 15s so empty or abandoned lobbies vanish promptly
setInterval(() => {
  const now = Date.now();
  let removedAny = false;
  for (const client of [...clients.values()]) {
    if (!isClientAlive(client) || now - (client.lastSeen || 0) > 40000) {
      clients.delete(client.id);
      try { client.socket?.destroy(); } catch {}
      removeClientFromRoom(client);
      removedAny = true;
    } else {
      try { client.socket.write(Buffer.from([0x89, 0x00])); } catch {}
    }
  }
  if (!removedAny && pruneRooms()) {
    broadcastLobbies();
  }
}, 15000);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Serving Chronicles of the Shattered Crown at http://localhost:${PORT}`);
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const addr of list || []) {
      if (addr.family === "IPv4" && !addr.internal) {
        console.log(`  Same-Network LAN URL: http://${addr.address}:${PORT}`);
      }
    }
  }

  // UDP Wi-Fi discovery responder so Android APK / LAN peers can auto-find this PC host on port 8081
  if (!process.env.RENDER) {
    try {
      const udp = dgram.createSocket({ type: "udp4", reuseAddr: true });
      udp.on("message", (msg, rinfo) => {
        if (msg.toString("utf8").trim() === "DISCOVER_SHATTERED_CROWN") {
          const info = Buffer.from(
            JSON.stringify({ name: `${os.hostname()} (PC)`, port: PORT, clients: clients.size, lobbies: rooms.size }),
            "utf8"
          );
          udp.send(info, rinfo.port, rinfo.address, () => {});
        }
      });
      udp.on("error", () => {});
      udp.bind(8081, "0.0.0.0");
    } catch {}
  }
});
