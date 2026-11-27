import { bgm, sfx } from "./audio.js";
import { castSpell, combatHooks, upgradeSkillById } from "./combat.js";
import { CLASS_DEFAULT_LOADOUTS, DEFAULT_LOADOUT, HERO_CLASSES, RELICS, SPELLS } from "./data.js";
import { pvpHooks } from "./pvp.js";
import { renderHooks } from "./renderer.js";
import {
  getActiveSetBonuses,
  getActiveSpells,
  getMaxInventory,
  getPlayerStats,
  getRarityInfo,
  getWeaponCategory,
  isBetterEquipmentItem,
  loadSavedRun,
  runtime,
} from "./state.js";
import { worldHooks } from "./world.js";

export const uiHooks = {
  useShortcut: null,
  openItemActionDialog: null,
};

export function buildSpellButtons() {
  const activeSpells = getActiveSpells(runtime.state?.player);
  const spellBar = document.getElementById("spell-bar");
  spellBar.innerHTML = "";
  for (const sp of activeSpells) {
    const wrap = document.createElement("div");
    wrap.className = `spell-slot-wrap${sp.isUltimate ? " ult" : ""}`;
    wrap.dataset.spellId = sp.id;

    const mainRow = document.createElement("div");
    mainRow.className = "spell-slot-main";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "spell-btn";
    btn.dataset.spellId = sp.id;
    btn.title = `${sp.desc} (Hotkey: ${sp.hotkey})`;
    const isPvpMode = Boolean(runtime.state?.isPvp);
    btn.innerHTML = `
      <div class="spell-cd-overlay" style="transform: scaleY(0)"></div>
      <img src="${sp.icon}" alt="" />
      <div class="spell-meta">
        <strong>[${sp.hotkey}] ${sp.name}</strong>
        <span>${isPvpMode ? "Free (PvP)" : `${sp.mpCost} MP`}</span>
      </div>
    `;
    btn.addEventListener("click", () => castSpell(sp.id));

    const plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.className = "spell-plus-btn";
    plusBtn.textContent = "+";
    plusBtn.title = "Unlock / Upgrade Skill (1 Skill Pt)";
    plusBtn.hidden = true;
    plusBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      upgradeSkillById(sp.id);
    });

    mainRow.appendChild(btn);
    mainRow.appendChild(plusBtn);

    const pipsEl = document.createElement("div");
    pipsEl.className = "spell-pips";
    pipsEl.setAttribute("aria-label", `${sp.name} level indicator`);
    for (let r = 0; r < sp.maxRank; r++) {
      const pip = document.createElement("span");
      pip.className = "spell-pip";
      pipsEl.appendChild(pip);
    }

    wrap.appendChild(mainRow);
    wrap.appendChild(pipsEl);
    spellBar.appendChild(wrap);
  }

  activeSpells.forEach((sp, idx) => {
    const tBtn = document.getElementById(`touch-skill-${idx + 1}`);
    if (!tBtn) return;
    tBtn.dataset.spellId = sp.id;
    const pipsHtml = Array.from({ length: sp.maxRank }, () => `<span class="ts-pip"></span>`).join("");
    tBtn.innerHTML = `<span class="ts-plus" hidden>+</span><img src="${sp.icon}" alt="${sp.name}" /><span class="ts-cd" hidden></span><div class="ts-pips">${pipsHtml}</div>`;
    const plusEl = tBtn.querySelector(".ts-plus");
    if (plusEl) {
      plusEl.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        upgradeSkillById(sp.id);
      });
    }
  });
}

