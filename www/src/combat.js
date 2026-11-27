import { sfx } from "./audio.js";
import { DIFFICULTIES, HERO_CLASSES, ITEMS, LORE_CODEX, SPELLS } from "./data.js";
import { broadcastPvpAction, sendPvpHit } from "./pvp.js";
import { MAP_H, MAP_W, TILE } from "./dungeon.js";
import {
  addFloat,
  addLog,
  clearSavedRun,
  getActiveSpells,
  getPlayerStats,
  getRarityInfo,
  getWeaponCategory,
  hasRelic,
  mouse,
  moveWithSlide,
  runtime,
  saveMeta,
  saveRun,
  spawnBurst,
  spawnGroundDecal,
  spawnGroundItem,
  spawnRing,
  TILE_SIZE,
  touchAim,
  touchMove,
  keys,
} from "./state.js";

export const combatHooks = {
  interactProp: null,
  updateUI: null,
  buildSpellButtons: null,
  openSkillDialog: null,
};

export function unlockCodex(id) {
  if (!runtime.meta.unlockedCodex.includes(id)) {
    runtime.meta.unlockedCodex.push(id);
    saveMeta();
    const entry = LORE_CODEX.find((c) => c.id === id);
    if (entry) addLog(`Lore Unlocked: ${entry.title}`, "story");
  }
}

export function recordBestiary(enemy, killed = false) {
  if (!enemy || enemy.isClone) return;
  const id = enemy.id;
  if (!id) return;
  if (!runtime.meta.bestiary) runtime.meta.bestiary = {};
  const rec = runtime.meta.bestiary[id] || { seen: 0, kills: 0 };
  if (!killed) rec.seen += 1;
  else rec.kills += 1;
  runtime.meta.bestiary[id] = rec;
}

export function getAimAngle() {
  const p = runtime.state.player;
  if (touchAim.active) {
    return touchAim.angle;
  }
  if (mouse.inside && mouse.x !== null) {
    return Math.atan2(mouse.y - p.y, mouse.x - p.x);
  }
  return p.aimAngle;
}

export function grantXP(amount) {
  const s = runtime.state;
  const p = s.player;
  const scholarRank = runtime.meta.soulForge?.scholar_tome || 0;
  const scaledXp = Math.max(1, Math.round(amount * (1 + scholarRank * 0.12)));
  p.xp += scaledXp;
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
    sfx.levelUp();
    addFloat(p.x, p.y, "LEVEL UP! +1 SKILL PT", "#facc15");
    spawnBurst(p.x, p.y, "#facc15", 20, 1.3);
    spawnRing(p.x, p.y, 48, "#facc15", 0.45);
    addLog(`Level ${p.level} reached! +1 Skill Point, +8 HP, +4 MP, +2 ATK, +1 DEF.`, "loot");
  }
  runtime.uiDirty = true;
  saveRun();
}

export function upgradeSkillById(spellId) {
  const s = runtime.state;
  if (!s || s.runEnded) return false;
  const p = s.player;
  const sp = SPELLS.find((x) => x.id === spellId);
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

  runtime.uiDirty = true;
  saveRun();
  return true;
}

export function healPlayer(amount, sourceLabel = null) {
  const s = runtime.state;
  if (!s) return 0;
  const p = s.player;
  const stats = getPlayerStats();
  const mult = p.heroClass === "paladin" ? 1.25 : 1.0;
  const finalHeal = Math.max(1, Math.round(amount * mult));
  const before = p.hp;
  p.hp = Math.min(stats.maxHp, p.hp + finalHeal);
  const gained = Math.max(0, Math.round(p.hp - before));
  if (sourceLabel) {
    addFloat(p.x, p.y - 0.35, `+${finalHeal} HP`, "#4ade80");
    addLog(`${sourceLabel} (+${finalHeal} HP).`, "heal");
  }
  runtime.uiDirty = true;
  return gained;
}

