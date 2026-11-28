import { sfx } from "./audio.js";
import { drawSheetFrame } from "./assets.js";
import { SPELLS } from "./data.js";
import { damageEnemy, hurtPlayer, recordBestiary, stunPlayer, unlockCodex } from "./combat.js";
import { canOccupy, moveWithSlide, runtime, addFloat, addLog, spawnBurst, spawnRing, spawnVfxAnim, TILE_SIZE } from "./state.js";

const BOSS_DIFF_CFG = {
  normal: { cdMult: 0.9, windupMult: 0.92, dodgeCd: 3.3, enragePct: 0.5, ccMult: 0.75, ccImmunity: 2.5, uninterruptible: false },
  hard: { cdMult: 0.78, windupMult: 0.82, dodgeCd: 2.5, enragePct: 0.55, ccMult: 0.5, ccImmunity: 3.5, uninterruptible: false },
  nightmare: { cdMult: 0.65, windupMult: 0.7, dodgeCd: 1.85, enragePct: 0.65, ccMult: 0.35, ccImmunity: 4.5, uninterruptible: true },
};

function getBossDiffCfg(s) {
  return BOSS_DIFF_CFG[s?.difficulty] || BOSS_DIFF_CFG.normal;
}

function initMirrorBoss(e, p) {
  e.mirrorInitialized = true;
  const cls = p.heroClass || "mage";
  e.mirrorClass = cls;
  if (cls === "ranger") {
    e.sprite = "ranger_idle";
    e.walkSprite = "ranger_walk";
    e.attackSprite = "ranger_attack";
  } else if (cls === "gilded") {
    e.sprite = "gilded_idle";
    e.walkSprite = "gilded_walk";
    e.attackSprite = "gilded_attack";
  } else {
    e.sprite = "mage_idle";
    e.walkSprite = "mage_walk";
    e.attackSprite = "mage_attack";
  }
  e.name = `Mirror ${p.name || "Champion"}`;
  const equipped = (p.loadout || []).filter(Boolean);
  const classSpells = SPELLS.filter((sp) => sp.heroClass === cls).map((sp) => sp.id);
  e.mirrorLoadout = equipped.length > 0 ? equipped : classSpells.slice(0, 4);
}

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

  const dashColor = boss.id === "void_king" || boss.id === "mirror_self" ? "#c084fc" : boss.id === "foundry_executioner" ? "#f87171" : "#38bdf8";
  const diffCfg = getBossDiffCfg(runtime.state);
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
  boss.dodgeCd = boss.enraged ? diffCfg.dodgeCd * 0.72 : diffCfg.dodgeCd;
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
      if (e.id === "foundry_executioner") unlockCodex("aurelius");
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
    if (e.isPvpPlayer) continue;
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
    if ((e.poisonTimer || 0) > 0) {
      e.poisonTimer = Math.max(0, e.poisonTimer - dt);
      e.poisonTick = (e.poisonTick || 0) - dt;
      if (e.poisonTick <= 0 && e.hp > 0) {
        e.poisonTick = 0.8;
        const pDmg = Math.max(2, e.poisonDmg || 2);
        spawnBurst(e.x, e.y, "#22c55e", 4, 0.6);
        damageEnemy(e, pDmg, false, "Venom Poison", 0, 0, { isSkill: true, isAoe: true });
        if (e.hp <= 0) continue;
      }
    }
    e.dodgeCd = Math.max(0, (e.dodgeCd || 0) - dt);
    e.evadeTimer = Math.max(0, (e.evadeTimer || 0) - dt);
    e.bossStunImmuneTimer = Math.max(0, (e.bossStunImmuneTimer || 0) - dt);
    e.ccFloatCd = Math.max(0, (e.ccFloatCd || 0) - dt);
    e.animTimer = Math.max(0, e.animTimer - dt);
    if (e.animTimer <= 0) e.anim = "idle";

    if (e.isBoss && e.id === "mirror_self" && !e.mirrorInitialized) {
      initMirrorBoss(e, p);
    }

    const diffCfg = getBossDiffCfg(s);
    if (e.isBoss && (e.stunTimer > 0 || e.frozenTimer > 0)) {
      const unblockableAction = diffCfg.uninterruptible && e.bossAction && e.bossAction.type !== "dark_mend";
      if (e.bossStunImmuneTimer > 0 || unblockableAction) {
        e.stunTimer = 0;
        e.frozenTimer = 0;
        if (e.ccFloatCd <= 0) {
          e.ccFloatCd = 0.7;
          addFloat(e.x, e.y - 0.55, "RESIST!", "#f59e0b");
        }
      } else if (!e.ccScaledApplied) {
        e.ccScaledApplied = true;
        if (e.stunTimer > 0) e.stunTimer = Math.max(0.25, e.stunTimer * diffCfg.ccMult);
        if (e.frozenTimer > 0) e.frozenTimer = Math.max(0.25, e.frozenTimer * diffCfg.ccMult);
      }
    } else if (e.isBoss && e.ccScaledApplied) {
      e.ccScaledApplied = false;
      e.bossStunImmuneTimer = diffCfg.ccImmunity;
    }

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

    // Boss Phase 2 (difficulty-scaled threshold) — Enrage + Arena Hazards
    if (e.isBoss && !e.enraged && e.hp <= e.maxHp * diffCfg.enragePct) {
      e.enraged = true;
      e.phase2HazardCd = 1.4;
      if (e.id !== "royal_goblin") {
        e.speed = (e.speed || 2.2) * 1.18;
        e.skillCd = (e.skillCd || 3.4) * 0.78;
      }
      e.skillTimer = Math.min(e.skillTimer ?? 1, 0.7);
      sfx.ultSlam();
      sfx.bossWarn();
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
          e.phase2HazardCd = 3.0 * diffCfg.cdMult;
          for (let k = 0; k < 2; k++) {
            const rx = bossRoom.x + 1 + Math.random() * Math.max(1, bossRoom.w - 2);
            const ry = bossRoom.y + 1 + Math.random() * Math.max(1, bossRoom.h - 2);
            s.enemyHazards.push({ x: rx, y: ry, radius: 1.45, timer: 1.0, maxTimer: 1.0, color: "#f97316", dmg: Math.round(e.atk * 0.9), label: "Cavern Boulder" });
          }
        } else if (e.id === "foundry_executioner") {
          e.phase2HazardCd = 3.2 * diffCfg.cdMult;
          for (const ang of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) {
            s.projectiles.push({
              x: e.x,
              y: e.y,
              vx: Math.cos(ang + (e.p2Spin || 0)) * 5.6,
              vy: Math.sin(ang + (e.p2Spin || 0)) * 5.6,
              radius: 0.25,
              color: "#f87171",
              dmg: Math.round(e.atk * 0.88),
              isEnemy: true,
              sourceName: `${e.name}'s Crimson Cross`,
              life: 1.8,
            });
          }
          spawnVfxAnim(e.x, e.y, "vfx_greatsword_sweep", 76, 0.35, { angle: e.p2Spin || 0 });
          e.p2Spin = ((e.p2Spin || 0) + 0.45) % (Math.PI * 2);
        } else if (e.id === "void_king") {
          e.phase2HazardCd = 2.8 * diffCfg.cdMult;
          s.enemyHazards.push({ x: p.x, y: p.y, radius: 1.65, timer: 0.95, maxTimer: 0.95, color: "#c084fc", dmg: Math.round(e.atk * 0.95), label: "Abyssal Void Rift" });
        } else if (e.id === "mirror_self") {
          e.phase2HazardCd = 2.6 * diffCfg.cdMult;
          const leadX = p.x + (p.vx || 0) * 0.25;
          const leadY = p.y + (p.vy || 0) * 0.25;
          const spot = clampPointInBossRoom(leadX, leadY, bossRoom, p.x, p.y);
          s.enemyHazards.push({ x: spot.x, y: spot.y, radius: 1.55, timer: 0.9, maxTimer: 0.9, color: "#a855f7", dmg: Math.round(e.atk * 0.92), label: "Mirror Paradox" });
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
      } else if (act.type === "dash_cleave") {
        const prog = Math.min(1, 1 - Math.max(0, act.timer) / act.duration);
        e.x = act.startX + (act.tx - act.startX) * prog;
        e.y = act.startY + (act.ty - act.startY) * prog;
        e.anim = "dash";
      }
      if (act.timer <= 0) {
        e.bossAction = null;
        e.z = 0;
        e.anim = act.type === "dash_cleave" ? "combo" : "attack";
        e.animTimer = 0.42;
        const hitAng = Math.atan2(p.y - act.ty, p.x - act.tx);

        if (act.type === "leap_ambush") {
          e.x = act.tx;
          e.y = act.ty;
          sfx.ultSlam();
          sfx.heavyImpact();
          s.shake = Math.max(s.shake, 10);
          spawnVfxAnim(e.x, e.y, "vfx_ground_slam", act.radius * TILE_SIZE * 2.1, 0.55);
          spawnVfxAnim(e.x, e.y, "vfx_sonic_boom", act.radius * TILE_SIZE * 1.8, 0.45);
          spawnBurst(e.x, e.y, act.color, 20, 1.3);
          spawnRing(e.x, e.y, act.radius * TILE_SIZE, act.color, 0.38);
          if (Math.hypot(p.x - e.x, p.y - e.y) <= act.radius) {
            hurtPlayer(Math.round(e.atk * 1.25), `${e.name}'s Leap Ambush`, Math.cos(hitAng) * 4.8, Math.sin(hitAng) * 4.8);
          }
        } else if (act.type === "stun_slam") {
          sfx.ultSlam();
          sfx.heavyImpact();
          s.shake = Math.max(s.shake, 10);
          spawnVfxAnim(e.x, e.y, "vfx_ground_slam", act.radius * TILE_SIZE * 2.2, 0.6);
          spawnVfxAnim(e.x, e.y, "vfx_sonic_boom", act.radius * TILE_SIZE * 2.0, 0.45);
          spawnBurst(e.x, e.y, "#facc15", 20, 1.25);
          spawnRing(e.x, e.y, act.radius * TILE_SIZE, "#ef4444", 0.38);
          if (Math.hypot(p.x - e.x, p.y - e.y) <= act.radius) {
            hurtPlayer(Math.round(e.atk * 1.15), `${e.name}'s Concussive Slam`, Math.cos(hitAng) * 4.5, Math.sin(hitAng) * 4.5);
            stunPlayer(1.0, e.name, "#facc15");
          }
        } else if (act.type === "warlord_cleave") {
          sfx.hit();
          s.shake = Math.max(s.shake, 7);
          const ang = Math.atan2(p.y - e.y, p.x - e.x);
          spawnVfxAnim(e.x + Math.cos(ang) * 0.9, e.y + Math.sin(ang) * 0.9, "vfx_greatsword_sweep", act.radius * TILE_SIZE * 1.75, 0.4, { angle: ang });
          spawnRing(e.x, e.y, act.radius * TILE_SIZE, "#f97316", 0.32);
          if (Math.hypot(p.x - e.x, p.y - e.y) <= act.radius) {
            hurtPlayer(Math.round(e.atk * 1.3), `${e.name}'s Warlord Cleave`, Math.cos(ang) * 5.2, Math.sin(ang) * 5.2);
          }
        } else if (act.type === "dash_cleave") {
          e.x = act.tx;
          e.y = act.ty;
          e.facingLeft = p.x < e.x;
          sfx.ultSlam();
          s.shake = Math.max(s.shake, 9);
          const ang = Math.atan2(p.y - e.y, p.x - e.x);
          spawnVfxAnim(e.x, e.y, "vfx_greatsword_sweep", act.radius * TILE_SIZE * 1.9, 0.45, { angle: ang });
          spawnBurst(e.x, e.y, "#f87171", 18, 1.3);
          spawnRing(e.x, e.y, act.radius * TILE_SIZE, "#f87171", 0.35);
          if (Math.hypot(p.x - e.x, p.y - e.y) <= act.radius) {
            hurtPlayer(Math.round(e.atk * 1.3), `${e.name}'s Executioner Dash`, Math.cos(ang) * 5.2, Math.sin(ang) * 5.2);
            stunPlayer(0.85, e.name, "#f87171");
          }
        } else if (act.type === "bladefall_barrage") {
          sfx.smite();
          s.shake = Math.max(s.shake, 8);
          for (const pt of act.targets || [{ x: act.tx, y: act.ty }]) {
            spawnVfxAnim(pt.x, pt.y, "vfx_holy_sword_fall", act.radius * TILE_SIZE * 1.9, 0.52);
            spawnBurst(pt.x, pt.y, "#fde047", 14, 1.2);
            spawnRing(pt.x, pt.y, act.radius * TILE_SIZE, "#fde047", 0.35);
            if (Math.hypot(p.x - pt.x, p.y - pt.y) <= act.radius) {
              const ang = Math.atan2(p.y - pt.y, p.x - pt.x);
              hurtPlayer(Math.round(e.atk * 1.15), `${e.name}'s Judgment Bladefall`, Math.cos(ang) * 4.0, Math.sin(ang) * 4.0);
            }
          }
        } else if (act.type === "teleport_stun" || act.type === "teleport_strike") {
          spawnVfxAnim(e.x, e.y, "vfx_shadow_step", 84, 0.45);
          spawnBurst(e.x, e.y, act.color, 16, 1.1);
          e.x = act.tx;
          e.y = act.ty;
          e.facingLeft = p.x < e.x;
          sfx.spell();
          s.shake = Math.max(s.shake, 9);
          spawnVfxAnim(e.x, e.y, "vfx_shadow_step", 92, 0.45);
          spawnVfxAnim(e.x, e.y, "vfx_shadow_spikes", act.radius * TILE_SIZE * 1.7, 0.5);
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
          spawnVfxAnim(act.tx, act.ty, "vfx_shadow_spikes", act.radius * TILE_SIZE * 1.9, 0.55);
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
          spawnVfxAnim(e.x, e.y, "vfx_soul_drain", 104, 0.65);
          spawnBurst(e.x, e.y, "#4ade80", 20, 1.25);
          spawnRing(e.x, e.y, 44, "#4ade80", 0.4);
          addFloat(e.x, e.y - 0.5, `+${healAmt} HP`, "#4ade80");
          addLog(`${e.name} channels Dark Mending and restores ${healAmt} HP!`, "combat");
        } else if (act.type === "mirror_cast") {
          const skId = act.spellId || "arcane_beam";
          const skColor = act.color || "#c084fc";
          const ang = Math.atan2(act.ty - e.y, act.tx - e.x);
          sfx.spell();
          s.shake = Math.max(s.shake, 7);
          if (skId === "mana_shield" || skId === "aegis_ward") {
            e.defBuffTimer = 4.0;
            e.bonusDef = Math.round((e.def || 12) * 0.9 + 10);
            if (skId === "aegis_ward") {
              e.reflectTimer = 4.0;
              e.reflectPct = 0.28;
            }
            spawnVfxAnim(e.x, e.y, skId === "aegis_ward" ? "vfx_shield_bubble" : "vfx_mana_shield", 76, 0.65);
            addFloat(e.x, e.y - 0.5, skId === "aegis_ward" ? "MIRROR AEGIS!" : "MIRROR SHIELD!", skColor);
          } else if (skId === "tempest_field" || skId === "leaf_tempest" || skId === "whirlwind") {
            const vfxKey = skId === "tempest_field" ? "vfx_storm_field" : skId === "leaf_tempest" ? "vfx_leaf_storm" : "vfx_greatsword_sweep";
            spawnVfxAnim(e.x, e.y, vfxKey, act.radius * TILE_SIZE * 1.9, 0.6);
            spawnRing(e.x, e.y, act.radius * TILE_SIZE, skColor, 0.4);
            if (Math.hypot(p.x - e.x, p.y - e.y) <= act.radius) {
              hurtPlayer(Math.round(e.atk * 1.25), `${e.name}'s ${act.label}`, Math.cos(hitAng) * 4.2, Math.sin(hitAng) * 4.2);
            }
          } else if (skId === "arcane_beam" || skId === "frost_lance" || skId === "fireball" || skId === "thorn_salvo" || skId === "piercing_arrow" || skId === "valiant_charge") {
            const count = skId === "thorn_salvo" ? 5 : 3;
            const spread = skId === "thorn_salvo" ? 0.16 : 0.22;
            const half = (count - 1) / 2;
            for (let idx = 0; idx < count; idx++) {
              const a = ang + (idx - half) * spread;
              s.projectiles.push({
                x: e.x, y: e.y, vx: Math.cos(a) * 6.8, vy: Math.sin(a) * 6.8,
                radius: 0.26, color: skColor, dmg: Math.round(e.atk * 1.05), isEnemy: true, sourceName: `${e.name}'s ${act.label}`, life: 1.7,
              });
            }
            if (skId === "arcane_beam") spawnVfxAnim(e.x, e.y, "vfx_arcane_beam", 120, 0.35, { angle: ang, anchorX: 0.1 });
            else if (skId === "valiant_charge") {
              e.x = act.tx;
              e.y = act.ty;
              spawnVfxAnim(e.x, e.y, "vfx_greatsword_sweep", 96, 0.4, { angle: ang });
              if (Math.hypot(p.x - e.x, p.y - e.y) <= 1.8) {
                hurtPlayer(Math.round(e.atk * 1.25), `${e.name}'s ${act.label}`, Math.cos(ang) * 4.5, Math.sin(ang) * 4.5);
              }
            }
          } else {
            const vfxMap = {
              void_rift: "vfx_void_rift",
              gravity_singularity: "vfx_gravity_well",
              meteor_strike: "vfx_meteor_strike",
              chain_lightning: "vfx_lightning_impact",
              briar_snare: "vfx_vine_snare",
              arrow_storm: "vfx_arrow_storm_impact",
              skyfall_judgment: "vfx_holy_sword_fall",
              radiant_slash: "vfx_greatsword_sweep",
            };
            const vfxKey = vfxMap[skId] || "vfx_arcane_burst";
            spawnVfxAnim(act.tx, act.ty, vfxKey, act.radius * TILE_SIZE * 1.95, 0.6);
            spawnBurst(act.tx, act.ty, skColor, 20, 1.3);
            spawnRing(act.tx, act.ty, act.radius * TILE_SIZE, skColor, 0.42);
            if (Math.hypot(p.x - act.tx, p.y - act.ty) <= act.radius) {
              hurtPlayer(Math.round(e.atk * 1.3), `${e.name}'s ${act.label}`, Math.cos(hitAng) * 4.4, Math.sin(hitAng) * 4.4);
              if (skId === "gravity_singularity" || skId === "briar_snare" || skId === "skyfall_judgment") {
                stunPlayer(0.9, e.name, skColor);
              }
            }
          }
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
      e.skillTimer = Math.max(0, (e.skillTimer ?? (e.skillCd || 3.4) * diffCfg.cdMult) - dt * chillFactor);
      if (e.skillTimer <= 0) {
        e.skillTimer = (e.skillCd || 3.4) * diffCfg.cdMult;
        e.skillStep = ((e.skillStep || 0) + 1) % 3;
        e.anim = "attack";
        e.animTimer = 0.35;
        const leadX = p.x + (p.vx || 0) * 0.25;
        const leadY = p.y + (p.vy || 0) * 0.25;
        const baseAng = Math.atan2(leadY - e.y, leadX - e.x);
        const wMult = diffCfg.windupMult;

        if (e.id === "royal_goblin") {
          if (dist > 3.2 || e.skillStep === 1) {
            const spot = clampPointInBossRoom(leadX, leadY, bossRoom, e.x, e.y);
            addFloat(e.x, e.y - 0.5, "AMBUSH LEAP!", "#f97316");
            const dur = 0.46 * wMult;
            e.bossAction = { type: "leap_ambush", startX: e.x, startY: e.y, tx: spot.x, ty: spot.y, radius: 2.25, timer: dur, duration: dur, color: "#f97316", label: "AMBUSH LEAP!" };
          } else if (e.skillStep === 2) {
            addFloat(e.x, e.y - 0.5, "WARLORD CLEAVE!", "#fb923c");
            const dur = 0.42 * wMult;
            e.bossAction = { type: "warlord_cleave", tx: e.x, ty: e.y, radius: 2.3, timer: dur, duration: dur, color: "#fb923c", label: "WARLORD CLEAVE!" };
          } else {
            addFloat(e.x, e.y - 0.5, "WARCRY STUN!", "#facc15");
            const dur = 0.52 * wMult;
            e.bossAction = { type: "stun_slam", tx: e.x, ty: e.y, radius: 2.55, timer: dur, duration: dur, color: "#ef4444", label: "WARCRY STUN!" };
          }
        } else if (e.id === "foundry_executioner") {
          if (e.skillStep === 1) {
            const dashDist = Math.min(4.2, dist + 1.1);
            const rawTx = e.x + Math.cos(baseAng) * dashDist;
            const rawTy = e.y + Math.sin(baseAng) * dashDist;
            const spot = clampPointInBossRoom(rawTx, rawTy, bossRoom, e.x, e.y);
            spawnVfxAnim(e.x, e.y, "vfx_shadow_step", 82, 0.35);
            addFloat(e.x, e.y - 0.5, "EXECUTIONER DASH!", "#f87171");
            const dur = 0.38 * wMult;
            e.bossAction = { type: "dash_cleave", startX: e.x, startY: e.y, tx: spot.x, ty: spot.y, radius: 2.2, timer: dur, duration: dur, color: "#f87171", label: "EXECUTIONER DASH!" };
          } else if (e.skillStep === 2 && (e.defBuffTimer || 0) <= 0) {
            e.defBuffTimer = 4.2;
            e.reflectTimer = 4.2;
            e.bonusDef = Math.round((e.def || 12) * 1.1 + 10);
            e.reflectPct = 0.35;
            sfx.shieldClang();
            spawnVfxAnim(e.x, e.y, "vfx_shield_bubble", 86, 0.75);
            spawnBurst(e.x, e.y, "#fde047", 20, 1.25);
            spawnRing(e.x, e.y, 44, "#fde047", 0.45);
            addFloat(e.x, e.y - 0.5, "AEGIS COUNTER!", "#fde047");
            addLog(`${e.name} raises Executioner Aegis (+${e.bonusDef} DEF & 35% Reflect)!`, "story");
          } else {
            const t1 = clampPointInBossRoom(leadX, leadY, bossRoom, p.x, p.y);
            const t2 = clampPointInBossRoom(leadX + Math.cos(baseAng + 0.8) * 1.6, leadY + Math.sin(baseAng + 0.8) * 1.6, bossRoom, p.x, p.y);
            const t3 = clampPointInBossRoom(leadX + Math.cos(baseAng - 0.8) * 1.6, leadY + Math.sin(baseAng - 0.8) * 1.6, bossRoom, p.x, p.y);
            addFloat(e.x, e.y - 0.5, "JUDGMENT BLADEFALL!", "#fde047");
            const dur = 0.54 * wMult;
            e.bossAction = { type: "bladefall_barrage", tx: t1.x, ty: t1.y, targets: [t1, t2, t3], radius: 1.65, timer: dur, duration: dur, color: "#fde047", label: "BLADEFALL!" };
          }
        } else if (e.id === "void_king") {
          e.voidStep = ((e.voidStep || 0) + 1) % 4;
          const activeClones = s.level.enemies.filter((c) => c.isClone).length;
          if (e.voidStep === 1) {
            const spot = findBossTeleportSpot(e, p, bossRoom);
            addFloat(e.x, e.y - 0.5, "SHADOW STEP!", "#c084fc");
            const dur = 0.45 * wMult;
            e.bossAction = { type: "teleport_strike", tx: spot.x, ty: spot.y, radius: 2.35, timer: dur, duration: dur, color: "#c084fc", label: "SHADOW STEP!" };
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
              spawnVfxAnim(cx.x, cx.y, "vfx_shadow_step", 72, 0.45);
              spawnBurst(cx.x, cx.y, "#c084fc", 14, 1.1);
            }
            sfx.spell();
            addFloat(e.x, e.y - 0.5, "VOID MIRAGES!", "#c084fc");
            addLog(`${e.name} conjures Shadow Clones!`, "story");
          } else if (e.voidStep === 3 && e.hp < e.maxHp * 0.88) {
            addFloat(e.x, e.y - 0.5, "DARK MENDING! (CRIT TO INTERRUPT)", "#4ade80");
            e.bossAction = { type: "dark_mend", tx: e.x, ty: e.y, radius: 1.4, timer: 1.05, duration: 1.05, color: "#4ade80", label: "HEALING!" };
          } else if (e.skillStep === 2) {
            const spot = clampPointInBossRoom(leadX, leadY, bossRoom, p.x, p.y);
            addFloat(e.x, e.y - 0.5, "SOUL SHATTER!", "#a855f7");
            const dur = 0.58 * wMult;
            e.bossAction = { type: "void_sigil_stun", tx: spot.x, ty: spot.y, radius: 1.95, timer: dur, duration: dur, color: "#a855f7", label: "STUN SIGIL!" };
          } else {
            addFloat(e.x, e.y - 0.5, "VOID BARRAGE!", "#c084fc");
            spawnVfxAnim(e.x, e.y, "vfx_void_rift", 88, 0.5);
            const offsets = e.enraged ? [-0.42, -0.21, 0, 0.21, 0.42] : [-0.28, 0, 0.28];
            for (const off of offsets) {
              const a = baseAng + off;
              s.projectiles.push({
                x: e.x, y: e.y, vx: Math.cos(a) * 6.2, vy: Math.sin(a) * 6.2,
                radius: 0.25, color: "#c084fc", dmg: Math.round(e.atk * 0.95), isEnemy: true, sourceName: `${e.name}'s Void Barrage`, life: 1.8,
              });
            }
          }
        } else if (e.id === "mirror_self") {
          const loadout = e.mirrorLoadout && e.mirrorLoadout.length > 0 ? e.mirrorLoadout : ["arcane_beam", "void_rift", "tempest_field", "gravity_singularity"];
          e.mirrorStep = ((e.mirrorStep || 0) + 1) % loadout.length;
          const spellId = loadout[e.mirrorStep];
          const sp = SPELLS.find((sObj) => sObj.id === spellId);
          const label = (sp?.name || spellId).toUpperCase();
          const skColor = e.mirrorClass === "ranger" ? "#4ade80" : e.mirrorClass === "gilded" ? "#facc15" : "#c084fc";
          const spot = clampPointInBossRoom(leadX, leadY, bossRoom, p.x, p.y);
          addFloat(e.x, e.y - 0.5, `MIRROR ${label}!`, skColor);
          const dur = 0.5 * wMult;
          e.bossAction = {
            type: "mirror_cast",
            spellId,
            tx: spot.x,
            ty: spot.y,
            radius: sp?.radii?.[0] || sp?.radius || 2.1,
            timer: dur,
            duration: dur,
            color: skColor,
            label,
          };
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
    } else if ((e.id === "void_king" || e.isClone || (e.id === "mirror_self" && e.mirrorClass !== "gilded")) && seesPlayer && dist > 1.8 && e.rangedTimer <= 0) {
      e.rangedTimer = (e.rangedCd || 2.1) * (e.isBoss ? diffCfg.cdMult : 1);
      const leadX = p.x + (p.vx || 0) * (e.isClone ? 0.08 : 0.22);
      const leadY = p.y + (p.vy || 0) * (e.isClone ? 0.08 : 0.22);
      const ang = Math.atan2(leadY - e.y, leadX - e.x);
      const orbSpeed = e.isClone ? 4.8 : e.id === "mirror_self" ? 6.4 : 5.6;
      const orbColor = e.id === "mirror_self" && e.mirrorClass === "ranger" ? "#4ade80" : "#c084fc";
      s.projectiles.push({
        x: e.x, y: e.y, vx: Math.cos(ang) * orbSpeed, vy: Math.sin(ang) * orbSpeed,
        radius: e.isClone ? 0.19 : 0.24, color: orbColor, dmg: Math.round(e.atk * 0.85), isEnemy: true, sourceName: e.name, life: 2.0,
      });
      spawnBurst(e.x, e.y, orbColor, 6, 0.7);
    }

    if (dist <= (e.isBoss ? 1.15 : 0.95) && e.attackTimer <= 0) {
      const baseWindup = e.id === "royal_goblin" ? 0.32 / (1 + grakMissingPct * 0.65) : 0.32;
      e.windupTimer = baseWindup * (e.isBoss ? diffCfg.windupMult : 1);
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
      } else if ((e.id === "void_king" || (e.id === "mirror_self" && e.mirrorClass !== "gilded")) && dist < 2.6) {
        const strafeDir = e.enraged ? -1 : 1;
        moveDirX = -moveDirX * 0.7 + -moveDirY * 0.55 * strafeDir;
        moveDirY = -moveDirY * 0.7 + moveDirX * 0.55 * strafeDir;
      } else if (e.id === "mirror_self" && e.mirrorClass !== "gilded" && dist >= 2.6 && dist <= 5.2) {
        const strafeDir = e.enraged ? -1 : 1;
        moveDirX = -moveDirY * 0.65 * strafeDir;
        moveDirY = moveDirX * 0.65 * strafeDir;
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