export function updateCooldownUI() {
  const s = runtime.state;
  if (!s) return;
  const p = s.player;
  const isPvp = Boolean(s.isPvp);
  const stats = getPlayerStats();
  const mpDiscount = stats.setPassives.has("astral_efficiency") ? 0.75 : 1.0;

  for (const wrap of document.querySelectorAll(".spell-slot-wrap")) {
    const btn = wrap.querySelector(".spell-btn");
    const sp = SPELLS.find((x) => x.id === wrap.dataset.spellId);
    if (!sp || !btn) continue;
    const rank = p.skillRanks[sp.id] || 0;
    const locked = rank <= 0;
    const maxed = rank >= sp.maxRank;
    const reqHeroLv = !maxed && sp.reqLevels ? sp.reqLevels[rank] : null;
    const canUpgrade = !maxed && (p.skillPoints || 0) > 0 && (reqHeroLv === null || p.level >= reqHeroLv);
    const cd = s.spellCooldowns[sp.id] || 0;
    const maxCd = locked ? 1 : sp.cooldowns[Math.min(rank - 1, sp.cooldowns.length - 1)];
    const ratio = locked ? 0 : Math.min(1, cd / maxCd);
    const overlay = btn.querySelector(".spell-cd-overlay");
    if (overlay) overlay.style.transform = `scaleY(${ratio})`;
    const costLabel = btn.querySelector(".spell-meta span");
    const effectiveCost = isPvp ? 0 : Math.max(1, Math.round(sp.mpCost * mpDiscount));
    const outOfMana = !isPvp && !locked && p.mp < effectiveCost;
    if (costLabel) {
      costLabel.textContent = locked
        ? canUpgrade
          ? "Ready to Unlock"
          : reqHeroLv !== null && p.level < reqHeroLv
            ? `Locked (Lv ${reqHeroLv})`
            : "Locked (Lv Up)"
        : outOfMana && cd <= 0
          ? "Out of Mana"
          : isPvp
            ? `Lv${rank}/${sp.maxRank} · Free`
            : `Lv${rank}/${sp.maxRank} · ${effectiveCost} MP`;
    }
    btn.classList.toggle("locked", locked);
    btn.classList.toggle("out-of-mana", outOfMana && cd <= 0);
    btn.disabled = locked || outOfMana || cd > 0 || Boolean(p.leap || p.ultCharge) || s.runEnded || s.dyingTimer > 0;

    const plusBtn = wrap.querySelector(".spell-plus-btn");
    if (plusBtn) {
      plusBtn.hidden = !canUpgrade;
      if (canUpgrade) {
        plusBtn.title = rank === 0 ? `Unlock ${sp.name} (1 Skill Pt)` : `Level up ${sp.name} to Lv ${rank + 1} (1 Skill Pt)`;
      }
    }

    const pipsEl = wrap.querySelector(".spell-pips");
    if (pipsEl) {
      pipsEl.title = `${sp.name}: Lv ${rank} / ${sp.maxRank}`;
      pipsEl.querySelectorAll(".spell-pip").forEach((pip, idx) => pip.classList.toggle("filled", idx < rank));
    }
  }

  for (const tBtn of document.querySelectorAll(".touch-skill-btn")) {
    const sp = SPELLS.find((x) => x.id === tBtn.dataset.spellId);
    if (!sp) continue;
    const rank = p.skillRanks[sp.id] || 0;
    const locked = rank <= 0;
    const cd = s.spellCooldowns[sp.id] || 0;
    const effectiveCost = isPvp ? 0 : Math.max(1, Math.round(sp.mpCost * mpDiscount));
    const outOfMana = !isPvp && !locked && p.mp < effectiveCost;
    const maxed = rank >= sp.maxRank;
    const reqHeroLv = !maxed && sp.reqLevels ? sp.reqLevels[rank] : null;
    const canUpgrade = !maxed && (p.skillPoints || 0) > 0 && (reqHeroLv === null || p.level >= reqHeroLv);

    tBtn.classList.toggle("locked", locked);
    tBtn.classList.toggle("on-cooldown", !locked && cd > 0);
    tBtn.classList.toggle("out-of-mana", outOfMana && cd <= 0);
    tBtn.disabled = locked || outOfMana || cd > 0 || Boolean(p.leap || p.ultCharge) || s.runEnded || s.dyingTimer > 0;
    const cdEl = tBtn.querySelector(".ts-cd");
    if (cdEl) {
      if (!locked && cd > 0) {
        cdEl.hidden = false;
        cdEl.classList.remove("oom");
        cdEl.textContent = String(Math.ceil(cd));
      } else if (outOfMana) {
        cdEl.hidden = false;
        cdEl.classList.add("oom");
        cdEl.textContent = "OUT OF MANA";
      } else {
        cdEl.hidden = true;
        cdEl.classList.remove("oom");
      }
    }
    const plusEl = tBtn.querySelector(".ts-plus");
    if (plusEl) plusEl.hidden = !canUpgrade;
    tBtn.querySelectorAll(".ts-pip").forEach((pip, idx) => pip.classList.toggle("filled", idx < rank));
  }

  const subType = p.equipment?.subweapon?.subType;
  const dashBaseLabel =
    subType === "shield"
      ? "Shield Dash"
      : subType === "arrows"
        ? "3x Arrow Dash"
        : subType === "book"
          ? "Blink Dash"
          : "Dash";
  const dashOutOfMana = !isPvp && p.mp < 10;
  const dashBtn = document.getElementById("btn-dash");
  if (dashBtn) {
    dashBtn.disabled = p.dashCd > 0 || dashOutOfMana;
    dashBtn.classList.toggle("on-cooldown", p.dashCd > 0 || dashOutOfMana);
    dashBtn.textContent = p.dashCd > 0
      ? `${dashBaseLabel} (${p.dashCd.toFixed(1)}s)`
      : isPvp
        ? `${dashBaseLabel} (6s CD)`
        : `${dashBaseLabel} (10 MP)`;
    dashBtn.title = "Dash skill adapts to Sub-Weapon: Shield = Shield Bash · Arrows = 3 Ricochet Arrows · Tome/Book = Blink Teleport";
  }
  const tDash = document.getElementById("touch-btn-dash");
  const tDashCd = document.getElementById("touch-dash-cd");
  if (tDash && tDashCd) {
    tDash.disabled = p.dashCd > 0 || dashOutOfMana;
    tDash.classList.toggle("on-cooldown", p.dashCd > 0 || dashOutOfMana);
    if (p.dashCd > 0) {
      tDashCd.hidden = false;
      tDashCd.textContent = String(Math.ceil(p.dashCd));
    } else {
      tDashCd.hidden = true;
    }
  }
  const skillBtn = document.getElementById("btn-skills");
  const ptsEl = document.getElementById("skill-points-count");
  const mSkillBtn = document.getElementById("mhud-btn-skills");
  const mPtsEl = document.getElementById("mhud-skill-pts");
  const pts = p.skillPoints || 0;
  if (skillBtn && ptsEl) {
    ptsEl.textContent = pts;
    skillBtn.classList.toggle("has-points", pts > 0);
  }
  if (mSkillBtn && mPtsEl) {
    mPtsEl.textContent = pts;
    mSkillBtn.classList.toggle("has-points", pts > 0);
  }

  const promptBtn = document.getElementById("btn-interact-prompt");
  if (promptBtn) {
    const ni = runtime.nearbyInteractable;
    const modalOpen = Boolean(document.querySelector("dialog[open]"));
    if (ni && !s.runEnded && !modalOpen) {
      const mobile = window.matchMedia?.("(max-width: 960px), (pointer: coarse)")?.matches;
      const nextText = mobile ? `Tap: ${ni.label}` : `${ni.label} [F]`;
      if (promptBtn.hidden) promptBtn.hidden = false;
      if (promptBtn.textContent !== nextText) promptBtn.textContent = nextText;
      promptBtn.style.borderColor = ni.color || "#facc15";
    } else if (!promptBtn.hidden) {
      promptBtn.hidden = true;
    }
  }
}