export function damageEnemy(enemy, rawDmg, isCrit = false, sourceLabel = "strike", knockX = 0, knockY = 0, options = {}) {
  const s = runtime.state;
  if (!s || !enemy || enemy.hp <= 0) return;
  const p = s.player;
  const stats = getPlayerStats();

  if ((enemy.evadeTimer || 0) > 0 && !options.ignoreDodge) {
    addFloat(enemy.x, enemy.y - 0.45, "DODGED!", "#38bdf8");
    spawnBurst(enemy.x, enemy.y, "#38bdf8", 8, 0.9);
    addLog(`${enemy.name} dodged your ${sourceLabel}!`, "info");
    return;
  }

  // Clockwork Sentinel frontal shield check
  let shieldMult = 1.0;
  if (
    enemy.role === "shielded" &&
    !options.bypassShield &&
    !options.isAoe &&
    !options.pierce &&
    (enemy.stunTimer || 0) <= 0 &&
    (enemy.frozenTimer || 0) <= 0 &&
    (enemy.sunderTimer || 0) <= 0
  ) {
    const attackFromFront = enemy.facingLeft ? p.x < enemy.x : p.x > enemy.x;
    if (attackFromFront) {
      shieldMult = 0.4;
      addFloat(enemy.x, enemy.y - 0.55, "SHIELDED!", "#94a3b8");
    }
  }

  // Interrupt Malakor's Dark Mending channel on crit or heavy skill
  if (enemy.bossAction?.type === "dark_mend" && (isCrit || options.canInterrupt)) {
    enemy.bossAction = null;
    enemy.stunTimer = Math.max(enemy.stunTimer || 0, 1.2);
    sfx.smite();
    addFloat(enemy.x, enemy.y - 0.65, "INTERRUPTED!", "#38bdf8");
    spawnRing(enemy.x, enemy.y, 40, "#38bdf8", 0.35);
    addLog(`Interrupted ${enemy.name}'s Dark Mending and stunned them!`, "story");
  }

  let modDmg = rawDmg * shieldMult;
  if (hasRelic("frost_core", p) && ((enemy.chilled || 0) > 0 || (enemy.frozenTimer || 0) > 0)) {
    modDmg *= 1.2;
  }
  if (stats.setPassives.has("voidbreaker_slayer") && (enemy.isBoss || enemy.isElite)) {
    modDmg *= 1.2;
  }
  if (stats.setPassives.has("sovereign_fury") && options.isSkill) {
    modDmg *= 1.2;
  }

  if (enemy.isPvpPlayer) {
    const outDmg = Math.max(1, Math.round(modDmg));
    enemy.hurtTimer = 0.16;
    s.shake = Math.max(s.shake, isCrit ? 5 : 2.5);
    addFloat(enemy.x, enemy.y, `${outDmg}${isCrit ? "!" : ""}`, isCrit ? "#fde047" : "#f87171");
    spawnBurst(enemy.x, enemy.y, isCrit ? "#fde047" : "#ef4444", isCrit ? 12 : 8);
    sendPvpHit({
      dmg: outDmg,
      isCrit,
      source: sourceLabel,
      knockX,
      knockY,
      stunDur: options.stunDur || 0,
      freezeDur: options.freezeDur || 0,
      sunderDur: options.sunderDur || 0,
    });
    if (isCrit && p.heroClass === "gilded") {
      for (const sp of getActiveSpells(p)) {
        if ((s.spellCooldowns[sp.id] || 0) > 0) {
          s.spellCooldowns[sp.id] = Math.max(0, s.spellCooldowns[sp.id] - 0.5);
        }
      }
    }
    return;
  }

  const baseDef = (enemy.def || 0) + (enemy.bonusDef || 0);
  const sunderPenalty = (enemy.sunderTimer || 0) > 0 ? Math.max(3, Math.floor(baseDef * 0.35)) : 0;
  const effectiveDef = Math.max(0, baseDef - sunderPenalty);
  const flatBlock = Math.floor(effectiveDef * 0.28);
  const pctMult = 100 / (100 + effectiveDef * 1.8);
  const dmg = Math.max(1, Math.round(Math.max(1, modDmg - flatBlock) * pctMult));
  enemy.hp -= dmg;
  enemy.hurtTimer = 0.16;
  enemy.kbX += knockX;
  enemy.kbY += knockY;
  s.shake = Math.max(s.shake, isCrit ? 5 : 2.5);
  if (isCrit) s.hitstop = Math.max(s.hitstop, 0.03);

  addFloat(enemy.x, enemy.y, `${dmg}${isCrit ? "!" : ""}`, isCrit ? "#fde047" : "#f87171");
  spawnBurst(enemy.x, enemy.y, isCrit ? "#fde047" : "#ef4444", isCrit ? 12 : 8);
  addLog(`Your ${sourceLabel} hits ${enemy.name} for ${dmg} damage${isCrit ? " (CRIT!)" : ""}.`, "combat");

  if (!options.noOnHit) {
    // Sunfire 4pc burn
    if (stats.setPassives.has("sunfire_burn")) {
      enemy.burnTimer = 3.0;
      enemy.burnDmg = Math.max(2, Math.round(stats.atk * 0.18));
    }

    // Gilded Knight Passive: Crits reduce active skill cooldowns by 0.5s
    if (isCrit && p.heroClass === "gilded") {
      for (const sp of getActiveSpells(p)) {
        if ((s.spellCooldowns[sp.id] || 0) > 0) {
          s.spellCooldowns[sp.id] = Math.max(0, s.spellCooldowns[sp.id] - 0.5);
        }
      }
    }

    // Sylvan Ranger 4pc: Crits grant Windstep Haste
    if (isCrit && stats.setPassives.has("ranger_windstep")) {
      p.hasteTimer = Math.max(p.hasteTimer || 0, 2.0);
    }

    // Crimson Fang Relic: Crits heal 2 HP
    if (isCrit && hasRelic("vampiric_fang", p)) {
      healPlayer(2);
    }

    // Stormcaller Sigil Relic: Every 4th hit arcs lightning to up to 2 nearby enemies
    if (hasRelic("storm_sigil", p)) {
      p.hitCounter = (p.hitCounter || 0) + 1;
      if (p.hitCounter >= 4) {
        p.hitCounter = 0;
        const chainTargets = s.level.enemies
          .filter((other) => other.uid !== enemy.uid && other.hp > 0 && Math.hypot(other.x - enemy.x, other.y - enemy.y) <= 3.6)
          .slice(0, 2);
        if (chainTargets.length > 0) {
          sfx.smite();
          const arcDmg = Math.max(2, Math.round(stats.atk * 0.65));
          for (const ct of chainTargets) {
            spawnRing(ct.x, ct.y, 26, "#38bdf8", 0.25);
            addFloat(ct.x, ct.y - 0.4, "LIGHTNING!", "#38bdf8");
            damageEnemy(ct, arcDmg, false, "Stormcaller Sigil", 0, 0, { noOnHit: true, isAoe: true });
          }
        }
      }
    }
  }

  if (!options.isReflect && !enemy.isClone && (enemy.reflectTimer || 0) > 0 && enemy.hp > 0) {
    const reflectDmg = Math.max(1, Math.round(dmg * (enemy.reflectPct || 0.35)));
    const dx = p.x - enemy.x;
    const dy = p.y - enemy.y;
    const dist = Math.max(0.01, Math.hypot(dx, dy));
    spawnBurst(enemy.x, enemy.y, "#fde047", 6, 0.8);
    hurtPlayer(reflectDmg, `${enemy.name}'s Golden Reflect`, (dx / dist) * 2.0, (dy / dist) * 2.0, { isReflect: true });
  }

  if (enemy.hp <= 0) {
    sfx.loot();
    if (!enemy.isClone) {
      s.kills += 1;
      recordBestiary(enemy, true);
      const goldMult = hasRelic("greedy_idol", p) ? 1.35 : 1.0;
      const goldEarned = Math.round((enemy.gold || 0) * goldMult);
      p.gold += goldEarned;

      if (hasRelic("mana_siphon", p)) {
        p.mp = Math.min(stats.maxMp, p.mp + 3);
      }
      if (stats.setPassives.has("crimson_harvest")) {
        healPlayer(5);
      }
    }
    s.hitstop = Math.max(s.hitstop, 0.035);
    spawnBurst(enemy.x, enemy.y, enemy.isBoss ? "#facc15" : enemy.isClone ? "#c084fc" : enemy.isElite ? enemy.eliteColor : "#fb7185", enemy.isBoss ? 28 : 14, 1.25);
    if (enemy.isClone) {
      addLog(`Shattered ${enemy.name}!`, "combat");
    } else {
      addLog(`${enemy.name} defeated! (+${enemy.xp} XP, +${enemy.gold} Gold)`, "loot");
      grantXP(enemy.xp);
    }

    if (enemy.isBoss) {
      handleBossDefeated(enemy);
    } else if (!enemy.isClone) {
      if (enemy.isElite) {
        const elitePool = Object.values(ITEMS).filter((it) => it.slot && (s.floor >= 5 ? ["rare", "unique"].includes(it.rarity) : ["uncommon", "rare"].includes(it.rarity)));
        const drop = elitePool.length > 0 && Math.random() < 0.72
          ? elitePool[Math.floor(Math.random() * elitePool.length)]
          : Math.random() < 0.5 ? ITEMS.health_potion : ITEMS.mana_potion;
        const rInfo = getRarityInfo(drop);
        spawnGroundItem(drop, enemy.x, enemy.y);
        addFloat(enemy.x, enemy.y - 0.35, `Elite Drop: ${drop.name}!`, rInfo.color);
        addLog(`Elite ${enemy.name} dropped [${rInfo.label}] ${drop.name}!`, "loot");
      } else if (Math.random() < 0.28) {
        const drop = Math.random() < 0.6 ? ITEMS.health_potion : ITEMS.bread;
        spawnGroundItem(drop, enemy.x, enemy.y);
        addFloat(enemy.x, enemy.y - 0.35, `Dropped ${drop.name}`, "#fde047");
        addLog(`${enemy.name} dropped ${drop.name} on the ground.`, "loot");
      }
    }

    s.level.enemies = s.level.enemies.filter((e) => e.uid !== enemy.uid);
    if (!enemy.isBoss && !enemy.isClone && !s.level.isBossFloor) {
      const left = s.level.enemies.filter((e) => !e.isBoss && !e.isClone).length;
      if (left === 0 && s.level.stairsPos) {
        const { x, y } = s.level.stairsPos;
        s.level.grid[y][x] = TILE.STAIRS;
        s.level.explored[y][x] = true;
        spawnBurst(x + 0.5, y + 0.5, "#94a3b8", 18, 1.2);
        spawnRing(x + 0.5, y + 0.5, 42, "#cbd5e1", 0.45);
        addFloat(p.x, p.y - 0.6, "STAIRS UNLOCKED!", "#38bdf8");
        addLog("All enemies defeated! The stone stairs to the next floor have appeared.", "story");
      }
    }
    if (!enemy.isBoss && !enemy.isClone && s.level.isBossFloor) {
      const nonBossLeft = s.level.enemies.filter((e) => !e.isBoss && !e.isClone).length;
      if (nonBossLeft === 0 && !s.hasBossKey && !s.bossKeyDrop) {
        s.bossKeyDrop = { x: enemy.x, y: enemy.y };
        addFloat(enemy.x, enemy.y - 0.4, "BOSS KEY DROPPED!", "#facc15");
        spawnBurst(enemy.x, enemy.y, "#facc15", 20, 1.3);
        addLog("The last guardian dropped the Boss Key! Look to the Boss Chamber.", "story");

        const rooms = s.level.rooms || [];
        const bossRoom = rooms[rooms.length - 1];
        if (bossRoom) {
          for (let y = Math.max(0, bossRoom.y - 1); y <= Math.min(MAP_H - 1, bossRoom.y + bossRoom.h); y++) {
            for (let x = Math.max(0, bossRoom.x - 1); x <= Math.min(MAP_W - 1, bossRoom.x + bossRoom.w); x++) {
              s.level.explored[y][x] = true;
            }
          }
          s.camReveal = {
            targetX: bossRoom.cx + 0.5,
            targetY: bossRoom.cy + 0.5,
            timer: 2.3,
            duration: 2.3,
          };
        }
      }
    }
    runtime.uiDirty = true;
  }
}

