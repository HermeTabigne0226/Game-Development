import { sfx } from "./audio.js";
import { DIFFICULTIES, HERO_CLASSES, ITEMS, LORE_CODEX, SPELLS, rollEquipmentByFloor } from "./data.js";
import { broadcastPvpAction, notifyLocalPvpDefeat, sendPvpHit } from "./pvp.js";
import { MAP_H, MAP_W, TILE } from "./dungeon.js";
import {
  addFloat,
  addLog,
  canOccupy,
  clearSavedRun,
  distPointToSegment,
  getActiveSpells,
  getDashCooldown,
  getDashMpCost,
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
  spawnVfxAnim,
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
  endRun: null,
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
  if (touchMove.active && (Math.abs(touchMove.x) > 0.1 || Math.abs(touchMove.y) > 0.1)) {
    return Math.atan2(touchMove.y, touchMove.x);
  }
  if (mouse.inside && mouse.x !== null) {
    return Math.atan2(mouse.y - p.y, mouse.x - p.x);
  }
  return p.aimAngle;
}

/** Find nearest visible enemy in range, or fall back to directional ground point before walls. */
function findVisibleTargetPos(p, angle, maxRange, fallbackDist = Math.min(3.8, maxRange * 0.72)) {
  const s = runtime.state;
  let bestEnemy = null;
  let bestDist = maxRange + 0.4;
  for (const e of s.level.enemies) {
    if (e.isBoss && !s.bossFightStarted) continue;
    if (!s.level.visible[Math.floor(e.y)]?.[Math.floor(e.x)]) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d <= bestDist) {
      bestDist = d;
      bestEnemy = e;
    }
  }
  if (bestEnemy) {
    p.facingLeft = bestEnemy.x < p.x;
    return { tx: bestEnemy.x, ty: bestEnemy.y, target: bestEnemy };
  }
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  let dist = 0.8;
  for (let step = 0.3; step <= fallbackDist; step += 0.3) {
    if (canOccupy(p.x + dirX * step, p.y + dirY * step, 0.25)) dist = step;
    else break;
  }
  return {
    tx: Math.max(1.5, Math.min(MAP_W - 1.5, p.x + dirX * dist)),
    ty: Math.max(1.5, Math.min(MAP_H - 1.5, p.y + dirY * dist)),
    target: null,
  };
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
    const isMage = p.heroClass === "mage";
    const isRanger = p.heroClass === "ranger";
    const hpGain = isMage ? 7 : isRanger ? 8 : 10;
    const mpGain = isMage ? 6 : isRanger ? 4 : 3;
    const atkGain = isMage ? (p.level % 4 === 0 ? 2 : 1) : (p.level % 3 === 0 ? 2 : 1);
    const defGain = isMage ? (p.level % 2 === 0 ? 1 : 0) : isRanger ? (p.level % 3 === 0 ? 0 : 1) : (p.level % 2 === 0 ? 2 : 1);
    const critGain = isRanger && p.level % 3 === 0 ? 1 : 0;
    p.maxHp += hpGain;
    p.maxMp += mpGain;
    p.baseAtk += atkGain;
    p.baseDef += defGain;
    p.baseCrit = (p.baseCrit || 0) + critGain;
    const stats = getPlayerStats();
    p.hp = stats.maxHp;
    p.mp = stats.maxMp;
    sfx.levelUp();
    addFloat(p.x, p.y, "LEVEL UP! +1 SKILL PT", "#facc15");
    spawnBurst(p.x, p.y, "#facc15", 20, 1.3);
    spawnRing(p.x, p.y, 48, "#facc15", 0.45);
    const critMsg = critGain ? `, +${critGain}% CRIT` : "";
    const defMsg = defGain ? `, +${defGain} DEF` : "";
    addLog(`Level ${p.level} reached! +1 Skill Point, +${hpGain} HP, +${mpGain} MP, +${atkGain} ATK${defMsg}${critMsg}.`, "loot");
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
  const finalHeal = Math.max(1, Math.round(amount * (s.isPvp ? 2.2 : 1)));
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
      sfx.shieldClang();
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
    if (options.isSkill) {
      if (p.heroClass === "mage") modDmg *= 0.78;
      else if (p.heroClass === "gilded") modDmg *= 1.12;
      else if (p.heroClass === "ranger") modDmg *= 1.05;
    }
    if ((p.pvpDmgTimer || 0) > 0) modDmg *= p.pvpDmgMult || 1.3;
    const outDmg = Math.max(4, Math.round(modDmg * 1.45));
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
      isSkill: Boolean(options.isSkill),
      isRanged: Boolean(options.isRanged || options.isAoe || p.heroClass !== "gilded"),
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

  if (enemy.isBoss && !options.isSkill) {
    modDmg *= 0.82;
  }

  const baseDef = (enemy.def || 0) + (enemy.bonusDef || 0);
  const sunderPenalty = (enemy.sunderTimer || 0) > 0 ? Math.max(3, Math.floor(baseDef * 0.35)) : 0;
  const effectiveDef = Math.max(0, baseDef - sunderPenalty);
  const flatBlock = Math.floor(effectiveDef * 0.32);
  const pctMult = 100 / (100 + effectiveDef * 2.5);
  const dmg = Math.max(1, Math.round(Math.max(1, modDmg - flatBlock) * pctMult));
  enemy.hp -= dmg;
  enemy.hurtTimer = 0.16;
  enemy.kbX += knockX;
  enemy.kbY += knockY;
  s.shake = Math.max(s.shake, isCrit ? 5 : 2.5);
  if (isCrit) {
    s.hitstop = Math.max(s.hitstop, 0.03);
    sfx.critHit();
  }

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
        const drop = Math.random() < 0.8
          ? rollEquipmentByFloor(s.floor, "elite")
          : Math.random() < 0.55 ? ITEMS.health_potion : ITEMS.mana_potion;
        const rInfo = getRarityInfo(drop);
        spawnGroundItem(drop, enemy.x, enemy.y);
        addFloat(enemy.x, enemy.y - 0.35, `Elite Drop: ${drop.name}!`, rInfo.color);
        addLog(`Elite ${enemy.name} dropped [${rInfo.label}] ${drop.name}!`, "loot");
      } else {
        const mobRoll = Math.random();
        if (mobRoll < 0.08) {
          const drop = rollEquipmentByFloor(s.floor, "enemy");
          const rInfo = getRarityInfo(drop);
          spawnGroundItem(drop, enemy.x, enemy.y);
          addFloat(enemy.x, enemy.y - 0.35, `Dropped ${drop.name}`, rInfo.color);
          addLog(`${enemy.name} dropped [${rInfo.label}] ${drop.name}.`, "loot");
        } else if (mobRoll < 0.30) {
          const drop = Math.random() < 0.55 ? ITEMS.health_potion : Math.random() < 0.5 ? ITEMS.mana_potion : ITEMS.bread;
          spawnGroundItem(drop, enemy.x, enemy.y);
          addFloat(enemy.x, enemy.y - 0.35, `Dropped ${drop.name}`, "#fde047");
          addLog(`${enemy.name} dropped ${drop.name} on the ground.`, "loot");
        }
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

  const bossDrop = rollEquipmentByFloor(s.floor, "boss");
  if (bossDrop) {
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

  if (s.floor === 16 && !s.isEndless) {
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
  if (!s || s.runEnded || s.dyingTimer > 0 || (s.pvpIntroTimer || 0) > 0) return;
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
  const isResonanceShot = p.heroClass === "mage" && p.basicShotCount % 3 === 0;

  if (isRanged) {
    const isBow = weapon.weaponType === "bow" || weapon.projectileKind === "arrow" || weapon.projectileKind === "fire_arrow";
    p.anim = isBow && p.heroClass === "ranger" ? "bow" : "attack";
    p.animTimer = 0.22;
    p.attackCd = weapon.attackCd || 0.36;

    const isCrit = Math.random() * 100 < stats.crit;
    const critMult = s.isPvp ? 1.65 : 1.4;
    const procMult = s.isPvp ? 1.35 : 1.2;
    const bonusShotMult = (isKeenShot || isResonanceShot) ? procMult : 1;
    const baseDmg = Math.round(stats.atk * (isCrit ? critMult : 1) * bonusShotMult);
    const speed = (weapon.projSpeed || (isBow ? 13.0 : 12.0)) * ((isKeenShot || isResonanceShot) ? 1.18 : 1);
    const projKind = isResonanceShot
      ? "arcane_orb"
      : weapon.projectileKind || (isBow ? "arrow" : "magic_missile");
    const color = isKeenShot
      ? "#4ade80"
      : isResonanceShot
        ? "#c084fc"
        : weapon.projColor || (isBow ? "#fde047" : "#38bdf8");

    if (isBow) sfx.arrow();
    else sfx.magicOrb();

    if (isKeenShot) {
      addFloat(p.x, p.y - 0.5, "KEEN SHOT!", "#4ade80");
    } else if (isResonanceShot) {
      p.mp = Math.min(stats.maxMp, p.mp + 2);
      runtime.uiDirty = true;
      if (!s.isPvp) addFloat(p.x, p.y - 0.5, "RESONANCE +2 MP!", "#c084fc");
    }

    const pushShot = (shotAng, dmgVal, radScale = 1, pierce = false) => {
      s.projectiles.push({
        x: p.x + Math.cos(shotAng) * 0.42,
        y: p.y + Math.sin(shotAng) * 0.42,
        vx: Math.cos(shotAng) * speed,
        vy: Math.sin(shotAng) * speed,
        radius: (isBow ? 0.22 : isResonanceShot ? 0.32 : 0.26) * radScale,
        color,
        dmg: dmgVal,
        isCrit,
        isEnemy: false,
        isArrow: isBow,
        isMagicOrb: !isBow,
        projKind,
        pierce,
        hitIds: pierce ? new Set() : null,
        fireTrail: weapon.projectileKind === "fire_arrow",
        chill: weapon.chill || 0,
        life: 0.92,
        label: isKeenShot ? "Keen Quiver" : isResonanceShot ? "Arcane Resonance" : weapon.name,
      });
      if (s.isPvp) {
        broadcastPvpAction({
          kind: "projectile",
          x: p.x + Math.cos(shotAng) * 0.42,
          y: p.y + Math.sin(shotAng) * 0.42,
          vx: Math.cos(shotAng) * speed,
          vy: Math.sin(shotAng) * speed,
          radius: (isBow ? 0.22 : isResonanceShot ? 0.32 : 0.26) * radScale,
          color,
          isArrow: isBow,
          isMagicOrb: !isBow,
          projKind,
          pierce,
          life: 0.92,
        });
      }
    };

    pushShot(angle, baseDmg, (isKeenShot || isResonanceShot) ? 1.15 : 1, isKeenShot || isResonanceShot);

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
  p._slashFlip = !p._slashFlip;
  p._comboCount = ((p._comboCount || 0) + 1) % 3;
  const slashVariant = (weapon?.chill || isKeenShot || (p.heroClass === "gilded" && p._comboCount === 2)) ? "steel_cyan" : "gold";
  const slashColor = slashVariant === "steel_cyan" ? "#38bdf8" : (isKeenShot ? "#4ade80" : "#fde047");
  moveWithSlide(p, Math.cos(angle) * 0.18, Math.sin(angle) * 0.18, 0.28);

  s.slashes.push({
    x: p.x * TILE_SIZE,
    y: p.y * TILE_SIZE,
    angle,
    radius: 38,
    life: 0.21,
    maxLife: 0.21,
    variant: slashVariant,
    flipY: p._slashFlip,
    color: slashColor,
  });
  if (s.isPvp) broadcastPvpAction({ kind: "slash", x: p.x, y: p.y, angle, radius: 38, variant: slashVariant, flipY: p._slashFlip, color: slashColor, life: 0.21 });
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
        const dmg = Math.round(stats.atk * (isCrit ? (s.isPvp ? 1.65 : 1.4) : 1));
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
  if (!s || s.runEnded || s.dyingTimer > 0 || (s.pvpIntroTimer || 0) > 0) return;
  const p = s.player;
  if ((p.stunTimer || 0) > 0 || p.dashCd > 0 || p.dashTimer > 0) return;
  if (!s.isPvp) {
    const dashCost = getDashMpCost(p);
    if (p.mp < dashCost) {
      addLog(`Not enough MP to Dash! (${dashCost} MP required)`, "info");
      return;
    }
    p.mp -= dashCost;
  }
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
  p.dashCd = s.isPvp ? 6.0 : getDashCooldown(p);
  p.iFrames = Math.max(p.iFrames, 0.24);
  p.facingLeft = dx < 0;
  sfx.dash();

  const stats = getPlayerStats();
  const subType = p.equipment?.subweapon?.subType || null;
  p.shieldDashHitIds = null;
  p.gildedDashHitIds = null;

  if (subType === "book") {
    const startX = p.x;
    const startY = p.y;
    spawnVfxAnim(startX, startY, "vfx_blink_dash", 84, 0.48, { angle: Math.atan2(dy, dx) });
    spawnBurst(startX, startY, "#a855f7", 10, 0.95);
    const blinkDist = 3.2;
    let bx = p.x;
    let by = p.y;
    for (let step = 0.2; step <= blinkDist; step += 0.2) {
      const nx = p.x + dx * step;
      const ny = p.y + dy * step;
      if (canOccupy(nx, ny, 0.28)) {
        bx = nx;
        by = ny;
      } else {
        break;
      }
    }
    p.x = bx;
    p.y = by;
    p.dashTimer = 0.04;
    spawnVfxAnim(bx, by, "vfx_arcane_burst", 96, 0.45);
    spawnRing(bx, by, 60, "#38bdf8", 0.3);
    if (s.isPvp) {
      broadcastPvpAction({ kind: "vfx", x: startX, y: startY, sheetKey: "vfx_blink_dash", sizePx: 84, duration: 0.48, angle: Math.atan2(dy, dx) });
      broadcastPvpAction({ kind: "vfx", x: bx, y: by, sheetKey: "vfx_arcane_burst", sizePx: 96, duration: 0.45 });
    }
    const dmg = Math.max(2, Math.round(stats.atk * 0.75));
    for (const e of [...s.level.enemies]) {
      const ex = e.x - bx;
      const ey = e.y - by;
      const dist = Math.hypot(ex, ey);
      if (dist <= 1.95) {
        const nx = dist > 0.01 ? ex / dist : dx;
        const ny = dist > 0.01 ? ey / dist : dy;
        damageEnemy(e, dmg, false, "Blink Step", nx * 4.2, ny * 4.2, { isAoe: true });
      }
    }
  } else if (subType === "shield") {
    p.shieldDashHitIds = new Set();
    p.dashTimer = 0.18;
    p.iFrames = Math.max(p.iFrames, 0.28);
    spawnBurst(p.x, p.y, "#38bdf8", 12, 1.05);
    spawnRing(p.x, p.y, 44, "#facc15", 0.26);
    if (s.isPvp) broadcastPvpAction({ kind: "ring", x: p.x, y: p.y, radPx: 44, color: "#facc15", dur: 0.26 });
  } else if (subType === "arrows") {
    spawnBurst(p.x, p.y, "#4ade80", 12, 0.95);
    const aimAng = getAimAngle();
    sfx.arrow();
    const arrowDmg = Math.max(2, Math.round(stats.atk * 0.65));
    for (const offset of [-0.24, 0, 0.24]) {
      const ang = aimAng + offset;
      const vx = Math.cos(ang) * 13.5;
      const vy = Math.sin(ang) * 13.5;
      s.projectiles.push({
        x: p.x,
        y: p.y,
        vx,
        vy,
        radius: 0.24,
        color: "#4ade80",
        dmg: arrowDmg,
        isEnemy: false,
        isArrow: true,
        bouncesLeft: 3,
        rehitCd: 0,
        lastHitUid: null,
        life: 1.85,
        maxLife: 1.85,
        label: "Ricochet Arrow",
      });
      if (s.isPvp) {
        broadcastPvpAction({
          kind: "projectile",
          x: p.x,
          y: p.y,
          vx,
          vy,
          radius: 0.24,
          color: "#4ade80",
          isArrow: true,
          bouncesLeft: 3,
          life: 1.85,
        });
      }
    }
  } else if (p.heroClass === "gilded") {
    p.gildedDashHitIds = new Set();
    spawnBurst(p.x, p.y, "#facc15", 10, 0.95);
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
  if (!s || s.runEnded || s.dyingTimer > 0 || (s.pvpIntroTimer || 0) > 0) return;
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

  const mpCost = s.isPvp
    ? 0
    : stats.setPassives.has("astral_efficiency")
      ? Math.max(1, Math.round(spell.mpCost * 0.75))
      : spell.mpCost;
  if (mpCost > 0 && p.mp < mpCost) {
    addLog("Not enough MP!", "info");
    return;
  }

  const rIdx = Math.min(rank - 1, spell.cooldowns.length - 1);
  if (mpCost > 0) p.mp -= mpCost;
  s.spellCooldowns[spell.id] = spell.cooldowns[rIdx];
  if (p.heroClass === "mage") {
    p.basicShotCount = (p.basicShotCount || 0) + 1;
    if (p.basicShotCount % 3 === 0) {
      p.mp = Math.min(stats.maxMp, p.mp + 2);
      if (!s.isPvp) addFloat(p.x, p.y - 0.55, "RESONANCE +2 MP!", "#c084fc");
    }
  }
  runtime.uiDirty = true;
  addFloat(p.x, p.y - 0.65, spell.name.toUpperCase(), spell.color || "#fde047", "skill");

  const angle = getAimAngle();
  p.aimAngle = angle;
  p.facingLeft = Math.cos(angle) < 0;

  if (spell.type === "arcane_beam") {
    sfx.smite();
    p.anim = "attack";
    p.animTimer = 0.24;
    const maxRange = spell.range || 6.5;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    let endDist = maxRange;
    for (let d = 0.25; d <= maxRange; d += 0.25) {
      const tx = Math.floor(p.x + dirX * d);
      const ty = Math.floor(p.y + dirY * d);
      if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H || s.level.grid[ty][tx] === TILE.WALL) {
        endDist = Math.max(1.0, d - 0.1);
        break;
      }
    }
    const endX = p.x + dirX * endDist;
    const endY = p.y + dirY * endDist;
    const beamPx = Math.max(96, Math.round(endDist * TILE_SIZE));
    spawnVfxAnim(p.x + dirX * 0.35, p.y + dirY * 0.35, "vfx_arcane_beam", beamPx, 0.45, { angle, anchorX: 0, anchorY: 0.5 });
    spawnBurst(endX, endY, "#38bdf8", 14, 1.1);
    if (s.isPvp) broadcastPvpAction({ kind: "vfx", x: p.x + dirX * 0.35, y: p.y + dirY * 0.35, sheetKey: "vfx_arcane_beam", sizePx: beamPx, duration: 0.45, angle, anchorX: 0, anchorY: 0.5 });
    s.shake = Math.max(s.shake, 4.5);

    const dmg = Math.round(stats.atk * spell.mults[rIdx]) + spell.flats[rIdx];
    for (const e of [...s.level.enemies]) {
      if (distPointToSegment(e.x, e.y, p.x, p.y, endX, endY) <= 0.72) {
        damageEnemy(e, dmg, false, spell.name, dirX * 3.0, dirY * 3.0, { isSkill: true, pierce: true, canInterrupt: true });
        spawnBurst(e.x, e.y, "#c084fc", 10, 0.9);
      }
    }
    return;
  }

  if (spell.type === "chain_lightning") {
    sfx.nova();
    p.anim = "attack";
    p.animTimer = 0.22;
    const maxBounces = spell.bounces?.[rIdx] || 3;
    const dmg = Math.round(stats.atk * spell.mults[rIdx]) + spell.flats[rIdx];
    const hitUids = new Set();
    let curX = p.x;
    let curY = p.y;
    let hitCount = 0;

    for (let b = 0; b < maxBounces; b++) {
      let best = null;
      let bestDist = b === 0 ? (spell.range || 7.5) : 3.8;
      for (const e of s.level.enemies) {
        if (hitUids.has(e.uid) || e.hp <= 0) continue;
        if (e.isBoss && !s.bossFightStarted) continue;
        if (b === 0 && !s.level.visible[Math.floor(e.y)]?.[Math.floor(e.x)]) continue;
        const d = Math.hypot(e.x - curX, e.y - curY);
        if (d <= bestDist) {
          bestDist = d;
          best = e;
        }
      }
      if (!best) break;
      hitUids.add(best.uid);
      hitCount += 1;
      const dx = best.x - curX;
      const dy = best.y - curY;
      const segAngle = Math.atan2(dy, dx);
      const segPx = Math.max(76, Math.round(Math.hypot(dx, dy) * TILE_SIZE * 1.15));
      spawnVfxAnim(curX, curY, "vfx_chain_lightning", segPx, 0.42, { angle: segAngle, anchorX: 0, anchorY: 0.5 });
      if (s.isPvp) broadcastPvpAction({ kind: "vfx", x: curX, y: curY, sheetKey: "vfx_chain_lightning", sizePx: segPx, duration: 0.42, angle: segAngle, anchorX: 0, anchorY: 0.5 });
      spawnBurst(best.x, best.y, "#7dd3fc", 10, 1.0);
      damageEnemy(best, dmg, false, spell.name, 0, 0, { isSkill: true, isAoe: true, canInterrupt: true });
      curX = best.x;
      curY = best.y;
    }
    if (hitCount === 0) {
      const tx = p.x + Math.cos(angle) * 4.0;
      const ty = p.y + Math.sin(angle) * 4.0;
      spawnVfxAnim(p.x, p.y, "vfx_chain_lightning", 128, 0.38, { angle, anchorX: 0, anchorY: 0.5 });
      if (s.isPvp) broadcastPvpAction({ kind: "vfx", x: p.x, y: p.y, sheetKey: "vfx_chain_lightning", sizePx: 128, duration: 0.38, angle, anchorX: 0, anchorY: 0.5 });
      spawnBurst(tx, ty, "#7dd3fc", 8, 0.8);
      addLog(`${spell.name} fizzled with no nearby targets.`, "info");
    }
    return;
  }

  if (spell.type === "mana_shield") {
    sfx.heal();
    const bonus = s.isPvp ? Math.max(4, Math.round(spell.defBonuses[rIdx] * 0.5)) : spell.defBonuses[rIdx];
    const gained = healPlayer(spell.heals[rIdx]);
    p.tempDef = bonus;
    p.tempDefTimer = spell.duration;
    p.manaShieldTimer = spell.duration;
    spawnVfxAnim(p.x, p.y, "vfx_mana_shield", 84, 0.72);
    if (s.isPvp) broadcastPvpAction({ kind: "vfx", x: p.x, y: p.y, sheetKey: "vfx_mana_shield", sizePx: 84, duration: 0.72 });
    spawnRing(p.x, p.y, 40, "#818cf8", 0.38);
    addFloat(p.x, p.y - 0.4, `SHIELD +${bonus} DEF · +${gained} HP`, "#818cf8");
    addLog(`${spell.name}: Arcane Barrier active (+${bonus} DEF, +${gained} HP for ${spell.duration}s).`, "heal");
    return;
  }

  if (spell.type === "meteor_strike") {
    sfx.magicOrb();
    p.anim = "attack";
    p.animTimer = 0.32;
    const dirX = Math.cos(angle);
    const maxRange = spell.range || 6.2;
    const { tx, ty } = findVisibleTargetPos(p, angle, maxRange, 3.8);
    const rad = spell.radii[rIdx];
    const dmg = Math.round(stats.atk * spell.mults[rIdx]) + spell.flats[rIdx];
    const stun = spell.stuns?.[rIdx] || 1.6;
    const facingRight = Math.abs(dirX) > 0.12 ? dirX > 0 : !p.facingLeft;
    const impactDelay = 0.26;
    const vfxSize = rad * TILE_SIZE * 2.15;

    spawnVfxAnim(tx, ty, "vfx_meteor_strike", vfxSize, 0.86, {
      flipX: facingRight,
      anchorX: 0.5,
      anchorY: 0.78,
    });
    spawnRing(tx, ty, rad * TILE_SIZE, "rgba(251, 146, 60, 0.8)", impactDelay);
    if (!Array.isArray(s.pendingMeteors)) s.pendingMeteors = [];
    s.pendingMeteors.push({
      x: tx,
      y: ty,
      rad,
      dmg,
      stun,
      name: spell.name,
      timer: impactDelay,
      maxTimer: impactDelay,
    });
    if (s.isPvp) {
      broadcastPvpAction({
        kind: "vfx",
        x: tx,
        y: ty,
        sheetKey: "vfx_meteor_strike",
        sizePx: vfxSize,
        duration: 0.86,
        flipX: facingRight,
        anchorX: 0.5,
        anchorY: 0.78,
      });
    }
    return;
  }

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
    if (s.isPvp) {
      broadcastPvpAction({ kind: "ring", x: p.x, y: p.y, radPx: radius * TILE_SIZE, color: spell.color, dur: 0.38 });
      broadcastPvpAction({ kind: "decal", x: p.x, y: p.y, sheetKey: "vfx_holy_ground_impact", sizePx: radius * TILE_SIZE * 2.05, duration: 0.55, opts: { scaleStart: 0.45, scaleEnd: 1.12, spin: 0.7 } });
    }

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
      projKind: "frost_orb",
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
        projKind: "frost_orb",
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

    const { tx: targetX, ty: targetY } = findVisibleTargetPos(p, angle, spell.range || 4.8, 2.5);

    spawnBurst(targetX, targetY, spell.color, 18, 1.2);
    spawnRing(targetX, targetY, 38, spell.color, 0.35);
    spawnVfxAnim(targetX, targetY, "vfx_divine_beam", 72, 0.58, { anchorX: 0.5, anchorY: 0.92 });
    spawnVfxAnim(targetX, targetY, "vfx_holy_nova", 112, 0.55);
    spawnGroundDecal(targetX, targetY, "vfx_holy_ground_impact", 84, 0.65, { scaleStart: 0.72, scaleEnd: 1.08, spin: 0.5 });
    s.beams.push({ x: targetX * TILE_SIZE, y: targetY * TILE_SIZE, color: spell.color, life: 0.36, maxLife: 0.36 });
    if (s.isPvp) {
      broadcastPvpAction({ kind: "beam", x: targetX, y: targetY, color: spell.color });
      broadcastPvpAction({ kind: "ring", x: targetX, y: targetY, radPx: 38, color: spell.color, dur: 0.35 });
      broadcastPvpAction({ kind: "decal", x: targetX, y: targetY, sheetKey: "vfx_holy_ground_impact", sizePx: 84, duration: 0.65, opts: { scaleStart: 0.72, scaleEnd: 1.08, spin: 0.5 } });
    }
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
    if (s.isPvp) broadcastPvpAction({ kind: "leap_start", x: p.x, y: p.y, duration: 1.25, radius: spell.radii[rIdx] });
    return;
  }

  if (spell.type === "aegis_bulwark") {
    const bonus = spell.defBonuses[rIdx];
    p.tempDef = bonus;
    p.tempDefTimer = spell.duration;
    p.aegisBlast = { timer: spell.duration, stun: spell.stuns[rIdx], radius: spell.radius, spell };
    sfx.shieldClang();
    spawnVfxAnim(p.x, p.y, "vfx_shield_bubble", 86, 0.72);
    spawnBurst(p.x, p.y, "#38bdf8", 14, 1.1);
    spawnRing(p.x, p.y, 32, "#facc15", 0.35);
    if (s.isPvp) broadcastPvpAction({ kind: "ring", x: p.x, y: p.y, radPx: 32, color: "#facc15", dur: 0.35 });
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
    if (s.isPvp) broadcastPvpAction({ kind: "radiant_charge", duration: 0.65, angle });
    return;
  }

  if (spell.type === "sovereign_grace") {
    const gained = healPlayer(spell.heals[rIdx]);
    p.hasteTimer = spell.duration;
    p.stunTimer = 0;
    sfx.heal();
    spawnVfxAnim(p.x, p.y, "vfx_holy_heal", 68, 0.75, { anchorX: 0.5, anchorY: 0.78 });
    spawnVfxAnim(p.x, p.y, "vfx_regen_aura", 58, 0.75, { anchorX: 0.5, anchorY: 0.82 });
    spawnBurst(p.x, p.y, "#34d399", 14, 1.0);
    if (s.isPvp) {
      broadcastPvpAction({ kind: "vfx_anim", x: p.x, y: p.y, sheetKey: "vfx_holy_heal", sizePx: 68, duration: 0.75, opts: { anchorX: 0.5, anchorY: 0.78 } });
      broadcastPvpAction({ kind: "vfx_anim", x: p.x, y: p.y, sheetKey: "vfx_regen_aura", sizePx: 58, duration: 0.75, opts: { anchorX: 0.5, anchorY: 0.82 } });
    }
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
    if (s.isPvp) {
      broadcastPvpAction({
        kind: "valiant_windup",
        windupDur: 0.62,
        dashDur: 0.38,
        startX: p.x,
        startY: p.y,
        targetX: endX,
        targetY: endY,
        travelDist,
        spearDistMax,
        dirX,
        dirY,
      });
    }
    return;
  }

  if (spell.type === "seal_retribution") {
    sfx.nova();
    p.retributionTimer = spell.duration;
    p.retributionReflect = spell.reflects[rIdx];
    p.retributionBurn = spell.burnDmg[rIdx];
    p.retributionTick = 0.2;
    p.retributionRadius = spell.radius;
    spawnVfxAnim(p.x, p.y, "vfx_shockwave_ring", spell.radius * TILE_SIZE * 1.9, 0.52);
    spawnBurst(p.x, p.y, "#ef4444", 18, 1.2);
    spawnRing(p.x, p.y, spell.radius * TILE_SIZE, "#ef4444", 0.4);
    if (s.isPvp) broadcastPvpAction({ kind: "ring", x: p.x, y: p.y, radPx: spell.radius * TILE_SIZE, color: "#ef4444", dur: 0.4 });
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
    spawnVfxAnim(p.x, p.y, "vfx_spin_slash", spell.range * TILE_SIZE * 1.9, 0.45);
    s.slashes.push({ x: p.x * TILE_SIZE, y: p.y * TILE_SIZE, angle, radius: 44, variant: "gold", color: spell.color, life: 0.24, maxLife: 0.24 });
    spawnGroundDecal(p.x, p.y, "vfx_damage_aoe_field", spell.range * TILE_SIZE * 1.45, 0.3, { scaleStart: 0.55, scaleEnd: 1.05, spin: 1.4 });
    if (s.isPvp) {
      broadcastPvpAction({ kind: "slash", x: p.x, y: p.y, angle, radius: 44, variant: "gold", color: spell.color, life: 0.24 });
      broadcastPvpAction({ kind: "decal", x: p.x, y: p.y, sheetKey: "vfx_damage_aoe_field", sizePx: spell.range * TILE_SIZE * 1.45, duration: 0.3, opts: { scaleStart: 0.55, scaleEnd: 1.05, spin: 1.4 } });
    }
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
    const chargeDur = s.isPvp ? 1.35 : spell.chargeTime;
    p.anim = "attack";
    p.animTimer = chargeDur;
    p.ultCharge = { timer: chargeDur, duration: chargeDur, rankIdx: rIdx, spell };
    addFloat(p.x, p.y - 0.5, "CHARGING...", "#fde047");
    addLog(`${spell.name}: Raising sword (${chargeDur.toFixed(1)}s charge)...`, "story");
    if (s.isPvp) broadcastPvpAction({ kind: "ult_charge", duration: chargeDur, radius: spell.radii[rIdx] });
    return;
  }

  if (spell.type === "arrow_volley") {
    sfx.windVolley();
    p.anim = p.heroClass === "ranger" ? "bow" : "attack";
    p.animTimer = 0.22;
    spawnVfxAnim(p.x + Math.cos(angle) * 0.45, p.y + Math.sin(angle) * 0.45, "vfx_air_burst", 76, 0.36, { angle });
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
    sfx.pierceShot();
    p.anim = p.heroClass === "ranger" ? "bow" : "attack";
    p.animTimer = 0.24;
    spawnVfxAnim(p.x + Math.cos(angle) * 0.55, p.y + Math.sin(angle) * 0.55, "vfx_wind_blade", 96, 0.38, { angle });
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
    spawnVfxAnim(p.x, p.y, "vfx_bloom_heal", 88, 0.72);
    spawnBurst(p.x, p.y, "#fb923c", 16, 1.2);
    spawnRing(p.x, p.y, 38, "#facc15", 0.35);
    spawnGroundDecal(p.x, p.y, "vfx_skyfall_reticle", 96, 0.45, { scaleStart: 0.5, scaleEnd: 1.15, spin: 1.1 });
    if (s.isPvp) {
      broadcastPvpAction({ kind: "ring", x: p.x, y: p.y, radPx: 38, color: "#facc15", dur: 0.35 });
      broadcastPvpAction({ kind: "decal", x: p.x, y: p.y, sheetKey: "vfx_skyfall_reticle", sizePx: 96, duration: 0.45, opts: { scaleStart: 0.5, scaleEnd: 1.15, spin: 1.1 } });
    }
    addFloat(p.x, p.y - 0.35, `+${gained} HP · +${atkBonus} ATK`, "#fde047");
    addLog(`${spell.name}: +${gained} HP and +${atkBonus} ATK for ${spell.duration}s!`, "heal");
    return;
  }

  if (spell.type === "ultimate_barrage") {
    sfx.pierceShot();
    sfx.windVolley();
    p.anim = p.heroClass === "ranger" ? "bow" : "attack";
    p.animTimer = 0.35;
    const { tx, ty } = findVisibleTargetPos(p, angle, 7.5, 2.8);
    const radius = spell.radii[rIdx];
    spawnVfxAnim(tx, ty, "vfx_shockwave_ring", radius * TILE_SIZE * 1.35, 0.38, { alpha: 0.65 });
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
    if (s.isPvp) broadcastPvpAction({ kind: "arrow_storm", x: tx, y: ty, radius, duration: dur, tickInterval: spell.tickInterval || 0.35 });
    addLog(`${spell.name}: Raining arrows for ${dur.toFixed(1)}s!`, "story");
    return;
  }

  if (spell.type === "void_rift") {
    const { tx, ty } = findVisibleTargetPos(p, angle, spell.range || 5.0, 3.8);
    const rad = spell.radius || 2.3;
    const dmg = Math.round(stats.atk * spell.mults[rIdx]) + (spell.flats?.[rIdx] || 0);
    const chillDur = spell.chills?.[rIdx] || 2.0;
    sfx.nova();
    sfx.gravityPull();
    s.shake = Math.max(s.shake, 5.5);
    spawnVfxAnim(tx, ty, "vfx_void_rift", rad * TILE_SIZE * 1.9, 0.9, { angle });
    spawnRing(tx, ty, rad * TILE_SIZE, "#c084fc", 0.45);
    spawnBurst(tx, ty, "#a855f7", 18, 1.3);
    if (!s.gravityWells) s.gravityWells = [];
    s.gravityWells.push({ x: tx, y: ty, radius: rad, timer: 0.42, pullSpeed: 3.4, detonate: false });
    if (s.isPvp) {
      broadcastPvpAction({ kind: "vfx_anim", x: tx, y: ty, sheetKey: "vfx_void_rift", sizePx: rad * TILE_SIZE * 1.9, duration: 0.9, angle });
      broadcastPvpAction({ kind: "ring", x: tx, y: ty, radPx: rad * TILE_SIZE, color: "#c084fc", dur: 0.45 });
      broadcastPvpAction({ kind: "gravity_well", x: tx, y: ty, radius: rad, duration: 0.42, pullSpeed: 3.4 });
    }
    for (const e of [...s.level.enemies]) {
      const d = Math.hypot(e.x - tx, e.y - ty);
      if (d <= rad + 0.5) {
        const pullAng = Math.atan2(ty - e.y, tx - e.x);
        const pullStep = Math.min(d * 0.55, 0.95);
        if (!e.isPvpPlayer && pullStep > 0.05) {
          moveWithSlide(e, Math.cos(pullAng) * pullStep, Math.sin(pullAng) * pullStep, 0.25);
        }
        e.chilled = Math.max(e.chilled || 0, chillDur);
        damageEnemy(e, dmg, false, spell.name, Math.cos(pullAng) * 2.2, Math.sin(pullAng) * 2.2, { isSkill: true, isAoe: true, freezeDur: chillDur * 0.5 });
      }
    }
    return;
  }

  if (spell.type === "tempest_field") {
    const dur = spell.duration || 3.6;
    const dmg = Math.round(stats.atk * spell.mults[rIdx]) + (spell.flats?.[rIdx] || 0);
    sfx.nova();
    p.hasteTimer = Math.max(p.hasteTimer || 0, 2.5);
    p.stormField = { timer: dur, tickInterval: spell.tickInterval || 0.6, tickTimer: 0, radius: spell.radius || 2.4, dmg, spell };
    spawnVfxAnim(p.x, p.y, "vfx_storm_field", (spell.radius || 2.4) * TILE_SIZE * 1.85, 0.8);
    if (s.isPvp) broadcastPvpAction({ kind: "vfx_anim", x: p.x, y: p.y, sheetKey: "vfx_storm_field", sizePx: (spell.radius || 2.4) * TILE_SIZE * 1.85, duration: 0.8 });
    return;
  }

  if (spell.type === "gravity_singularity") {
    const { tx, ty } = findVisibleTargetPos(p, angle, spell.range || 5.5, 4.2);
    const rad = spell.radii[rIdx];
    const maxDmg = Math.round(stats.atk * spell.mults[rIdx]) + (spell.flats?.[rIdx] || 0);
    const initialDmg = Math.max(2, Math.round(maxDmg * 0.25));
    const stunDur = spell.stuns?.[rIdx] || 1.8;
    const pullDuration = 2.0;
    const rootDur = 0.75;
    sfx.magicOrb();
    sfx.gravityPull();
    s.shake = Math.max(s.shake, 4.5);
    spawnVfxAnim(tx, ty, "vfx_gravity_well", rad * TILE_SIZE * 2.05, pullDuration);
    spawnRing(tx, ty, rad * TILE_SIZE, "#a855f7", 0.5);
    spawnBurst(tx, ty, "#c084fc", 16, 1.2);
    if (!s.gravityWells) s.gravityWells = [];
    s.gravityWells.push({
      x: tx,
      y: ty,
      radius: rad,
      timer: pullDuration,
      duration: pullDuration,
      pullSpeed: 2.35,
      pulseCd: 0.45,
      detonate: true,
      maxDmg,
      stunDur,
      spell,
    });
    if (s.isPvp) {
      broadcastPvpAction({ kind: "vfx_anim", x: tx, y: ty, sheetKey: "vfx_gravity_well", sizePx: rad * TILE_SIZE * 2.05, duration: pullDuration });
      broadcastPvpAction({ kind: "ring", x: tx, y: ty, radPx: rad * TILE_SIZE, color: "#a855f7", dur: 0.5 });
      broadcastPvpAction({ kind: "gravity_well", x: tx, y: ty, radius: rad, duration: pullDuration, pullSpeed: 2.35 });
    }
    for (const e of [...s.level.enemies]) {
      const d = Math.hypot(e.x - tx, e.y - ty);
      if (d <= rad + 0.65) {
        e.stunTimer = Math.max(e.stunTimer || 0, rootDur);
        damageEnemy(e, initialDmg, false, `${spell.name} Pull`, 0, 0, { isSkill: true, isAoe: true, stunDur: rootDur });
      }
    }
    addLog(`${spell.name}: Pulling enemies inward for 2.0s before collapse!`, "story");
    return;
  }

  if (spell.type === "thorn_salvo") {
    sfx.windVolley();
    p.anim = p.heroClass === "ranger" ? "bow" : "attack";
    p.animTimer = 0.22;
    const speed = 13.8;
    const dmg = Math.round(stats.atk * spell.mults[rIdx]);
    const chillDur = spell.chills?.[rIdx] || 1.8;
    for (const offset of [-0.34, -0.17, 0, 0.17, 0.34]) {
      const a = angle + offset;
      const sx = p.x + Math.cos(a) * 0.35;
      const sy = p.y + Math.sin(a) * 0.35;
      s.projectiles.push({
        x: sx, y: sy, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        radius: 0.22, color: spell.color, dmg, chill: chillDur,
        isEnemy: false, isArrow: true, projKind: "thorn_shot", isSkill: true, life: 0.62, label: spell.name,
      });
      if (s.isPvp) {
        broadcastPvpAction({ kind: "projectile", x: sx, y: sy, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, radius: 0.22, color: spell.color, isArrow: true, projKind: "thorn_shot", life: 0.62 });
      }
    }
    return;
  }

  if (spell.type === "vine_snare") {
    const { tx, ty } = findVisibleTargetPos(p, angle, spell.range || 4.5, 3.6);
    const rad = spell.radius || 2.2;
    const dmg = Math.round(stats.atk * spell.mults[rIdx]);
    const stunDur = spell.stuns?.[rIdx] || 1.6;
    sfx.hit();
    spawnVfxAnim(tx, ty, "vfx_vine_snare", rad * TILE_SIZE * 1.9, 0.95);
    spawnRing(tx, ty, rad * TILE_SIZE, "#22c55e", 0.42);
    spawnBurst(tx, ty, "#4ade80", 16, 1.2);
    if (s.isPvp) {
      broadcastPvpAction({ kind: "vfx_anim", x: tx, y: ty, sheetKey: "vfx_vine_snare", sizePx: rad * TILE_SIZE * 1.9, duration: 0.95 });
      broadcastPvpAction({ kind: "ring", x: tx, y: ty, radPx: rad * TILE_SIZE, color: "#22c55e", dur: 0.42 });
    }
    for (const e of [...s.level.enemies]) {
      if (Math.hypot(e.x - tx, e.y - ty) <= rad + 0.35) {
        e.stunTimer = Math.max(e.stunTimer || 0, stunDur);
        damageEnemy(e, dmg, false, spell.name, 0, 0, { isSkill: true, isAoe: true, stunDur });
      }
    }
    addFloat(tx, ty - 0.4, "SNARED!", "#4ade80");
    return;
  }

  if (spell.type === "leaf_tempest") {
    const dur = spell.duration || 2.6;
    const rad = spell.radii[rIdx];
    const dmg = Math.round(stats.atk * spell.mults[rIdx]) + (spell.flats?.[rIdx] || 0);
    sfx.windVolley();
    p.hasteTimer = Math.max(p.hasteTimer || 0, dur);
    p.hasteBonus = Math.max(p.hasteBonus || 0.7, 1.25);
    p.leafTempest = { timer: dur, tickInterval: spell.tickInterval || 0.35, tickTimer: 0, radius: rad, dmg, spell };
    spawnVfxAnim(p.x, p.y, "vfx_leaf_storm", rad * TILE_SIZE * 1.9, 0.7);
    if (s.isPvp) broadcastPvpAction({ kind: "vfx_anim", x: p.x, y: p.y, sheetKey: "vfx_leaf_storm", sizePx: rad * TILE_SIZE * 1.9, duration: 0.7 });
    addLog(`${spell.name}: Summoned a whirling emerald tempest!`, "story");
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
  if (s.isPvp) broadcastPvpAction({ kind: "clear_charges" });
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
    spawnBurst(p.x, p.y, "#f87171", 20, 1.2);
    if (s.isPvp) {
      notifyLocalPvpDefeat();
    } else {
      s.dyingTimer = 0.9;
    }
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
  const clsName = HERO_CLASSES[s.player.heroClass === "paladin" ? "gilded" : s.player.heroClass]?.name || "Gilded Knight";
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
  const sanctumBtn = document.getElementById("btn-end-sanctum");
  if (sanctumBtn) {
    sanctumBtn.textContent = "Return to Oakhaven Sanctum";
  }

  if (combatHooks.updateUI) combatHooks.updateUI();
  dlg.showModal();
}

combatHooks.endRun = endRun;