export function renderShortcuts() {
  const s = runtime.state;
  if (!s) return;
  const p = s.player;
  const slots = p.shortcuts || [null, null, null, null];
  for (const containerId of ["mobile-shortcuts", "drawer-shortcuts"]) {
    const container = document.getElementById(containerId);
    if (!container) continue;
    container.innerHTML = "";
    for (let idx = 0; idx < 4; idx++) {
      const itemId = slots[idx];
      const item = itemId ? p.inventory.find((i) => i.id === itemId) : null;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "shortcut-slot";
      btn.title = item ? `${item.name} (Shortcut ${idx + 1})` : `Empty Shortcut ${idx + 1}`;
      if (item) {
        btn.innerHTML = `<img src="${item.icon}" alt="${item.name}" />${item.qty > 1 ? `<span class="inv-qty">${item.qty}</span>` : ""}`;
      } else {
        btn.textContent = String(idx + 1);
      }
      btn.addEventListener("click", () => {
        if (uiHooks.useShortcut) uiHooks.useShortcut(idx);
      });
      container.appendChild(btn);
    }
  }
}

export function updateUI() {
  const s = runtime.state;
  if (!s) return;
  runtime.uiDirty = false;
  const p = s.player;
  const stats = getPlayerStats();
  p.hp = Math.min(p.hp, stats.maxHp);
  p.mp = Math.min(p.mp, stats.maxMp);

  const cls = HERO_CLASSES[p.heroClass === "paladin" ? "gilded" : p.heroClass] || HERO_CLASSES.gilded;
  document.getElementById("hero-name").textContent = p.name || "Sir Aldric";
  const classEl = document.querySelector(".hero-class");
  if (classEl) {
    classEl.innerHTML = `${cls.name} &middot; Lv <span id="stat-level">${p.level}</span>`;
    classEl.title = `${cls.passiveName}: ${cls.passiveDesc} | ${cls.dashName}: ${cls.dashDesc}`;
  }
  document.getElementById("act-subtitle").textContent = `Floor ${s.floor} — ${s.level.act.name}`;
  document.getElementById("mhud-name").textContent = p.name || "Sir Aldric";
  document.getElementById("mhud-level").textContent = p.level;
  document.getElementById("mhud-hp").textContent = `${Math.ceil(p.hp)}/${stats.maxHp}`;
  document.getElementById("mhud-mp").textContent = `${Math.floor(p.mp)}/${stats.maxMp}`;
  document.getElementById("mhud-xp").textContent = `${p.xp}/${p.xpNext}`;
  document.getElementById("mhud-bar-hp").style.width = `${(p.hp / stats.maxHp) * 100}%`;
  document.getElementById("mhud-bar-mp").style.width = `${(p.mp / stats.maxMp) * 100}%`;
  document.getElementById("mhud-bar-xp").style.width = `${(p.xp / p.xpNext) * 100}%`;
  document.getElementById("soul-shards-count").textContent = runtime.meta.soulShards;
  document.getElementById("stat-hp").textContent = `${Math.ceil(p.hp)} / ${stats.maxHp}`;
  document.getElementById("stat-mp").textContent = `${Math.floor(p.mp)} / ${stats.maxMp}`;
  document.getElementById("stat-xp").textContent = `${p.xp} / ${p.xpNext}`;
  document.getElementById("bar-hp").style.width = `${(p.hp / stats.maxHp) * 100}%`;
  document.getElementById("bar-mp").style.width = `${(p.mp / stats.maxMp) * 100}%`;
  document.getElementById("bar-xp").style.width = `${(p.xp / p.xpNext) * 100}%`;

  document.getElementById("stat-atk").textContent = stats.atk;
  document.getElementById("stat-def").textContent = stats.def;
  document.getElementById("stat-crit").textContent = `${stats.crit}%`;
  document.getElementById("stat-gold").textContent = p.gold;

  const count = s.shardsCollected.filter(Boolean).length;
  document.getElementById("shards-collected").textContent = count;
  [1, 2, 3].forEach((n, i) => {
    document.getElementById(`crown-shard-${n}`).classList.toggle("collected", s.shardsCollected[i]);
  });

  // Sync Mobile Attack Wheel knob icon with currently equipped weapon (sword / wand / arrow)
  const atkWheel = document.getElementById("touch-atk-wheel");
  if (atkWheel) {
    const wCat = getWeaponCategory(p.equipment?.weapon);
    const knobKind = wCat === "bow" ? "arrow" : wCat === "wand" ? "wand" : "sword";
    atkWheel.dataset.weaponKind = knobKind;
  }

  // Relics panel
  const relicsCountEl = document.getElementById("relics-count");
  const relicsListEl = document.getElementById("relics-list");
  if (relicsCountEl && relicsListEl) {
    const owned = p.relics || [];
    relicsCountEl.textContent = owned.length;
    relicsListEl.innerHTML = "";
    if (owned.length === 0) {
      relicsListEl.innerHTML = `<span class="hint-text">Find Relics at Shrines &amp; Trial Chests</span>`;
    } else {
      for (const rId of owned) {
        const rel = RELICS[rId];
        if (!rel) continue;
        const badge = document.createElement("div");
        badge.className = "relic-pill";
        badge.style.borderColor = rel.color;
        badge.title = rel.desc;
        badge.innerHTML = `<strong style="color:${rel.color}">${rel.name}</strong><span>${rel.desc}</span>`;
        relicsListEl.appendChild(badge);
      }
    }
  }

  const eqEl = document.getElementById("equipment-slots");
  eqEl.innerHTML = "";
  const slotOrder = ["weapon", "subweapon", "armor", "helmet", "boots", "ring"];
  for (const slot of slotOrder) {
    const item = p.equipment?.[slot] || null;
    const row = document.createElement("div");
    row.className = "equip-slot";
    const slotLabel = slot === "subweapon" ? "Sub-Weapon" : slot;
    row.innerHTML = `<span class="slot-name">${slotLabel}</span>`;
    if (item) {
      const rInfo = getRarityInfo(item);
      row.style.borderLeft = `3px solid ${rInfo.color}`;
      row.innerHTML += `<img src="${item.icon}" class="pixel-icon" alt="" /><span style="color:${rInfo.color}">${item.name}</span>`;
      row.title = `[${rInfo.label}] ${item.desc}`;
    } else {
      row.innerHTML += `<span style="color:var(--muted)">Empty</span>`;
    }
    eqEl.appendChild(row);
  }

  const setData = getActiveSetBonuses(p);
  const activeSets = setData.activeLabels;
  if (activeSets.length > 0) {
    const setSummary = document.createElement("div");
    setSummary.className = "equip-set-bonuses";
    for (const st of activeSets) {
      const tag = document.createElement("div");
      tag.className = "equip-set-tag";
      tag.style.borderColor = st.color;
      tag.innerHTML = `<strong style="color:${st.color}">${st.name} (${st.count})</strong><span>${st.label}</span>`;
      setSummary.appendChild(tag);
    }
    eqEl.appendChild(setSummary);
  }

  const hpCount = p.inventory.find((i) => i.id === "health_potion")?.qty || 0;
  const mpCount = p.inventory.find((i) => i.id === "mana_potion")?.qty || 0;
  document.getElementById("quick-hp-count").textContent = hpCount;
  document.getElementById("quick-mp-count").textContent = mpCount;

  const maxInv = getMaxInventory(p);
  const totalItems = p.inventory.reduce((sum, it) => sum + (it?.qty || 1), 0);
  const invTotalEl = document.getElementById("inv-total");
  if (invTotalEl) invTotalEl.textContent = totalItems;
  document.getElementById("inv-count").textContent = p.inventory.length;
  const invMaxEl = document.getElementById("inv-max");
  if (invMaxEl) invMaxEl.textContent = maxInv;
  const mobBagCountEl = document.getElementById("mobile-bag-count");
  if (mobBagCountEl) mobBagCountEl.textContent = totalItems;

  let upgradeCount = 0;
  const invGrid = document.getElementById("inventory-grid");
  invGrid.innerHTML = "";
  for (let i = 0; i < maxInv; i++) {
    const item = p.inventory[i];
    const btn = document.createElement("button");
    btn.type = "button";
    const isUpgrade = item ? isBetterEquipmentItem(item, p) : false;
    if (isUpgrade) upgradeCount += 1;
    btn.className = `inv-slot ${item ? "" : "empty"}${isUpgrade ? " upgrade-ready" : ""}`;
    if (item) {
      const rInfo = getRarityInfo(item);
      if (!isUpgrade) btn.style.borderColor = rInfo.color;
      btn.style.background = rInfo.bg;
      btn.title = `[${rInfo.label}] ${item.name} — ${item.desc}${isUpgrade ? " [BETTER GEAR AVAILABLE!]" : ""}`;
      btn.innerHTML = `<span class="inv-rarity-dot" style="background:${rInfo.color}"></span>${isUpgrade ? `<span class="inv-upgrade-badge" title="Better than equipped">▲</span>` : ""}<img src="${item.icon}" alt="${item.name}" />${item.qty > 1 ? `<span class="inv-qty">${item.qty}</span>` : ""}`;
      btn.addEventListener("click", () => {
        if (uiHooks.openItemActionDialog) uiHooks.openItemActionDialog(i);
      });
    } else {
      btn.disabled = true;
    }
    invGrid.appendChild(btn);
  }

  const invUpgradePill = document.getElementById("inv-upgrade-pill");
  if (invUpgradePill) {
    invUpgradePill.hidden = upgradeCount === 0;
    invUpgradePill.textContent = upgradeCount > 1 ? `▲ ${upgradeCount} Upgrades` : "▲ Better Gear";
  }
  const mobBagBtn = document.getElementById("btn-mobile-bag");
  const mobBagUpgrade = document.getElementById("mobile-bag-upgrade");
  if (mobBagBtn) mobBagBtn.classList.toggle("has-upgrade", upgradeCount > 0);
  if (mobBagUpgrade) {
    mobBagUpgrade.hidden = upgradeCount === 0;
    mobBagUpgrade.textContent = upgradeCount > 1 ? `▲ ${upgradeCount}` : "▲ Gear";
  }

  renderShortcuts();
}