export function handleBossDefeated(boss) {
  const s = runtime.state;
  for (const cl of s.level.enemies) {
    if (cl.isClone) spawnBurst(cl.x, cl.y, "#c084fc", 12, 0.9);
  }
  s.level.enemies = s.level.enemies.filter((e) => !e.isClone);

  const shardIdx = boss.shardIndex;
  const bonus = DIFFICULTIES[s.difficulty]?.shardBonus || 0;
  if (shardIdx !== undefined && s.floor <= 12) {
    s.shardsCollected[shardIdx] = true;
    runtime.meta.soulShards += 3 + bonus;
    saveMeta();
    addLog(`You reclaimed Crown Shard ${shardIdx + 1}! (+${3 + bonus} Soul Shards)`, "story");
  } else {
    const abyssShards = 2 + bonus;
    runtime.meta.soulShards += abyssShards;
    saveMeta();
    addLog(`Vanquished ${boss.name} in Endless Abyss! (+${abyssShards} Soul Shards)`, "story");
  }

  const bossLootPool =
    s.floor >= 8
      ? Object.values(ITEMS).filter((it) => it.rarity === "legendary")
      : Object.values(ITEMS).filter((it) => it.rarity === "unique");
  if (bossLootPool.length > 0) {
    const bossDrop = bossLootPool[Math.floor(Math.random() * bossLootPool.length)];
    const rInfo = getRarityInfo(bossDrop);
    spawnGroundItem(bossDrop, boss.x, boss.y);
    addFloat(boss.x, boss.y - 0.5, `${rInfo.label}: ${bossDrop.name}!`, rInfo.color);
    addLog(`${boss.name} dropped [${rInfo.label}] ${bossDrop.name}!`, "loot");
  }

  for (const pr of s.level.props) {
    if (pr.kind === "door" && pr.locked) {
      pr.locked = false;
      pr.opened = true;
      pr.solid = false;
    }
  }
  const bossBar = document.getElementById("boss-hud-bar");
  if (bossBar) bossBar.hidden = true;

  if (s.floor === 12 && !s.isEndless) {
    runtime.meta.victories += 1;
    runtime.meta.soulShards += 5 + bonus;
    saveMeta();
    endRun(true);
    return;
  }

  const { x, y } = s.level.stairsPos;
  s.level.grid[y][x] = TILE.STAIRS;
  spawnBurst(x + 0.5, y + 0.5, "#38bdf8", 24, 1.4);
  spawnRing(x + 0.5, y + 0.5, 56, "#38bdf8", 0.6);
  addLog("The sanctum seal breaks! Stairs to the next floor have appeared.", "story");
  runtime.uiDirty = true;
}

