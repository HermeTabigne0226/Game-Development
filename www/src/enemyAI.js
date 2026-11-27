import { sfx } from "./audio.js";
import { drawSheetFrame } from "./assets.js";
import { damageEnemy, hurtPlayer, recordBestiary, stunPlayer, unlockCodex } from "./combat.js";
import { canOccupy, moveWithSlide, runtime, addFloat, addLog, spawnBurst, spawnRing, TILE_SIZE } from "./state.js";

export function clampPointInBossRoom(x, y, bossRoom, fallbackX, fallbackY) {
  let tx = x;
  let ty = y;
  if (bossRoom) {
    tx = Math.max(bossRoom.x + 0.55, Math.min(bossRoom.x + bossRoom.w - 0.55, tx));
    ty = Math.max(bossRoom.y + 0.55, Math.min(bossRoom.y + bossRoom.h - 0.55, ty));
  }
  if (canOccupy(tx, ty, 0.38)) return { x: tx, y: ty };
  return { x: fallbackX, y: fallbackY };
}

export function findBossTeleportSpot(boss, p, bossRoom) {
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

export function revealBossRoom(lvl, fullVisibility = false) {
  const rooms = lvl?.rooms || [];
  const bossRoom = rooms[rooms.length - 1];
  if (!bossRoom) return;
  for (let y = Math.max(0, bossRoom.y - 1); y <= Math.min(23, bossRoom.y + bossRoom.h); y++) {
    for (let x = Math.max(0, bossRoom.x - 1); x <= Math.min(35, bossRoom.x + bossRoom.w); x++) {
      if (lvl.explored[y]) lvl.explored[y][x] = true;
      if (fullVisibility && lvl.visible[y]) lvl.visible[y][x] = true;
    }
  }
}

export function checkBossSpotted() {
  const s = runtime.state;
  for (const e of s.level.enemies) {
    const ex = Math.floor(e.x);
    const ey = Math.floor(e.y);
    if (e.isBoss && s.level.visible[ey]?.[ex] && !s.seenBosses.has(e.uid)) {
      s.seenBosses.add(e.uid);
      if (e.id === "royal_goblin") unlockCodex("grak");
      if (e.id === "gilded_knight") unlockCodex("aurelius");
      if (e.id === "void_king") unlockCodex("malakor");
      recordBestiary(e, false);
      addLog(`BOSS ENCOUNTER: ${e.name} blocks your path!`, "story");
    }
  }
}

export function startBossMatch(boss, lockDoorNow = true) {
  const s = runtime.state;
  if (s.bossFightStarted) return;
  s.bossFightStarted = true;
  s.bossIntroTimer = 2.1;
  boss.z = 115;
  boss.falling = true;
  revealBossRoom(s.level, true);
  checkBossSpotted();

  if (lockDoorNow) {
    for (const pr of s.level.props) {
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
  if (introAct) introAct.textContent = `${s.level.act.name} — Boss`;
  if (introSkills) introSkills.textContent = boss.bossSkillDesc || `${boss.maxHp} HP`;
  if (introCanvas) {
    const bCtx = introCanvas.getContext("2d");
    bCtx.clearRect(0, 0, 96, 96);
    bCtx.imageSmoothingEnabled = false;
    if (boss.isSheet) {
      drawSheetFrame(bCtx, runtime.assets[boss.sprite], 0, 8, 8, 80, 80);
    } else if (runtime.assets[boss.sprite]) {
      bCtx.drawImage(runtime.assets[boss.sprite], 8, 8, 80, 80);
    }
  }
  if (introEl) introEl.hidden = false;
  sfx.stairs();
  addLog(`BOSS MATCH: ${boss.name} enters the arena!`, "story");
}

export function updateEnemiesAndBosses(dt) {
  const s = runtime.state;
  const p = s.player;
  const rooms = s.level.rooms || [];
  const bossRoom = rooms[rooms.length - 1];

  // Update delayed Void Acolyte / Boss Phase 2 hazards
  if (Array.isArray(s.enemyHazards) && s.enemyHazards.length > 0) {
    for (let i = s.enemyHazards.length - 1; i >= 0; i--) {
      const hz = s.enemyHazards[i];
      hz.timer -= dt;
      if (hz.timer <= 0) {
        sfx.nova();
        spawnBurst(hz.x, hz.y, hz.color, 18, 1.25);
        spawnRing(hz.x, hz.y, hz.radius * TILE_SIZE, hz.color, 0.35);
        if (Math.hypot(p.x - hz.x, p.y - hz.y) <= hz.radius) {
          const ang = Math.atan2(p.y - hz.y, p.x - hz.x);
          hurtPlayer(hz.dmg, hz.label || "Abyssal Hazard", Math.cos(ang) * 3.5, Math.sin(ang) * 3.5);
        }
        s.enemyHazards.splice(i, 1);
      }
    }
  }

  for (const e of [...s.level.enemies]) {
    if (e.isBoss && !s.bossFightStarted) continue;
    if (e.falling) {
      e.z = Math.max(0, (e.z || 0) - 270 * dt);
      if (e.z <= 0) {
        e.z = 0;
        e.falling = false;
        s.shake = 12;
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

    // Burn DOT (Sunfire 4pc)
    if ((e.burnTimer || 0) > 0) {
      e.burnTimer = Math.max(0, e.burnTimer - dt);
      e.burnTick = (e.burnTick || 0) - dt;
      if (e.burnTick <= 0) {
        e.burnTick = 0.75;
        damageEnemy(e, e.burnDmg || 3, false, "Sunfire Burn", 0, 0, { noOnHit: true, isAoe: true });
        if (e.hp <= 0) continue;
      }
    }

    const chillFactor = e.chilled > 0 ? 0.5 : 1;
    if (e.defBuffTimer > 0) {
      e.defBuffTimer = Math.max(0, e.defBuffTimer - dt);
      if (e.defBuffTimer <= 0) e.bonusDef = 0;
    }
    if (e.reflectTimer > 0) {
      e.reflectTimer = Math.max(0, e.reflectTimer - dt);
    }

    // Blazing Elite periodic fire pulse
    if (e.eliteAffix === "blazing") {
      e.elitePulseCd = (e.elitePulseCd ?? 2.8) - dt * chillFactor;
      if (e.elitePulseCd <= 0) {
        e.elitePulseCd = 3.0;
        const dPlayer = Math.hypot(p.x - e.x, p.y - e.y);
        if (dPlayer <= 5.5) {
          spawnRing(e.x, e.y, 1.8 * TILE_SIZE, "#f97316", 0.32);
          spawnBurst(e.x, e.y, "#f97316", 12, 1.1);
          if (dPlayer <= 1.85) {
            hurtPlayer(Math.max(2, Math.round(e.atk * 0.75)), `${e.name}'s Blazing Aura`, 0, 0);
          }
        }
      }
    }

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
    const isVis = s.level.visible[ey]?.[ex];
    const seesPlayer = e.isBoss ? s.bossFightStarted : e.isClone ? s.bossFightStarted : (isVis || dist <= 4.2);

    if (seesPlayer && !e.seenRecorded) {
      e.seenRecorded = true;
      recordBestiary(e, false);
    }

    if (dx < -0.05) e.facingLeft = true;
    if (dx > 0.05) e.facingLeft = false;

    // Boss Phase 2 (< 50% HP) — Enrage + Arena Hazards
    if (e.isBoss && !e.enraged && e.hp <= e.maxHp * 0.5) {
      e.enraged = true;
      e.phase2HazardCd = 1.6;
      if (e.id !== "royal_goblin") {
        e.speed = (e.speed || 2.2) * 1.18;
        e.skillCd = (e.skillCd || 3.6) * 0.78;
      }
      e.skillTimer = Math.min(e.skillTimer ?? 1, 0.8);
      sfx.ultSlam();
      s.shake = Math.max(s.shake, 8);
      spawnBurst(e.x, e.y, "#ef4444", 24, 1.35);
      spawnRing(e.x, e.y, 44, "#ef4444", 0.4);
      addFloat(e.x, e.y - 0.6, "PHASE 2 — ENRAGED!", "#ef4444");
      addLog(`${e.name} enters PHASE 2! Arena hazards awakened!`, "story");
    }

    // Boss Phase 2 Periodic Arena Hazards
    if (e.isBoss && e.enraged && seesPlayer && bossRoom) {
      e.phase2HazardCd = (e.phase2HazardCd ?? 2.8) - dt * chillFactor;
      if (e.phase2HazardCd <= 0) {
        if (e.id === "royal_goblin") {
          e.phase2HazardCd = 3.2;
          for (let k = 0; k < 2; k++) {
            const rx = bossRoom.x + 1 + Math.random() * Math.max(1, bossRoom.w - 2);
            const ry = bossRoom.y + 1 + Math.random() * Math.max(1, bossRoom.h - 2);
            s.enemyHazards.push({ x: rx, y: ry, radius: 1.45, timer: 1.05, maxTimer: 1.05, color: "#f97316", dmg: Math.round(e.atk * 0.9), label: "Cavern Boulder" });
          }
        } else if (e.id === "gilded_knight") {
          e.phase2HazardCd = 3.5;
          for (const ang of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) {
            s.projectiles.push({
              x: e.x,
              y: e.y,
              vx: Math.cos(ang + (e.p2Spin || 0)) * 5.2,
              vy: Math.sin(ang + (e.p2Spin || 0)) * 5.2,
              radius: 0.24,
              color: "#fde047",
              dmg: Math.round(e.atk * 0.85),
              isEnemy: true,
              sourceName: `${e.name}'s Solar Cross`,
              life: 1.8,
            });
          }
          e.p2Spin = ((e.p2Spin || 0) + 0.4) % (Math.PI * 2);
        } else if (e.id === "void_king") {
          e.phase2HazardCd = 3.0;
          s.enemyHazards.push({ x: p.x, y: p.y, radius: 1.6, timer: 1.0, maxTimer: 1.0, color: "#c084fc", dmg: Math.round(e.atk * 0.95), label: "Abyssal Void Rift" });
        }
      }
    }

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
          s.shake = Math.max(s.shake, 10);
          spawnBurst(e.x, e.y, act.color, 20, 1.3);
          spawnRing(e.x, e.y, act.radius * TILE_SIZE, act.color, 0.38);
          if (Math.hypot(p.x - e.x, p.y - e.y) <= act.radius) {
            hurtPlayer(Math.round(e.atk * 1.25), `${e.name}'s Leap Ambush`, Math.cos(hitAng) * 4.8, Math.sin(hitAng) * 4.8);
          }
        } else if (act.type === "stun_slam") {
          sfx.ultSlam();
          s.shake = Math.max(s.shake, 10);
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
          s.shake = Math.max(s.shake, 9);
          spawnBurst(e.x, e.y, act.color, 22, 1.35);
          spawnRing(e.x, e.y, act.radius * TILE_SIZE, act.color, 0.4);
          if (Math.hypot(p.x - e.x, p.y - e.y) <= act.radius) {
            const ang = Math.atan2(p.y - e.y, p.x - e.x);
            hurtPlayer(Math.round(e.atk * 1.2), `${e.name}'s Surprise Ambush`, Math.cos(ang) * 4.8, Math.sin(ang) * 4.8);
            if (act.type === "teleport_stun") stunPlayer(1.1, e.name, "#facc15");
          }
        } else if (act.type === "void_sigil_stun") {
          sfx.nova();
          s.shake = Math.max(s.shake, 9);
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
          if (e.eliteAffix === "vampiric") {
            const leech = Math.max(2, Math.round(e.maxHp * 0.08));
            e.hp = Math.min(e.maxHp, e.hp + leech);
            addFloat(e.x, e.y - 0.4, `+${leech} HP`, "#4ade80");
          }
        }
      }
      continue;
    }

    // Smart Boss Skill Dodge
    if (e.isBoss && seesPlayer && (e.dodgeCd || 0) <= 0 && !e.bossAction && !e.bossDodge) {
      let dodged = false;
      for (const pr of s.projectiles) {
        if (pr.isEnemy) continue;
        const pDist = Math.hypot(e.x - pr.x, e.y - pr.y);
        if (pDist > 4.2) continue;
        const speedSq = pr.vx * pr.vx + pr.vy * pr.vy;
        if (speedSq <= 0.1) continue;
        if ((e.x - pr.x) * pr.vx + (e.y - pr.y) * pr.vy > 0) {
          const speed = Math.sqrt(speedSq);
          const perp = Math.abs((e.x - pr.x) * pr.vy - (e.y - pr.y) * pr.vx) / speed;
          if (perp <= (pr.radius || 0.3) + 0.95) {
            dodged = tryTriggerBossDodge(e, pr.x, pr.y, bossRoom);
            if (dodged) break;
          }
        }
      }
      if (!dodged) {
        if (p.ultCharge && p.ultCharge.timer < 0.65 && dist <= p.ultCharge.spell.radii[p.ultCharge.rankIdx] + 0.35) {
          dodged = tryTriggerBossDodge(e, p.x, p.y, bossRoom);
        } else if (p.leap && p.leap.progress > 0.68 && dist <= 4.2) {
          dodged = tryTriggerBossDodge(e, p.x, p.y, bossRoom);
        } else if (p.rapidSlash && dist <= 2.75) {
          dodged = tryTriggerBossDodge(e, p.x, p.y, bossRoom);
        }
      }
      if (dodged) continue;
    }

    // Boss Signature Skills
    if (e.isBoss && seesPlayer) {
      e.skillTimer = Math.max(0, (e.skillTimer ?? (e.skillCd || 3.6)) - dt * chillFactor);
      if (e.skillTimer <= 0) {
        e.skillTimer = e.skillCd || 3.6;
        e.skillStep = ((e.skillStep || 0) + 1) % 3;
        e.anim = "attack";
        e.animTimer = 0.35;
        const leadX = p.x + (p.vx || 0) * 0.22;
        const leadY = p.y + (p.vy || 0) * 0.22;
        const baseAng = Math.atan2(leadY - e.y, leadX - e.x);

        if (e.id === "royal_goblin") {
          if (dist > 3.2 || e.skillStep === 1) {
            const spot = clampPointInBossRoom(leadX, leadY, bossRoom, e.x, e.y);
            addFloat(e.x, e.y - 0.5, "AMBUSH LEAP!", "#f97316");
            e.bossAction = { type: "leap_ambush", startX: e.x, startY: e.y, tx: spot.x, ty: spot.y, radius: 2.2, timer: 0.46, duration: 0.46, color: "#f97316", label: "AMBUSH LEAP!" };
          } else {
            addFloat(e.x, e.y - 0.5, "WARCRY STUN!", "#facc15");
            e.bossAction = { type: "stun_slam", tx: e.x, ty: e.y, radius: 2.5, timer: 0.52, duration: 0.52, color: "#ef4444", label: "WARCRY STUN!" };
          }
        } else if (e.id === "gilded_knight") {
          if (e.skillStep === 1) {
            const spot = findBossTeleportSpot(e, p, bossRoom);
            addFloat(e.x, e.y - 0.5, "JUDGMENT FLASH!", "#facc15");
            e.bossAction = { type: "teleport_stun", tx: spot.x, ty: spot.y, radius: 2.25, timer: 0.48, duration: 0.48, color: "#facc15", label: "TELEPORT STUN!" };
          } else if (e.skillStep === 2) {
            e.defBuffTimer = 4.5;
            e.reflectTimer = 4.5;
            e.bonusDef = Math.round((e.def || 17) * 1.15 + 12);
            e.reflectPct = 0.35;
            sfx.spell();
            spawnBurst(e.x, e.y, "#fde047", 20, 1.25);
            spawnRing(e.x, e.y, 44, "#fde047", 0.45);
            addFloat(e.x, e.y - 0.5, "AEGIS + REFLECT!", "#fde047");
            addLog(`${e.name} raises Gilded Aegis (+${e.bonusDef} DEF & 35% Reflect for 4.5s)!`, "story");
          } else {
            addFloat(e.x, e.y - 0.5, "SOLAR WAVE!", "#facc15");
            for (const off of [-0.24, 0, 0.24]) {
              const a = baseAng + off;
              s.projectiles.push({
                x: e.x, y: e.y, vx: Math.cos(a) * 6.5, vy: Math.sin(a) * 6.5,
                radius: 0.26, color: "#facc15", dmg: Math.round(e.atk * 1.05), isEnemy: true, sourceName: `${e.name}'s Solar Wave`, life: 1.6,
              });
            }
          }
        } else if (e.id === "void_king") {
          e.voidStep = ((e.voidStep || 0) + 1) % 4;
          const activeClones = s.level.enemies.filter((c) => c.isClone).length;
          if (e.voidStep === 1) {
            const spot = findBossTeleportSpot(e, p, bossRoom);
            addFloat(e.x, e.y - 0.5, "SHADOW STEP!", "#c084fc");
            e.bossAction = { type: "teleport_strike", tx: spot.x, ty: spot.y, radius: 2.35, timer: 0.45, duration: 0.45, color: "#c084fc", label: "SHADOW STEP!" };
          } else if (e.voidStep === 2 && activeClones < 2) {
            const toSpawn = 2 - activeClones;
            for (let cIdx = 0; cIdx < toSpawn; cIdx++) {
              const spot = findBossTeleportSpot(e, p, bossRoom);
              const jitterAng = (cIdx === 0 ? 1 : -1) * 1.1;
              const cx = clampPointInBossRoom(spot.x + Math.cos(jitterAng) * 1.2, spot.y + Math.sin(jitterAng) * 1.2, bossRoom, e.x, e.y);
              s.level.enemies.push({
                uid: `clone_${Date.now()}_${cIdx}_${Math.random().toString(36).slice(2, 6)}`,
                id: "void_clone", name: "Hollow Phantom", sprite: "void_king", isSheet: false, isBoss: false, isClone: true, parentUid: e.uid,
                hp: Math.round(e.maxHp * 0.065), maxHp: Math.round(e.maxHp * 0.065), atk: Math.round(e.atk * 0.4), def: Math.round((e.def || 10) * 0.35),
                xp: 0, gold: 0, speed: (e.speed || 2.15) * 1.1, attackCd: 1.25, rangedCd: 2.6,
                x: cx.x, y: cx.y, vx: 0, vy: 0, kbX: 0, kbY: 0, facingLeft: p.x < cx.x, anim: "idle", animTimer: 0,
                attackTimer: 0.5, windupTimer: 0, rangedTimer: 1.4, chilled: 0, hurtTimer: 0, bobPhase: Math.random() * Math.PI * 2,
              });
              spawnBurst(cx.x, cx.y, "#c084fc", 14, 1.1);
            }
            sfx.spell();
            addFloat(e.x, e.y - 0.5, "VOID MIRAGES!", "#c084fc");
            addLog(`${e.name} conjures Shadow Clones!`, "story");
          } else if (e.voidStep === 3 && e.hp < e.maxHp * 0.88) {
            addFloat(e.x, e.y - 0.5, "DARK MENDING! (CRIT TO INTERRUPT)", "#4ade80");
            e.bossAction = { type: "dark_mend", tx: e.x, ty: e.y, radius: 1.4, timer: 1.1, duration: 1.1, color: "#4ade80", label: "HEALING!" };
          } else if (e.skillStep === 2) {
            const spot = clampPointInBossRoom(leadX, leadY, bossRoom, p.x, p.y);
            addFloat(e.x, e.y - 0.5, "SOUL SHATTER!", "#a855f7");
            e.bossAction = { type: "void_sigil_stun", tx: spot.x, ty: spot.y, radius: 1.95, timer: 0.62, duration: 0.62, color: "#a855f7", label: "STUN SIGIL!" };
          } else {
            addFloat(e.x, e.y - 0.5, "VOID BARRAGE!", "#c084fc");
            const offsets = e.enraged ? [-0.42, -0.21, 0, 0.21, 0.42] : [-0.28, 0, 0.28];
            for (const off of offsets) {
              const a = baseAng + off;
              s.projectiles.push({
                x: e.x, y: e.y, vx: Math.cos(a) * 6.0, vy: Math.sin(a) * 6.0,
                radius: 0.25, color: "#c084fc", dmg: Math.round(e.atk * 0.95), isEnemy: true, sourceName: `${e.name}'s Void Barrage`, life: 1.8,
              });
            }
          }
        }
      }
    }

    // Ranged regular enemies (Goblin Slinger, Void Acolyte) & Malakor/Clones
    if (e.role === "ranged_kiter" && seesPlayer && dist <= 7.2 && dist > 1.4 && e.rangedTimer <= 0) {
      e.rangedTimer = e.rangedCd || 2.0;
      const ang = Math.atan2(dy, dx);
      s.projectiles.push({
        x: e.x, y: e.y, vx: Math.cos(ang) * 5.8, vy: Math.sin(ang) * 5.8,
        radius: 0.2, color: e.projColor || "#a3e635", dmg: Math.round(e.atk * 0.9),
        isEnemy: true, sourceName: `${e.name}'s Sling Stone`, life: 1.5,
      });
      spawnBurst(e.x, e.y, e.projColor || "#a3e635", 4, 0.6);
    } else if (e.role === "sigil_caster" && seesPlayer && dist <= 7.5 && e.rangedTimer <= 0) {
      e.rangedTimer = e.rangedCd || 2.6;
      s.enemyHazards.push({
        x: p.x, y: p.y, radius: 1.25, timer: 1.0, maxTimer: 1.0,
        color: "#a855f7", dmg: Math.round(e.atk * 1.1), label: `${e.name}'s Void Sigil`,
      });
      addFloat(e.x, e.y - 0.45, "VOID SIGIL!", "#c084fc");
    } else if ((e.id === "void_king" || e.isClone) && seesPlayer && dist > 1.8 && e.rangedTimer <= 0) {
      e.rangedTimer = e.rangedCd || 2.1;
      const leadX = p.x + (p.vx || 0) * (e.isClone ? 0.08 : 0.2);
      const leadY = p.y + (p.vy || 0) * (e.isClone ? 0.08 : 0.2);
      const ang = Math.atan2(leadY - e.y, leadX - e.x);
      const orbSpeed = e.isClone ? 4.8 : 5.6;
      s.projectiles.push({
        x: e.x, y: e.y, vx: Math.cos(ang) * orbSpeed, vy: Math.sin(ang) * orbSpeed,
        radius: e.isClone ? 0.19 : 0.24, color: "#c084fc", dmg: Math.round(e.atk * 0.85), isEnemy: true, sourceName: e.name, life: 2.0,
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

      if (e.role === "ranged_kiter" && dist < 3.2) {
        moveDirX = -moveDirX * 0.85;
        moveDirY = -moveDirY * 0.85;
      } else if (e.role === "ranged_kiter" && dist >= 3.2 && dist <= 5.5) {
        moveDirX = -moveDirY * 0.45;
        moveDirY = moveDirX * 0.45;
      } else if (e.id === "void_king" && dist < 2.1) {
        const strafeDir = e.enraged ? -1 : 1;
        moveDirX = -moveDirX * 0.65 + -moveDirY * 0.55 * strafeDir;
        moveDirY = -moveDirY * 0.65 + moveDirX * 0.55 * strafeDir;
      }

      let moveX = moveDirX * spd;
      let moveY = moveDirY * spd;

      for (const other of s.level.enemies) {
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
}