export function updateRoomAndBossHUD() {
  const s = runtime.state;
  if (!s) return;

  const sfHud = document.getElementById("pvp-sf-hud");
  if (s.isPvp) {
    document.body.classList.add("pvp-active");
    const opp = s.pvpOpponent;
    const p = s.player;
    const stats = getPlayerStats(p);
    const mySc = s.pvpScores?.[s.pvpMySlot] || 0;
    const oppSc = s.pvpScores?.[s.pvpMySlot === 0 ? 1 : 0] || 0;

    const badge = document.getElementById("room-enemy-badge");
    if (badge) badge.hidden = true;
    const bossBar = document.getElementById("boss-hud-bar");
    if (bossBar) bossBar.hidden = true;
    const mMenuBtn = document.getElementById("mhud-btn-menu");
    if (mMenuBtn && mMenuBtn.textContent !== "Lobby") mMenuBtn.textContent = "Lobby";
    const dMenuBtn = document.getElementById("btn-menu");
    if (dMenuBtn && dMenuBtn.textContent !== "Lobby") dMenuBtn.textContent = "Lobby";

    if (sfHud) {
      sfHud.hidden = false;
      const myCls = HERO_CLASSES[p.heroClass === "paladin" ? "gilded" : p.heroClass] || HERO_CLASSES.gilded;
      const oppCls = HERO_CLASSES[opp?.heroClass === "paladin" ? "gilded" : opp?.heroClass] || HERO_CLASSES.gilded;

      const p1Name = document.getElementById("pvp-hud-p1-name");
      const p1Cls = document.getElementById("pvp-hud-p1-class");
      const p1Fill = document.getElementById("pvp-hud-p1-hp-fill");
      const p1Text = document.getElementById("pvp-hud-p1-hp-text");
      const p1Wins = document.getElementById("pvp-hud-p1-wins");
      const p1Skills = document.getElementById("pvp-hud-p1-skills");

      if (p1Name) p1Name.textContent = p.name || myCls.name;
      if (p1Cls) p1Cls.textContent = myCls.name;
      const myHpVal = Math.max(0, Math.ceil(p.hp));
      const myMaxHp = Math.max(1, stats.maxHp);
      const myPct = Math.max(0, Math.min(100, (p.hp / myMaxHp) * 100));
      if (p1Fill) {
        p1Fill.style.width = `${myPct}%`;
        p1Fill.classList.toggle("danger", myPct <= 25);
      }
      if (p1Text) p1Text.textContent = `${myHpVal}`;
      if (p1Wins) {
        const pips = p1Wins.querySelectorAll(".pvp-win-pip");
        pips.forEach((pip, idx) => pip.classList.toggle("won", idx < mySc));
        const cnt = p1Wins.querySelector(".pvp-win-count");
        if (cnt) cnt.textContent = `${mySc}W`;
      }

      const p2Name = document.getElementById("pvp-hud-p2-name");
      const p2Cls = document.getElementById("pvp-hud-p2-class");
      const p2Fill = document.getElementById("pvp-hud-p2-hp-fill");
      const p2Text = document.getElementById("pvp-hud-p2-hp-text");
      const p2Wins = document.getElementById("pvp-hud-p2-wins");
      const p2Skills = document.getElementById("pvp-hud-p2-skills");

      if (p2Name) p2Name.textContent = opp?.name || oppCls.name;
      if (p2Cls) p2Cls.textContent = oppCls.name;
      const oppHpVal = Math.max(0, Math.ceil(opp?.hp ?? 0));
      const oppMaxHp = Math.max(1, opp?.maxHp || 5000);
      const oppPct = Math.max(0, Math.min(100, ((opp?.hp ?? 0) / oppMaxHp) * 100));
      if (p2Fill) {
        p2Fill.style.width = `${oppPct}%`;
        p2Fill.classList.toggle("danger", oppPct <= 25);
      }
      if (p2Text) p2Text.textContent = `${oppHpVal}`;
      if (p2Wins) {
        const pips = p2Wins.querySelectorAll(".pvp-win-pip");
        pips.forEach((pip, idx) => pip.classList.toggle("won", idx < oppSc));
        const cnt = p2Wins.querySelector(".pvp-win-count");
        if (cnt) cnt.textContent = `${oppSc}W`;
      }

      const roundEl = document.getElementById("pvp-hud-round");
      const timerEl = document.getElementById("pvp-hud-timer");
      const remSec = Math.max(0, Math.ceil(s.pvpRoundTimer ?? 99));
      if (roundEl) roundEl.textContent = `RND ${s.pvpRound || 1}`;
      if (timerEl) {
        timerEl.textContent = String(remSec).padStart(2, "0");
        timerEl.classList.toggle("low", remSec <= 15);
      }

      const mySpells = getActiveSpells(p);
      const p1Sig = mySpells.map((sp) => sp.id).join(",");
      if (p1Skills && sfHud.dataset.p1Sig !== p1Sig) {
        sfHud.dataset.p1Sig = p1Sig;
        p1Skills.innerHTML = mySpells
          .map(
            (sp) =>
              `<div class="pvp-sf-skill${sp.isUltimate ? " ult" : ""}" data-spell-id="${sp.id}" title="${sp.name}"><img src="${sp.icon}" alt="${sp.name}" /><span class="pvp-sf-skill-cd" hidden></span></div>`
          )
          .join("");
      }
      if (p1Skills) {
        for (const el of p1Skills.querySelectorAll(".pvp-sf-skill")) {
          const cd = s.spellCooldowns?.[el.dataset.spellId] || 0;
          const cdBadge = el.querySelector(".pvp-sf-skill-cd");
          el.classList.toggle("on-cd", cd > 0);
          if (cdBadge) {
            cdBadge.hidden = cd <= 0;
            if (cd > 0) cdBadge.textContent = String(Math.ceil(cd));
          }
        }
      }

      const oppIds = Array.isArray(s.pvpOppInfo?.loadout) && s.pvpOppInfo.loadout.length >= 4
        ? s.pvpOppInfo.loadout
        : (CLASS_DEFAULT_LOADOUTS[oppCls.id] || DEFAULT_LOADOUT);
      const p2Sig = oppIds.join(",");
      if (p2Skills && sfHud.dataset.p2Sig !== p2Sig) {
        sfHud.dataset.p2Sig = p2Sig;
        p2Skills.innerHTML = oppIds
          .map((id) => SPELLS.find((sp) => sp.id === id))
          .filter(Boolean)
          .map(
            (sp) =>
              `<div class="pvp-sf-skill${sp.isUltimate ? " ult" : ""}" title="${sp.name}"><img src="${sp.icon}" alt="${sp.name}" /></div>`
          )
          .join("");
      }
    }
    bgm.play("boss");
    return;
  }

  document.body.classList.remove("pvp-active");
  if (sfHud) sfHud.hidden = true;
  const badgeRestore = document.getElementById("room-enemy-badge");
  if (badgeRestore) badgeRestore.hidden = false;
  const mMenuBtn = document.getElementById("mhud-btn-menu");
  if (mMenuBtn && mMenuBtn.textContent !== "Menu") mMenuBtn.textContent = "Menu";
  const dMenuBtn = document.getElementById("btn-menu");
  if (dMenuBtn && dMenuBtn.textContent !== "Menu") dMenuBtn.textContent = "Menu";

  const nonBossLeft = s.level.enemies.filter((e) => !e.isBoss && !e.isClone).length;
  const boss = s.level.enemies.find((e) => e.isBoss);

  const badge = document.getElementById("room-enemy-badge");
  if (badge) {
    if (s.level.isBossFloor) {
      if (boss && s.bossFightStarted) {
        badge.textContent = "BOSS FIGHT!";
        badge.className = "room-enemy-badge has-enemies";
      } else if (nonBossLeft > 0) {
        badge.textContent = `Boss Floor · Enemies Left: ${nonBossLeft}`;
        badge.className = "room-enemy-badge has-enemies";
      } else if (!s.hasBossKey) {
        badge.textContent = "Boss Floor · Pick Up Boss Key!";
        badge.className = "room-enemy-badge has-enemies";
      } else {
        badge.textContent = "Boss Floor · Enter Boss Room!";
        badge.className = "room-enemy-badge clear";
      }
    } else if (nonBossLeft > 0) {
      badge.textContent = `Floor Enemies Left: ${nonBossLeft}`;
      badge.className = "room-enemy-badge has-enemies";
    } else {
      badge.textContent = "Floor Clear!";
      badge.className = "room-enemy-badge clear";
    }
  }

  const bossBar = document.getElementById("boss-hud-bar");
  if (bossBar) {
    if (boss && s.bossFightStarted) {
      bossBar.hidden = false;
      document.getElementById("boss-hud-name").textContent = boss.enraged ? `${boss.name} (PHASE 2)` : boss.name;
      document.getElementById("boss-hud-hp-text").textContent = `${Math.max(0, Math.ceil(boss.hp))} / ${boss.maxHp}`;
      document.getElementById("boss-hud-fill").style.width = `${Math.max(0, (boss.hp / boss.maxHp) * 100)}%`;
    } else {
      bossBar.hidden = true;
    }
  }

  const menuOpen = !document.getElementById("main-menu").hidden || document.getElementById("title-dialog").open;
  if (menuOpen) bgm.play("town");
  else if (boss && s.bossFightStarted) bgm.play("boss");
  else if (nonBossLeft > 0) bgm.play("battle");
  else bgm.play("explore");
}