export function performMeleeAttack() {
  const s = runtime.state;
  if (!s || s.runEnded || s.dyingTimer > 0) return;
  const p = s.player;
  if ((p.stunTimer || 0) > 0 || (p.frozenTimer || 0) > 0 || p.attackCd > 0) return;

  const angle = getAimAngle();
  p.aimAngle = angle;
  p.facingLeft = Math.cos(angle) < 0;
  const stats = getPlayerStats();
  const weapon = p.equipment?.weapon;
  const isRanged =
    weapon && (weapon.weaponType === "bow" || weapon.weaponType === "wand" || weapon.weaponType === "staff" || weapon.ranged);

  p.basicShotCount = (p.basicShotCount || 0) + 1;
  const isKeenShot = p.heroClass === "ranger" && p.basicShotCount % 3 === 0;

  if (isRanged) {
    const isBow = weapon.weaponType === "bow" || weapon.projectileKind === "arrow" || weapon.projectileKind === "fire_arrow";
    p.anim = isBow && p.heroClass === "ranger" ? "bow" : "attack";
    p.animTimer = 0.22;
    p.attackCd = weapon.attackCd || 0.36;

    const isCrit = Math.random() * 100 < stats.crit;
    const baseDmg = Math.round(stats.atk * (isCrit ? 1.65 : 1) * (isKeenShot ? 1.35 : 1));
    const speed = (weapon.projSpeed || (isBow ? 13.0 : 11.5)) * (isKeenShot ? 1.2 : 1);
    const color = isKeenShot ? "#4ade80" : weapon.projColor || (isBow ? "#fde047" : "#38bdf8");

    if (isBow) sfx.arrow();
    else sfx.magicOrb();

    if (isKeenShot) {
      addFloat(p.x, p.y - 0.5, "KEEN SHOT!", "#4ade80");
    }

    const pushShot = (shotAng, dmgVal, radScale = 1, pierce = false) => {
      s.projectiles.push({
        x: p.x + Math.cos(shotAng) * 0.42,
        y: p.y + Math.sin(shotAng) * 0.42,
        vx: Math.cos(shotAng) * speed,
        vy: Math.sin(shotAng) * speed,
        radius: (isBow ? 0.22 : 0.25) * radScale,
        color,
        dmg: dmgVal,
        isCrit,
        isEnemy: false,
        isArrow: isBow,
        isMagicOrb: !isBow,
        pierce,
        hitIds: pierce ? new Set() : null,
        fireTrail: weapon.projectileKind === "fire_arrow",
        chill: weapon.chill || 0,
        life: 0.92,
        label: isKeenShot ? "Keen Quiver" : weapon.name,
      });
      if (s.isPvp) {
        broadcastPvpAction({
          kind: "projectile",
          x: p.x + Math.cos(shotAng) * 0.42,
          y: p.y + Math.sin(shotAng) * 0.42,
          vx: Math.cos(shotAng) * speed,
          vy: Math.sin(shotAng) * speed,
          radius: (isBow ? 0.22 : 0.25) * radScale,
          color,
          isArrow: isBow,
          isMagicOrb: !isBow,
          pierce,
          life: 0.92,
        });
      }
    };

    pushShot(angle, baseDmg, isKeenShot ? 1.15 : 1, isKeenShot);

    if (hasRelic("twin_fletch", p) && Math.random() < 0.35) {
      const side = Math.random() < 0.5 ? 0.14 : -0.14;
      pushShot(angle + side, Math.max(1, Math.round(baseDmg * 0.55)), 0.85, false);
    }

    spawnBurst(p.x + Math.cos(angle) * 0.4, p.y + Math.sin(angle) * 0.4, color, 4, 0.55);
    return;
  }

  p.anim = "attack";
  p.animTimer = 0.24;
  p.attackCd = 0.34;
  moveWithSlide(p, Math.cos(angle) * 0.18, Math.sin(angle) * 0.18, 0.28);

  s.slashes.push({
    x: p.x * TILE_SIZE,
    y: p.y * TILE_SIZE,
    angle,
    radius: 36,
    life: 0.16,
    maxLife: 0.16,
    color: isKeenShot ? "#4ade80" : "#fde047",
  });
  if (s.isPvp) broadcastPvpAction({ kind: "slash", x: p.x, y: p.y, angle, radius: 36, color: "#fde047", life: 0.16 });
  sfx.slash();

  const reach = 1.55;
  let hitAny = false;

  for (const e of [...s.level.enemies]) {
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

  for (const pr of s.level.props) {
    if (!pr.solid || !["crate", "barrel", "urn"].includes(pr.kind)) continue;
    const dx = pr.x + 0.5 - p.x;
    const dy = pr.y + 0.5 - p.y;
    if (Math.hypot(dx, dy) <= reach && combatHooks.interactProp) {
      combatHooks.interactProp(pr);
      hitAny = true;
    }
  }

  if (hitAny) s.shake = Math.max(s.shake, 2);
}

export function performDash() {
  const s = runtime.state;
  if (!s || s.runEnded || s.dyingTimer > 0) return;
  const p = s.player;
  if ((p.stunTimer || 0) > 0 || p.dashCd > 0 || p.dashTimer > 0) return;
  if (p.mp < 10) {
    addLog("Not enough MP to Dash! (10 MP required)", "info");
    return;
  }
  p.mp -= 10;
  runtime.uiDirty = true;

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

  const stats = getPlayerStats();
  if (p.heroClass === "paladin") {
    spawnBurst(p.x, p.y, "#fde047", 12, 1.0);
    spawnRing(p.x, p.y, 64, "#fde047", 0.28);
    const dmg = Math.max(2, Math.round(stats.atk * 0.55));
    for (const e of [...s.level.enemies]) {
      const ex = e.x - p.x;
      const ey = e.y - p.y;
      const dist = Math.hypot(ex, ey);
      if (dist <= 2.0) {
        const nx = dist > 0.01 ? ex / dist : dx;
        const ny = dist > 0.01 ? ey / dist : dy;
        damageEnemy(e, dmg, false, "Sanctum Shockwave", nx * 5.2, ny * 5.2, { isAoe: true });
      }
    }
  } else if (p.heroClass === "gilded") {
    p.gildedDashHitIds = new Set();
    spawnBurst(p.x, p.y, "#facc15", 10, 0.95);
  } else if (p.heroClass === "ranger") {
    spawnBurst(p.x, p.y, "#4ade80", 10, 0.9);
    let nearest = null;
    let bestDist = 8.0;
    for (const e of s.level.enemies) {
      if (e.isBoss && !s.bossFightStarted) continue;
      if (!s.level.visible[Math.floor(e.y)]?.[Math.floor(e.x)]) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < bestDist) {
        bestDist = d;
        nearest = e;
      }
    }
    const shotAng = nearest ? Math.atan2(nearest.y - p.y, nearest.x - p.x) : Math.atan2(-dy, -dx);
    sfx.arrow();
    s.projectiles.push({
      x: p.x,
      y: p.y,
      vx: Math.cos(shotAng) * 14.0,
      vy: Math.sin(shotAng) * 14.0,
      radius: 0.22,
      color: "#4ade80",
      dmg: Math.max(2, Math.round(stats.atk * 0.7)),
      isEnemy: false,
      isArrow: true,
      life: 0.75,
      label: "Parting Shot",
    });
  } else {
    spawnBurst(p.x, p.y, "#38bdf8", 8, 0.9);
  }

  if (hasRelic("ember_spur", p)) {
    const emberDmg = Math.max(2, Math.round(stats.atk * 0.7));
    spawnBurst(p.x, p.y, "#fb923c", 12, 1.1);
    spawnRing(p.x, p.y, 48, "#fb923c", 0.3);
    for (const e of [...s.level.enemies]) {
      if (Math.hypot(e.x - p.x, e.y - p.y) <= 1.75) {
        damageEnemy(e, emberDmg, false, "Emberweave Spur", 0, 0, { isAoe: true });
      }
    }
  }
}

