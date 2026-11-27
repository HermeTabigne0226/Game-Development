import { ACTS, DIFFICULTIES, ELITE_AFFIXES, ENEMIES, ITEMS, getItemPrice } from "./data.js";

export const MAP_W = 36;
export const MAP_H = 24;

export const TILE = {
  WALL: 0,
  FLOOR: 1,
  STAIRS: 2,
};

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function getActForFloor(floor) {
  if (floor <= 12) {
    return ACTS.find((a) => a.floors.includes(floor)) || ACTS[ACTS.length - 1];
  }
  const endlessDepth = floor - 12;
  const cycle = Math.floor((endlessDepth - 1) / 4);
  const bossCycle = ["royal_goblin", "gilded_knight", "void_king"];
  const bossId = bossCycle[cycle % bossCycle.length];
  const tileCycle = [0, 1, 3];
  const floorTileIdx = tileCycle[cycle % tileCycle.length];
  const bossFloor = 12 + (cycle + 1) * 4;
  return {
    id: 4 + cycle,
    name: `Endless Abyss — Depth ${endlessDepth}`,
    floors: [floor],
    floorTileIdx,
    accentTileIdx: 0,
    bossFloor,
    bossId,
    shardIndex: undefined,
    isEndless: true,
  };
}

export function generateFloor(floor, difficultyId = "normal") {
  for (let genTry = 0; genTry < 25; genTry++) {
    const candidate = buildFloorCandidate(floor, difficultyId);
    if (isFloorConnected(candidate) || genTry === 24) {
      return candidate;
    }
  }
}

function isFloorConnected(lvl) {
  const vis = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(false));
  const bossDoor = lvl.props.find((p) => p.isBossDoor);
  const q = [[lvl.playerStart.x, lvl.playerStart.y]];
  vis[lvl.playerStart.y][lvl.playerStart.x] = true;

  while (q.length > 0) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H || vis[ny][nx]) continue;
      if (lvl.grid[ny][nx] === TILE.WALL) continue;
      if (bossDoor && nx === bossDoor.x && ny === bossDoor.y) {
        vis[ny][nx] = true;
        continue;
      }
      vis[ny][nx] = true;
      q.push([nx, ny]);
    }
  }

  for (const e of lvl.enemies) {
    if (!e.isBoss && !vis[Math.floor(e.y)]?.[Math.floor(e.x)]) return false;
  }
  for (const n of lvl.npcs) {
    if (!vis[n.y]?.[n.x]) return false;
  }
  for (const s of lvl.shops || []) {
    if (!vis[s.y]?.[s.x]) return false;
  }
  if (lvl.isBossFloor) {
    if (!bossDoor || !vis[bossDoor.y]?.[bossDoor.x]) return false;
  } else if (!vis[lvl.stairsPos.y]?.[lvl.stairsPos.x]) {
    return false;
  }
  return true;
}

function carveCorridorAvoiding(grid, ax, ay, bx, by, isBlocked) {
  const queue = [[ax, ay]];
  const parent = new Map([[`${ax},${ay}`, null]]);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (queue.length > 0) {
    const [qx, qy] = queue.shift();
    if (qx === bx && qy === by) {
      let cur = `${bx},${by}`;
      while (cur) {
        const [px, py] = cur.split(",").map(Number);
        grid[py][px] = TILE.FLOOR;
        cur = parent.get(cur);
      }
      return true;
    }
    for (const [ox, oy] of dirs) {
      const nx = qx + ox;
      const ny = qy + oy;
      const key = `${nx},${ny}`;
      if (nx >= 1 && nx < MAP_W - 1 && ny >= 1 && ny < MAP_H - 1 && !parent.has(key) && (!isBlocked || !isBlocked(nx, ny))) {
        parent.set(key, `${qx},${qy}`);
        queue.push([nx, ny]);
      }
    }
  }
  return false;
}