export const VOLUME_CYCLE = ["off", "low", "med", "high"];
export const VOLUME_LABELS = { off: "Off", low: "Low", med: "Med", high: "High" };

export function updatePerfHUD() {
  const hud = document.getElementById("perf-hud");
  if (!hud) return;
  const show = runtime.meta?.settings?.showPerf !== false;
  hud.hidden = !show;
  if (!show) return;

  const fpsEl = document.getElementById("perf-fps");
  const pingEl = document.getElementById("perf-ping");
  if (fpsEl) {
    const fps = runtime.perfFps ?? 60;
    fpsEl.textContent = `${fps} FPS`;
    fpsEl.className = fps >= 50 ? "perf-good" : fps >= 30 ? "perf-warn" : "perf-bad";
  }
  if (pingEl) {
    if (typeof runtime.netPingMs === "number") {
      const ms = Math.round(runtime.netPingMs);
      pingEl.textContent = `${ms} ms`;
      pingEl.className = ms <= 60 ? "perf-good" : ms <= 140 ? "perf-warn" : "perf-bad";
    } else if (window.location.protocol === "capacitor:" || window.location.protocol === "file:") {
      pingEl.textContent = navigator.onLine ? "Local" : "Offline";
      pingEl.className = navigator.onLine ? "perf-good" : "perf-warn";
    } else if (!navigator.onLine) {
      pingEl.textContent = "Offline";
      pingEl.className = "perf-warn";
    } else if (typeof runtime.httpPingMs === "number") {
      const ms = Math.round(runtime.httpPingMs);
      pingEl.textContent = `${ms} ms`;
      pingEl.className = ms <= 60 ? "perf-good" : ms <= 140 ? "perf-warn" : "perf-bad";
    } else {
      pingEl.textContent = "-- ms";
      pingEl.className = "";
    }
  }
}

