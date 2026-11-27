const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const dgram = require("dgram");

const PORT = Number(process.argv[2] || process.env.PORT) || 8080;
const ROOT_DIR = path.resolve(__dirname);

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

/** Resolve a URL path safely within ROOT_DIR, returning null on invalid or escaping paths. */
function resolveSafePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }
  const relative = decoded.replace(/^\/+/, "");
  const fullPath = path.resolve(ROOT_DIR, relative);
  if (fullPath !== ROOT_DIR && !fullPath.startsWith(ROOT_DIR + path.sep)) {
    return null;
  }
  return fullPath;
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

function broadcastLobbies() {
  for (const client of clients.values()) {
    const list = [...rooms.values()]
      .filter((r) => r.status === "lobby" && r.players.length < 2)
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

function finishPvpRound(room, winnerIdx, reason = "ko") {
  if (!room || room.status !== "playing" || room.roundEnded || room.players.length < 2) return;
  room.roundEnded = true;
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
      pl.lastHp = 5000;
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
      room.players.forEach((pl) => { pl.lastHp = 5000; });
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
  room.status = "playing";
  room.round = 1;
  room.roundEnded = false;
  room.scores = [0, 0];
  room.players.forEach((pl) => { pl.lastHp = 5000; });
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
    const list = [...rooms.values()]
      .filter((r) => r.status === "lobby" && r.players.length < 2)
      .map((r) => serializeRoomFor(r, client.ip))
      .sort((a, b) => Number(b.sameNetwork) - Number(a.sameNetwork));
    sendWsJson(client, { type: "lobbies", lobbies: list });
    return;
  }

  if (msg.type === "create_lobby") {
    removeClientFromRoom(client);
    const id = `arena_${nextRoomNum++}_${crypto.randomBytes(2).toString("hex")}`;
    const cleanName = String(msg.name || `${msg.heroName || "Sir Aldric"}'s Arena`).trim().slice(0, 28) || "Dungeon Arena";
    const room = {
      id,
      name: cleanName,
      mapId: Math.max(0, Math.min(3, Number(msg.mapId) || 0)),
      passwordHash: hashPassword(msg.password || ""),
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
          heroName: String(msg.heroName || "Sir Aldric").trim().slice(0, 20) || "Sir Aldric",
          heroClass: ["mage", "gilded", "ranger"].includes(msg.heroClass) ? msg.heroClass : "gilded",
          appVersion: String(msg.appVersion || "unknown").trim().slice(0, 20),
          loadout: Array.isArray(msg.loadout) ? msg.loadout.slice(0, 4) : null,
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
    if (room.passwordHash && hashPassword(msg.password || "") !== room.passwordHash) {
      sendWsJson(client, { type: "error", code: "bad_password", message: "Incorrect room password." });
      return;
    }
    removeClientFromRoom(client);
    room.players.push({
      id: client.id,
      client,
      heroName: String(msg.heroName || "Challenger").trim().slice(0, 20) || "Challenger",
      heroClass: ["mage", "gilded", "ranger"].includes(msg.heroClass) ? msg.heroClass : "gilded",
      appVersion: String(msg.appVersion || "unknown").trim().slice(0, 20),
      loadout: Array.isArray(msg.loadout) ? msg.loadout.slice(0, 4) : null,
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
    if (typeof msg.heroName === "string") pl.heroName = msg.heroName.trim().slice(0, 20) || pl.heroName;
    if (["mage", "gilded", "ranger"].includes(msg.heroClass)) pl.heroClass = msg.heroClass;
    if (typeof msg.appVersion === "string" && msg.appVersion.trim()) pl.appVersion = msg.appVersion.trim().slice(0, 20);
    if (Array.isArray(msg.loadout)) pl.loadout = msg.loadout.slice(0, 4);
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
    if (typeof msg.round === "number" && msg.round !== room.round) return;
    finishPvpRound(room, pIdx === 0 ? 1 : 0, "ko");
    return;
  }

  if (msg.type === "round_timeout") {
    if (typeof msg.round === "number" && msg.round !== room.round) return;
    if (room.status !== "playing" || room.roundEnded || room.players.length < 2) return;
    const hp0 = Number.isFinite(room.players[0].lastHp) ? room.players[0].lastHp : 5000;
    const hp1 = Number.isFinite(room.players[1].lastHp) ? room.players[1].lastHp : 5000;
    const winnerIdx = hp0 === hp1 ? -1 : hp0 > hp1 ? 0 : 1;
    finishPvpRound(room, winnerIdx, "timeout");
    return;
  }

  if (msg.type === "pvp_sync" && typeof msg.hp === "number") {
    if (typeof msg.round === "number" && msg.round !== room.round) return;
    room.players[pIdx].lastHp = Math.max(0, msg.hp);
    if (room.status === "playing" && !room.roundEnded && room.players[pIdx].lastHp <= 0) {
      finishPvpRound(room, pIdx === 0 ? 1 : 0, "ko");
    }
  }

  // Forward real-time gameplay events (pvp_sync, pvp_action, pvp_hit, pvp_prop)
  const peer = room.players[pIdx === 0 ? 1 : 0];
  if (peer) {
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

  const clientIp = normalizeIp(req.headers["x-forwarded-for"] || req.socket.remoteAddress);
  const client = {
    id: `c_${nextClientId++}`,
    ip: clientIp,
    socket,
    roomId: null,
  };
  clients.set(client.id, client);
  sendWsJson(client, { type: "welcome", id: client.id, ip: clientIp });

  let rxBuf = Buffer.alloc(0);
  socket.on("data", (chunk) => {
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
      if (opcode === 0x1) {
        try {
          const parsed = JSON.parse(payload.toString("utf8"));
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