export function createScaledEnemy(templateId, floor, difficultyId = "normal", roomIndex = 1, x = 2, y = 2, options = {}) {
  const diff = DIFFICULTIES[difficultyId] || DIFFICULTIES.normal;
  const tpl = ENEMIES[templateId] || ENEMIES.slime;
  const endlessExtra = floor > 12 ? (floor - 12) * 0.22 : 0;
  const scale = (1 + (floor - 1) * 0.28 + Math.floor((floor - 1) / 4) * 0.25 + endlessExtra) * diff.hpMult;
  const atkScale = (1 + (floor - 1) * 0.22 + Math.floor((floor - 1) / 4) * 0.18 + endlessExtra * 0.7) * diff.atkMult;
  const scaledDef = Math.round(
    ((tpl.def || 0) + (floor - 1) * 1.15 + Math.floor((floor - 1) / 4) * 2) * (0.85 + diff.hpMult * 0.15)
  );

  const affix = options.affix ? ELITE_AFFIXES[options.affix] : null;
  const hp = Math.round(tpl.hp * scale * (affix ? affix.hpMult : 1));
  const atk = Math.round(tpl.atk * atkScale * (affix ? affix.atkMult : 1));
  const def = scaledDef + (affix ? affix.defBonus : 0);
  const speed = (tpl.speed || 2.0) * (affix ? affix.speedMult : 1);
  const attackCd = (tpl.attackCd || 1.05) / (affix?.id === "swift" ? 1.25 : 1);
  const rangedCd = tpl.rangedCd ? tpl.rangedCd / (affix?.id === "swift" ? 1.2 : 1) : undefined;

  return {
    uid: options.uid || `e_${floor}_${roomIndex}_${Math.random().toString(36).slice(2, 7)}`,
    ...tpl,
    name: affix ? `${affix.label} ${tpl.name}` : tpl.name,
    isElite: Boolean(affix),
    eliteAffix: affix ? affix.id : null,
    eliteColor: affix ? affix.color : null,
    elitePulseCd: affix?.id === "blazing" ? 2.5 : 0,
    roomIndex,
    hp,
    maxHp: hp,
    atk,
    def,
    speed,
    attackCd,
    rangedCd,
    xp: Math.round((tpl.xp || 10) * (affix ? 1.85 : 1)),
    gold: Math.round((tpl.gold || 6) * (affix ? 2.1 : 1)),
    x,
    y,
    vx: 0,
    vy: 0,
    kbX: 0,
    kbY: 0,
    facingLeft: true,
    anim: "idle",
    animTimer: 0,
    attackTimer: 0.4 + Math.random() * 0.4,
    windupTimer: 0,
    rangedTimer: 1.2 + Math.random() * 0.7,
    chilled: 0,
    hurtTimer: 0,
    bobPhase: Math.random() * Math.PI * 2,
  };
}