export function syncSettingsUI() {
  const m = runtime.meta;
  if (!m.settings) m.settings = { sfxLevel: "high", musicLevel: "low", screenShake: true, showPerf: true };
  if (!m.settings.sfxLevel) m.settings.sfxLevel = m.settings.sfx === false ? "off" : "high";
  if (!m.settings.musicLevel) m.settings.musicLevel = "low";

  sfx.setLevel(m.settings.sfxLevel);
  bgm.setLevel(m.settings.musicLevel);

  const muteBtn = document.getElementById("btn-mute");
  if (muteBtn) {
    muteBtn.setAttribute("aria-pressed", String(sfx.muted));
    muteBtn.textContent = sfx.muted ? "SFX: Off" : "SFX: On";
  }
  const musicSettingBtn = document.getElementById("setting-music-btn");
  if (musicSettingBtn) musicSettingBtn.textContent = VOLUME_LABELS[m.settings.musicLevel] || "Low";
  const sfxSettingBtn = document.getElementById("setting-sfx-btn");
  if (sfxSettingBtn) sfxSettingBtn.textContent = VOLUME_LABELS[m.settings.sfxLevel] || "High";
  const shakeSettingBtn = document.getElementById("setting-shake-btn");
  if (shakeSettingBtn) shakeSettingBtn.textContent = m.settings.screenShake !== false ? "On" : "Off";
  const perfSettingBtn = document.getElementById("setting-perf-btn");
  if (perfSettingBtn) perfSettingBtn.textContent = m.settings.showPerf !== false ? "On" : "Off";
  updatePerfHUD();
}