export function castSpell(spellId) {
  const s = runtime.state;
  if (!s || s.runEnded || s.dyingTimer > 0) return;
  const spell = SPELLS.find((x) => x.id === spellId);
  if (!spell) return;
  const p = s.player;
  if ((p.stunTimer || 0) > 0 || (p.frozenTimer || 0) > 0 || p.leap || p.ultCharge || p.rapidSlash || p.valiantCharge || p.radiantCharge) return;
  const stats = getPlayerStats();

  const rank = p.skillRanks[spell.id] || 0;
  if (rank <= 0) {
    addLog(`${spell.name} is locked! Level up to earn Skill Points.`, "info");
    return;
  }
  if (s.spellCooldowns[spell.id] > 0) return;

  const mpCost = stats.setPassives.has("astral_efficiency") ? Math.max(1, Math.round(spell.mpCost * 0.75)) : spell.mpCost;
  if (p.mp < mpCost) {
    addLog("Not enough MP!", "info");
    return;
  }

  const rIdx = Math.min(rank - 1, spell.cooldowns.length - 1);
  p.mp -= mpCost;
  s.spellCooldowns[spell.id] = spell.cooldowns[rIdx];
  runtime.uiDirty = true;

  const angle = getAimAngle();
  p.aimAngle = angle;
  p.facingLeft = Math.cos(angle) < 0;

  if (spell.type === "aoe_self") {
    sfx.nova();
    p.anim = "attack";
    p.animTimer = 0.24;
    s.shake = Math.max(s.shake, 5);
    const radius = spell.radii[rIdx];
    const dmg = Math.round(stats.atk * spell.mults[rIdx]);
    spawnBurst(p.x, p.y, spell.color, 22, 1.3);
    spawnRing(p.x, p.y, radius * TILE_SIZE, spell.color, 0.35);
    spawnRing(p.x, p.y, radius * TILE_SIZE * 0.65, "#fde047", 0.25);
    spawnGroundDecal(p.x, p.y, "vfx_holy_ground_impact", radius * TILE_SIZE * 2.05, 0.55, { scaleStart: 0.45, scaleEnd: 1.12, spin: 0.7 });
    if (s.isPvp) broadcastPvpAction({ kind: "ring", x: p.x, y: p.y, radPx: radius * TILE_SIZE, color: spell.color, dur: 0.38 });

    const hits = s.level.enemies.filter((e) => Math.hypot(e.x - p.x, e.y - p.y) <= radius + 0.35);
    for (const e of hits) {
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const dist = Math.max(0.01, Math.hypot(dx, dy));
      damageEnemy(e, dmg, false, spell.name, (dx / dist) * 5.2, (dy / dist) * 5.2, { isSkill: true, isAoe: true });
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
    s.projectiles.push({
      x: p.x + Math.cos(angle) * 0.4,
      y: p.y + Math.sin(angle) * 0.4,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: 0.25,
      color: spell.color,
      dmg: Math.round(stats.atk * spell.mults[rIdx]) + spell.flats[rIdx],
      isEnemy: false,
      isFrostLance: true,
      isSkill: true,
      chill: spell.chills[rIdx],
      frostRadius: 2.0,
      frostDuration: 4.0,
      frostFreezeDur: 1.5,
      frostShatterDmg: Math.max(2, Math.round(stats.atk * 0.35)),
      life: range / speed,
      label: spell.name,
    });
    if (s.isPvp) {
      broadcastPvpAction({
        kind: "projectile",
        x: p.x + Math.cos(angle) * 0.4,
        y: p.y + Math.sin(angle) * 0.4,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 0.25,
        color: spell.color,
        isFrostLance: true,
        life: range / speed,
      });
    }
    return;
  }

  if (spell.type === "targeted") {
    sfx.smite();
    p.anim = "attack";
    p.animTimer = 0.22;

    let bestEnemy = null;
    let bestDist = spell.range + 0.4;
    for (const e of s.level.enemies) {
      if (e.isBoss && !s.bossFightStarted) continue;
      if (!s.level.visible[Math.floor(e.y)]?.[Math.floor(e.x)]) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d <= bestDist) {
        bestDist = d;
        bestEnemy = e;
      }
    }

    const targetX = bestEnemy ? bestEnemy.x : p.x + Math.cos(angle) * 2.2;
    const targetY = bestEnemy ? bestEnemy.y : p.y + Math.sin(angle) * 2.2;
    if (bestEnemy) p.facingLeft = bestEnemy.x < p.x;

    spawnBurst(targetX, targetY, spell.color, 18, 1.2);
    spawnRing(targetX, targetY, 38, spell.color, 0.35);
    spawnGroundDecal(targetX, targetY, "vfx_holy_ground_impact", 84, 0.65, { scaleStart: 0.72, scaleEnd: 1.08, spin: 0.5 });
    s.beams.push({ x: targetX * TILE_SIZE, y: targetY * TILE_SIZE, color: spell.color, life: 0.36, maxLife: 0.36 });
    if (s.isPvp) broadcastPvpAction({ kind: "beam", x: targetX, y: targetY, color: spell.color });
    s.shake = Math.max(s.shake, 4);

    const dmg = Math.round(stats.atk * spell.mults[rIdx]) + spell.flats[rIdx];
    for (const e of [...s.level.enemies]) {
      if (Math.hypot(e.x - targetX, e.y - targetY) <= 1.25) {
        damageEnemy(e, dmg, false, spell.name, 0, 0, { isSkill: true, isAoe: true, canInterrupt: true });
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
    p.animTimer = 0.67;
    p.radiantCharge = {
      timer: 0.65,
      duration: 0.65,
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
    const gained = healPlayer(spell.heals[rIdx]);
    p.hasteTimer = spell.duration;
    p.stunTimer = 0;
    sfx.heal();
    spawnBurst(p.x, p.y, "#34d399", 18, 1.2);
    spawnRing(p.x, p.y, 38, "#34d399", 0.4);
    spawnGroundDecal(p.x, p.y, "vfx_heal_haste_aura", 92, 0.48, { scaleStart: 0.65, scaleEnd: 1.25, spin: 1.2 });
    addFloat(p.x, p.y - 0.35, `+${gained} HP · HASTE`, "#34d399");
    addLog(`${spell.name}: Restored ${gained} HP and gained +15% Speed!`, "heal");
    return;
  }

  if (spell.type === "valiant_charge") {
    sfx.ultLeap();
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    p.facingLeft = dirX < 0;
    p.anim = "attack";
    p.animTimer = 1.05;
    p.iFrames = Math.max(p.iFrames, 1.08);

    let endX = p.x;
    let endY = p.y;
    const maxDist = spell.dist || 5.5;
    const step = 0.25;
    for (let d = step; d <= maxDist; d += step) {
      const nx = p.x + dirX * d;
      const ny = p.y + dirY * d;
      if (Math.hypot(nx - p.x, ny - p.y) <= maxDist && !s.level.props.some((pr) => pr.solid && pr.x === Math.floor(nx) && pr.y === Math.floor(ny)) && s.level.grid[Math.floor(ny)]?.[Math.floor(nx)] !== TILE.WALL) {
        endX = nx;
        endY = ny;
      } else {
        break;
      }
    }
    const travelDist = Math.hypot(endX - p.x, endY - p.y);
    const spearDistMax = Math.max(1.65, travelDist);
    p.valiantCharge = {
      phase: "windup",
      timer: 0.62,
      windupDur: 0.62,
      dashDur: 0.38,
      startX: p.x,
      startY: p.y,
      targetX: endX,
      targetY: endY,
      travelDist,
      spearDistMax,
      traveled: 0,
      dirX,
      dirY,
      speed: travelDist > 0.05 ? travelDist / 0.38 : 0,
      baseDmg: Math.round(stats.atk * spell.mults[rIdx]),
      wallBonus: spell.wallBonus || 0.65,
      piercedIds: new Set(),
      hitIds: new Set(),
      spell,
    };
    spawnRing(p.x, p.y, 26, "#38bdf8", 0.35);
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
    s.slashes.push({ x: p.x * TILE_SIZE, y: p.y * TILE_SIZE, angle, color: spell.color, life: 0.24, maxLife: 0.24 });
    spawnGroundDecal(p.x, p.y, "vfx_damage_aoe_field", spell.range * TILE_SIZE * 1.45, 0.3, { scaleStart: 0.55, scaleEnd: 1.05, spin: 1.4 });
    const dmg = Math.round(stats.atk * spell.mults[rIdx]);
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    let totalDmg = 0;
    for (const e of [...s.level.enemies]) {
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= spell.range) {
        const dot = dist < 0.01 ? 1 : (dx / dist) * dirX + (dy / dist) * dirY;
        if (dot >= -0.15 || dist < 0.9) {
          damageEnemy(e, dmg, false, spell.name, dirX * 3.0, dirY * 3.0, { isSkill: true, isAoe: true });
          totalDmg += dmg;
        }
      }
    }
    if (totalDmg > 0) {
      const healAmt = Math.max(1, Math.round(totalDmg * spell.lifesteals[rIdx]));
      const gained = healPlayer(healAmt);
      addFloat(p.x, p.y - 0.35, `+${gained} HP`, "#4ade80");
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
    p.ultCharge = { timer: spell.chargeTime, duration: spell.chargeTime, rankIdx: rIdx, spell };
    addFloat(p.x, p.y - 0.5, "CHARGING...", "#fde047");
    addLog(`${spell.name}: Raising sword (${spell.chargeTime.toFixed(1)}s charge)...`, "story");
    return;
  }

  if (spell.type === "arrow_volley") {
    sfx.arrow();
    p.anim = p.heroClass === "ranger" ? "bow" : "attack";
    p.animTimer = 0.22;
    const speed = 13.0;
    const dmg = Math.round(stats.atk * spell.mults[rIdx]);
    for (const offset of [-0.22, 0, 0.22]) {
      const a = angle + offset;
      s.projectiles.push({
        x: p.x + Math.cos(a) * 0.4,
        y: p.y + Math.sin(a) * 0.4,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        radius: 0.24,
        color: spell.color,
        dmg,
        isEnemy: false,
        isArrow: true,
        isSkill: true,
        life: 0.72,
        label: spell.name,
      });
      if (s.isPvp) {
        broadcastPvpAction({
          kind: "projectile",
          x: p.x + Math.cos(a) * 0.4,
          y: p.y + Math.sin(a) * 0.4,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          radius: 0.24,
          color: spell.color,
          isArrow: true,
          life: 0.72,
        });
      }
    }
    return;
  }

  if (spell.type === "piercing_shot") {
    sfx.frost();
    p.anim = p.heroClass === "ranger" ? "bow" : "attack";
    p.animTimer = 0.24;
    const speed = 15.0;
    s.projectiles.push({
      x: p.x + Math.cos(angle) * 0.4,
      y: p.y + Math.sin(angle) * 0.4,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: 0.28,
      color: spell.color,
      dmg: Math.round(stats.atk * spell.mults[rIdx]),
      isEnemy: false,
      isArrow: true,
      isSkill: true,
      pierce: true,
      hitIds: new Set(),
      life: 0.8,
      label: spell.name,
    });
    if (s.isPvp) {
      broadcastPvpAction({
        kind: "projectile",
        x: p.x + Math.cos(angle) * 0.4,
        y: p.y + Math.sin(angle) * 0.4,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 0.28,
        color: spell.color,
        isArrow: true,
        pierce: true,
        life: 0.8,
      });
    }
    return;
  }

  if (spell.type === "battle_rally") {
    const gained = healPlayer(spell.heals[rIdx]);
    const atkBonus = spell.atkBonuses[rIdx];
    p.tempAtk = atkBonus;
    p.tempAtkTimer = spell.duration;
    sfx.levelUp();
    spawnBurst(p.x, p.y, "#fb923c", 16, 1.2);
    spawnRing(p.x, p.y, 38, "#facc15", 0.35);
    spawnGroundDecal(p.x, p.y, "vfx_skyfall_reticle", 96, 0.45, { scaleStart: 0.5, scaleEnd: 1.15, spin: 1.1 });
    addFloat(p.x, p.y - 0.35, `+${gained} HP · +${atkBonus} ATK`, "#fde047");
    addLog(`${spell.name}: +${gained} HP and +${atkBonus} ATK for ${spell.duration}s!`, "heal");
    return;
  }

  if (spell.type === "ultimate_barrage") {
    sfx.ultLeap();
    p.anim = p.heroClass === "ranger" ? "bow" : "attack";
    p.animTimer = 0.35;
    let bestEnemy = null;
    let bestDist = 7.5;
    for (const e of s.level.enemies) {
      if (e.isBoss && !s.bossFightStarted) continue;
      if (!s.level.visible[Math.floor(e.y)]?.[Math.floor(e.x)]) continue;
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

    if (!s.arrowStorms) s.arrowStorms = [];
    if (!s.fallingArrows) s.fallingArrows = [];
    s.arrowStorms.push({
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
  }
}

export function stunPlayer(duration, sourceName = "Boss", color = "#facc15") {
  const s = runtime.state;
  if (!s || s.runEnded || s.dyingTimer > 0) return;
  const p = s.player;
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

export function hurtPlayer(rawDmg, sourceName, knockX = 0, knockY = 0, options = {}) {
  const s = runtime.state;
  const p = s.player;
  if (p.iFrames > 0 || s.runEnded || s.dyingTimer > 0) return;

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
  s.shake = Math.max(s.shake, 5);

  sfx.hit();
  addFloat(p.x, p.y, `-${dmg}`, "#ef4444");
  spawnBurst(p.x, p.y, "#ef4444", 10);
  addLog(`${sourceName} hits you for ${dmg} damage${blocked > 0 ? ` (${blocked} blocked)` : ""}.`, "combat");

  if (hasRelic("aegis_heart", p) && p.hp > 0 && p.hp < stats.maxHp * 0.4 && (p.aegisHeartCd || 0) <= 0) {
    p.aegisHeartCd = 14.0;
    p.tempDef = Math.max(p.tempDef || 0, 8);
    p.tempDefTimer = Math.max(p.tempDefTimer || 0, 5.0);
    spawnRing(p.x, p.y, 40, "#facc15", 0.35);
    addFloat(p.x, p.y - 0.55, "BASTION HEART!", "#facc15");
    addLog("Heart of Bastion activated (+8 DEF for 5s)!", "story");
  }

  if (!options.isReflect && p.retributionTimer > 0) {
    const reflectDmg = Math.max(1, Math.round(rawDmg * (p.retributionReflect || 0.45)));
    for (const e of [...s.level.enemies]) {
      if (Math.hypot(e.x - p.x, e.y - p.y) <= (p.retributionRadius || 2.1) + 0.4) {
        damageEnemy(e, reflectDmg, false, "Seal of Retribution", 0, 0, { isReflect: true, noOnHit: true });
      }
    }
  }
  if (!options.isReflect && stats.setPassives.has("vanguard_thorns")) {
    const thornDmg = Math.max(1, Math.round(rawDmg * 0.25));
    for (const e of [...s.level.enemies]) {
      if (Math.hypot(e.x - p.x, e.y - p.y) <= 1.65) {
        damageEnemy(e, thornDmg, false, "Vanguard Thorns", 0, 0, { isReflect: true, noOnHit: true });
      }
    }
  }

  runtime.uiDirty = true;

  if (p.hp <= 0) {
    p.hp = 0;
    p.anim = "death";
    p.animTimer = 1.0;
    s.dyingTimer = 0.9;
    spawnBurst(p.x, p.y, "#f87171", 20, 1.2);
  }
}

export function endRun(victory) {
  const s = runtime.state;
  s.runEnded = true;
  clearSavedRun();
  const shardsEarned = Math.max(1, Math.floor(s.floor / 2) + (victory ? 5 : 0));
  runtime.meta.soulShards += shardsEarned;
  if (s.floor > (runtime.meta.bestFloor || 1)) runtime.meta.bestFloor = s.floor;
  if (s.isEndless && s.floor > (runtime.meta.endlessBestFloor || 0)) runtime.meta.endlessBestFloor = s.floor;

  const heroName = s.player.name || "Sir Aldric";
  const clsName = HERO_CLASSES[s.player.heroClass]?.name || "Paladin Knight";
  const secs = Math.floor(s.elapsed);
  const mins = Math.floor(secs / 60);
  const rem = String(secs % 60).padStart(2, "0");

  if (!Array.isArray(runtime.meta.runHistory)) runtime.meta.runHistory = [];
  runtime.meta.runHistory.unshift({
    heroName,
    heroClass: clsName,
    difficulty: s.difficulty,
    floor: s.floor,
    kills: s.kills,
    time: `${mins}:${rem}`,
    victory: Boolean(victory),
    date: new Date().toLocaleDateString(),
  });
  if (runtime.meta.runHistory.length > 10) runtime.meta.runHistory.length = 10;
  saveMeta();

  const dlg = document.getElementById("end-dialog");
  document.getElementById("end-dialog-title").textContent = victory
    ? "Victory! The Crown Reforged"
    : "You Have Fallen";
  document.getElementById("end-dialog-summary").textContent = victory
    ? `Malakor's obsidian staff shatters! ${heroName} returns to Oakhaven Bastion bearing all three Crown Shards.`
    : `${heroName} fell on Floor ${s.floor}. Your Soul Shards return to Oakhaven Sanctum to strengthen the next descent.`;

  document.getElementById("end-stats").innerHTML = `
    <div class="stat-pill"><span>Floor Reached</span><strong>${s.floor}${s.isEndless ? " (Endless)" : " / 12"}</strong></div>
    <div class="stat-pill"><span>Enemies Slain</span><strong>${s.kills}</strong></div>
    <div class="stat-pill"><span>Time Survived</span><strong>${mins}:${rem}</strong></div>
    <div class="stat-pill"><span>Soul Shards</span><strong>+${shardsEarned}</strong></div>
  `;

  const endlessBtn = document.getElementById("btn-end-endless");
  if (endlessBtn) {
    endlessBtn.hidden = !victory;
  }

  if (combatHooks.updateUI) combatHooks.updateUI();
  dlg.showModal();
}