function buildFloorCandidate(floor, difficultyId = "normal") {
  const diff = DIFFICULTIES[difficultyId] || DIFFICULTIES.normal;
  const act = getActForFloor(floor);
  const isBossFloor = floor === act.bossFloor;

  const grid = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(TILE.WALL));
  const explored = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(false));
  const visible = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(false));

  const rooms = [];
  let reservedBossRoom = null;

  if (isBossFloor) {
    const bw = randInt(15, 17);
    const bh = randInt(12, 14);
    const bossOnRight = Math.random() < 0.5;
    const bx = bossOnRight ? MAP_W - bw - 2 : 2;
    const by = randInt(2, MAP_H - bh - 2);
    reservedBossRoom = {
      x: bx,
      y: by,
      w: bw,
      h: bh,
      cx: Math.floor(bx + bw / 2),
      cy: Math.floor(by + bh / 2),
    };
    for (let y = by; y < by + bh; y++) {
      for (let x = bx; x < bx + bw; x++) {
        grid[y][x] = TILE.FLOOR;
      }
    }
  }

  const targetNormalRooms = isBossFloor ? 4 : 11;
  for (let attempt = 0; attempt < 180 && rooms.length < targetNormalRooms; attempt++) {
    const rw = isBossFloor ? randInt(4, 6) : randInt(4, 7);
    const rh = isBossFloor ? randInt(4, 5) : randInt(4, 6);
    const rx = randInt(1, MAP_W - rw - 2);
    const ry = randInt(1, MAP_H - rh - 2);

    const checkList = reservedBossRoom ? [...rooms, reservedBossRoom] : rooms;
    const overlaps = checkList.some(
      (r) => rx <= r.x + r.w + 1 && rx + rw + 1 >= r.x && ry <= r.y + r.h + 1 && ry + rh + 1 >= r.y
    );
    if (overlaps) continue;

    rooms.push({
      x: rx,
      y: ry,
      w: rw,
      h: rh,
      cx: Math.floor(rx + rw / 2),
      cy: Math.floor(ry + rh / 2),
    });

    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) {
        grid[y][x] = TILE.FLOOR;
      }
    }
  }

  if (rooms.length < 2) {
    const fallbackX = reservedBossRoom && reservedBossRoom.x < 10 ? 22 : 2;
    rooms.push({ x: fallbackX, y: 2, w: 5, h: 5, cx: fallbackX + 2, cy: 4 });
    rooms.push({ x: fallbackX, y: 12, w: 5, h: 5, cx: fallbackX + 2, cy: 14 });
    for (const r of rooms) {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) grid[y][x] = TILE.FLOOR;
      }
    }
  }

  if (reservedBossRoom) {
    rooms.push(reservedBossRoom);
  }

  const startRoom = rooms[0];
  const endRoom = rooms[rooms.length - 1];
  const isBossPerimeterOrInside = isBossFloor
    ? (tx, ty) => tx >= endRoom.x - 1 && tx <= endRoom.x + endRoom.w && ty >= endRoom.y - 1 && ty <= endRoom.y + endRoom.h
    : null;

  const connectCount = isBossFloor ? rooms.length - 1 : rooms.length;
  for (let i = 1; i < connectCount; i++) {
    const a = rooms[i - 1];
    const b = rooms[i];
    if (isBossPerimeterOrInside) {
      carveCorridorAvoiding(grid, a.cx, a.cy, b.cx, b.cy, isBossPerimeterOrInside);
      continue;
    }
    let x = a.cx;
    let y = a.cy;
    const horizFirst = Math.random() < 0.5;
    if (horizFirst) {
      while (x !== b.cx) {
        grid[y][x] = TILE.FLOOR;
        x += x < b.cx ? 1 : -1;
      }
      while (y !== b.cy) {
        grid[y][x] = TILE.FLOOR;
        y += y < b.cy ? 1 : -1;
      }
    } else {
      while (y !== b.cy) {
        grid[y][x] = TILE.FLOOR;
        y += y < b.cy ? 1 : -1;
      }
      while (x !== b.cx) {
        grid[y][x] = TILE.FLOOR;
        x += x < b.cx ? 1 : -1;
      }
    }
  }

  const playerStart = { x: startRoom.cx, y: startRoom.cy };
  const stairsPos = { x: endRoom.cx, y: endRoom.cy };

  const occupied = new Set([`${playerStart.x},${playerStart.y}`, `${stairsPos.x},${stairsPos.y}`]);
  const props = [];
  const enemies = [];
  const npcs = [];
  const shops = [];
  const traps = [];

  const generateShopStock = (fl) => {
    const stock = [
      { item: { ...ITEMS.health_potion }, price: getItemPrice(ITEMS.health_potion), maxBuys: 5, buys: 0, sold: false },
      { item: { ...ITEMS.mana_potion }, price: getItemPrice(ITEMS.mana_potion), maxBuys: 5, buys: 0, sold: false },
      { item: { ...ITEMS.scroll_smite }, price: getItemPrice(ITEMS.scroll_smite), maxBuys: 1, buys: 0, sold: false },
    ];
    const equipList = Object.values(ITEMS).filter((it) => it.slot);
    const tiers =
      fl <= 4
        ? ["uncommon", "rare", "unique"]
        : fl <= 8
          ? ["rare", "unique", "legendary"]
          : ["unique", "legendary", "legendary"];
    const chosenIds = new Set();
    for (const rKey of tiers) {
      const pool = equipList.filter((it) => it.rarity === rKey && !chosenIds.has(it.id));
      if (pool.length > 0) {
        const picked = pick(pool);
        chosenIds.add(picked.id);
        stock.push({ item: { ...picked }, price: getItemPrice(picked), maxBuys: 1, buys: 0, sold: false });
      }
    }
    return stock;
  };

  const freeTileInRoom = (room) => {
    for (let t = 0; t < 24; t++) {
      const tx = randInt(room.x, room.x + room.w - 1);
      const ty = randInt(room.y, room.y + room.h - 1);
      const key = `${tx},${ty}`;
      if (!occupied.has(key) && grid[ty][tx] === TILE.FLOOR) {
        occupied.add(key);
        return { x: tx, y: ty };
      }
    }
    return null;
  };

  if (isBossFloor) {
    const br = endRoom;
    for (let y = br.y - 1; y <= br.y + br.h; y++) {
      for (let x = br.x - 1; x <= br.x + br.w; x++) {
        if (y >= 0 && y < MAP_H && x >= 0 && x < MAP_W) {
          const inside = x >= br.x && x < br.x + br.w && y >= br.y && y < br.y + br.h;
          grid[y][x] = inside ? TILE.FLOOR : TILE.WALL;
        }
      }
    }

    const prev = rooms[rooms.length - 2];
    const candidates = [
      { dx: br.cx, dy: br.y - 1, outX: br.cx, outY: br.y - 2 },
      { dx: br.cx, dy: br.y + br.h, outX: br.cx, outY: br.y + br.h + 1 },
      { dx: br.x - 1, dy: br.cy, outX: br.x - 2, outY: br.cy },
      { dx: br.x + br.w, dy: br.cy, outX: br.x + br.w + 1, outY: br.cy },
    ].filter((c) => c.outX >= 1 && c.outX < MAP_W - 1 && c.outY >= 1 && c.outY < MAP_H - 1);

    candidates.sort(
      (a, b) =>
        Math.hypot(a.outX - prev.cx, a.outY - prev.cy) - Math.hypot(b.outX - prev.cx, b.outY - prev.cy)
    );

    let entry = candidates[0] || { dx: br.cx, dy: br.y - 1, outX: br.cx, outY: br.y - 2 };
    for (const c of candidates) {
      if (carveCorridorAvoiding(grid, prev.cx, prev.cy, c.outX, c.outY, isBossPerimeterOrInside)) {
        entry = c;
        break;
      }
    }

    grid[entry.dy][entry.dx] = TILE.FLOOR;
    occupied.add(`${entry.dx},${entry.dy}`);
    props.push({
      id: `door_${entry.dx}_${entry.dy}`,
      kind: "door",
      x: entry.dx,
      y: entry.dy,
      solid: true,
      opened: false,
      isBossDoor: true,
      locked: true,
    });

    const shopPos = freeTileInRoom(prev) || { x: prev.cx, y: prev.cy };
    shops.push({
      id: "boss_shop",
      name: "Sanctum Quartermaster",
      x: shopPos.x,
      y: shopPos.y,
      stock: generateShopStock(floor),
    });

    const anvilPos = freeTileInRoom(prev);
    if (anvilPos) {
      props.push({ id: `anvil_boss_${floor}`, kind: "anvil", x: anvilPos.x, y: anvilPos.y, solid: true });
    }
  }

  for (const r of rooms) {
    const tPos = freeTileInRoom(r);
    if (tPos) {
      props.push({ id: `torch_${tPos.x}_${tPos.y}`, kind: "torch", x: tPos.x, y: tPos.y, solid: false });
    }
  }

  if (([2, 4, 5, 7, 10].includes(floor) || (floor > 12 && floor % 2 === 0)) && rooms.length > 2) {
    const wPos = freeTileInRoom(rooms[1]);
    if (wPos) {
      props.push({ id: "well", kind: "well", x: wPos.x, y: wPos.y, solid: true, used: false });
    }
  }

  // Shrines on ~55% of non-boss floors (and floor 1+ occasionally)
  if (!isBossFloor && rooms.length > 3 && Math.random() < 0.6) {
    const sPos = freeTileInRoom(rooms[2]);
    if (sPos) {
      props.push({
        id: `shrine_${floor}`,
        kind: "shrine",
        shrineId: Math.random() < 0.5 ? "blood" : "sanctum",
        x: sPos.x,
        y: sPos.y,
        solid: true,
        used: false,
      });
    }
  }

  // Foundry Anvil on ~45% of normal floors from Floor 3+
  if (!isBossFloor && floor >= 3 && rooms.length > 4 && Math.random() < 0.45) {
    const aPos = freeTileInRoom(rooms[3]);
    if (aPos) {
      props.push({ id: `anvil_${floor}`, kind: "anvil", x: aPos.x, y: aPos.y, solid: true });
    }
  }

  // Story NPCs
  const npcMap = { 1: "monk", 3: "rogue", 5: "robot", 7: "monk", 10: "pirate" };
  if (npcMap[floor] && rooms.length > 1) {
    const npcRoom = rooms[Math.min(1, rooms.length - 1)];
    const nPos = freeTileInRoom(npcRoom);
    if (nPos) {
      npcs.push({ id: npcMap[floor], x: nPos.x, y: nPos.y, talked: false });
    }
  }

  // Chests, Ambush Trial Chests & Breakables
  let spawnedTrialChest = false;
  for (let i = 1; i < rooms.length; i++) {
    if (isBossFloor && i === rooms.length - 1) continue;
    const r = rooms[i];
    if (!isBossFloor && !spawnedTrialChest && floor >= 2 && i >= 3 && Math.random() < 0.35) {
      const tcPos = freeTileInRoom(r);
      if (tcPos) {
        spawnedTrialChest = true;
        props.push({ id: `trial_chest_${i}`, kind: "trial_chest", x: tcPos.x, y: tcPos.y, solid: true, opened: false });
      }
    } else if (Math.random() < 0.62) {
      const cPos = freeTileInRoom(r);
      if (cPos) {
        props.push({ id: `chest_${i}`, kind: "chest", x: cPos.x, y: cPos.y, solid: true, opened: false });
      }
    }
    const breakableCount = randInt(1, 2);
    for (let b = 0; b < breakableCount; b++) {
      const bPos = freeTileInRoom(r);
      if (bPos) {
        const kind = pick(["crate", "barrel", "urn"]);
        props.push({ id: `brk_${i}_${b}`, kind, x: bPos.x, y: bPos.y, solid: true, broken: false });
      }
    }
  }

  // Floor Traps (spike or void vent) on normal floors from Floor 2+
  if (!isBossFloor && floor >= 2 && rooms.length > 3) {
    const trapCount = Math.min(5, 1 + Math.floor(floor / 3));
    for (let t = 0; t < trapCount; t++) {
      const rm = rooms[randInt(1, rooms.length - 1)];
      const tp = freeTileInRoom(rm);
      if (tp) {
        traps.push({
          id: `trap_${floor}_${t}`,
          kind: floor >= 9 ? "void_vent" : "spike",
          x: tp.x,
          y: tp.y,
          phase: Math.random() * 3.0,
          period: 3.0,
          hitCd: 0,
        });
      }
    }
  }

  // Act-specific Enemy Pools
  let pool;
  if (floor === 1) {
    pool = ["slime", "bat", "skeleton", "goblin_slinger"];
  } else if (floor <= 4) {
    pool = ["slime", "bat", "skeleton", "goblin_slinger", "orc"];
  } else if (floor <= 8) {
    pool = ["skeleton", "orc", "bat", "goblin_slinger", "clockwork_sentinel"];
  } else if (floor <= 12) {
    pool = ["skeleton", "orc", "clockwork_sentinel", "void_acolyte"];
  } else {
    pool = ["orc", "goblin_slinger", "clockwork_sentinel", "void_acolyte"];
  }

  const eliteKeys = Object.keys(ELITE_AFFIXES);
  const maxElites = floor < 2 ? 0 : floor <= 4 ? 1 : floor <= 8 ? 2 : floor <= 12 ? 3 : 4;
  let elitesSpawned = 0;

  for (let i = 1; i < rooms.length; i++) {
    const r = rooms[i];
    if (isBossFloor && i === rooms.length - 1) continue;
    const count = isBossFloor ? randInt(1, 2) : randInt(1, floor >= 4 ? 3 : 2);
    for (let e = 0; e < count; e++) {
      const ePos = freeTileInRoom(r);
      if (!ePos) continue;
      const tplId = pick(pool);
      const makeElite = elitesSpawned < maxElites && i >= 2 && Math.random() < (floor > 12 ? 0.28 : 0.16);
      const affix = makeElite ? pick(eliteKeys) : null;
      if (makeElite) elitesSpawned += 1;
      enemies.push(
        createScaledEnemy(tplId, floor, difficultyId, i, ePos.x + 0.5, ePos.y + 0.5, {
          uid: `e_${floor}_${i}_${e}`,
          affix,
        })
      );
    }
  }

  if (isBossFloor) {
    const tpl = ENEMIES[act.bossId];
    const endlessExtra = floor > 12 ? (floor - 12) * 0.18 : 0;
    const bossHpScale = (1 + Math.max(0, floor - 4) * 0.06 + endlessExtra) * diff.hpMult;
    const bossAtkScale = (1 + Math.max(0, floor - 4) * 0.04 + endlessExtra * 0.6) * diff.atkMult;
    const bossDef = Math.round(((tpl.def || 4) + floor * 1.4) * (0.85 + diff.hpMult * 0.15));
    enemies.push({
      uid: `boss_${act.bossId}_${floor}`,
      ...tpl,
      roomIndex: rooms.length - 1,
      hp: Math.round(tpl.hp * bossHpScale),
      maxHp: Math.round(tpl.hp * bossHpScale),
      atk: Math.round(tpl.atk * bossAtkScale),
      def: bossDef,
      x: endRoom.cx + 0.5,
      y: endRoom.cy + 0.5,
      z: 0,
      falling: false,
      vx: 0,
      vy: 0,
      kbX: 0,
      kbY: 0,
      facingLeft: true,
      anim: "idle",
      animTimer: 0,
      attackTimer: 0.6,
      windupTimer: 0,
      rangedTimer: 2.0,
      chilled: 0,
      hurtTimer: 0,
      bobPhase: 0,
    });
  }

  return {
    floor,
    act,
    isBossFloor,
    grid,
    explored,
    visible,
    rooms,
    playerStart,
    stairsPos,
    props,
    traps,
    enemies,
    npcs,
    shops,
    groundItems: [],
  };
}

export function computeFOV(level, px, py, radius = 6) {
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      level.visible[y][x] = false;
    }
  }

  const steps = 120;
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let rx = px + 0.5;
    let ry = py + 0.5;

    for (let d = 0; d <= radius; d += 0.35) {
      const tx = Math.floor(rx);
      const ty = Math.floor(ry);
      if (tx < 0 || ty < 0 || tx >= MAP_W || nyOut(ty) || tx >= MAP_W) break;
      level.visible[ty][tx] = true;
      level.explored[ty][tx] = true;
      if (level.grid[ty][tx] === TILE.WALL) break;
      rx += dx * 0.35;
      ry += dy * 0.35;
    }
  }
}

function nyOut(ty) {
  return ty < 0 || ty >= MAP_H;
}