export function showMainMenu() {
  document.body.classList.remove("pvp-active");
  bgm.play("town");
  const menu = document.getElementById("main-menu");
  const resumeBtn = document.getElementById("menu-btn-resume");
  const saved = loadSavedRun();
  const hasRealProgress = saved && (saved.floor > 1 || saved.kills > 0 || (saved.elapsed || 0) > 1);
  if (hasRealProgress) {
    resumeBtn.hidden = false;
    resumeBtn.disabled = false;
    resumeBtn.textContent = `Resume (Floor ${saved.floor} — ${saved.player?.name || "Sir Aldric"})`;
  } else {
    resumeBtn.hidden = true;
    resumeBtn.disabled = true;
  }
  const checkUpdBtn = document.getElementById("menu-btn-check-update");
  if (checkUpdBtn) {
    const isNativeApk = Boolean(window.Capacitor || window.AndroidApp);
    const isMobile = isNativeApk || window.innerWidth <= 960 || window.matchMedia?.("(pointer: coarse)")?.matches;
    const isOnline = navigator.onLine && (!window.AndroidApp?.isOnline || window.AndroidApp.isOnline());
    checkUpdBtn.hidden = !(isMobile && isOnline);
  }
  menu.hidden = false;
}

export function hideMainMenu() {
  document.getElementById("main-menu").hidden = true;
  document.body.classList.toggle("pvp-active", Boolean(runtime.state?.isPvp));
  runtime.lastFrameTime = performance.now();
}

// Wire hooks
combatHooks.updateUI = updateUI;
combatHooks.buildSpellButtons = buildSpellButtons;
worldHooks.updateUI = updateUI;
worldHooks.buildSpellButtons = buildSpellButtons;
worldHooks.updateRoomAndBossHUD = updateRoomAndBossHUD;
renderHooks.updateCooldownUI = updateCooldownUI;
renderHooks.updateUI = updateUI;
renderHooks.updatePerfHUD = updatePerfHUD;
pvpHooks.buildSpellButtons = buildSpellButtons;
pvpHooks.updateUI = updateUI;
pvpHooks.updateRoomAndBossHUD = updateRoomAndBossHUD;
pvpHooks.hideMainMenu = hideMainMenu;
pvpHooks.showMainMenu = showMainMenu;
