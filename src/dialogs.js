import { sfx } from "./audio.js";
import { drawSheetFrame } from "./assets.js";
import { combatHooks, grantXP, healPlayer, unlockCodex, upgradeSkillById } from "./combat.js";
import {
  CLASS_DEFAULT_LOADOUTS,
  DEFAULT_LOADOUT,
  ENEMIES,
  GAME_VERSION,
  HERO_CLASSES,
  ITEMS,
  LORE_CODEX,
  META_UPGRADES,
  NPC_ENCOUNTERS,
  PATCH_NOTES,
  RARITIES,
  SHRINE_ENCOUNTERS,
  SOUL_FORGE_UPGRADES,
  SPELLS,
  getItemPrice,
} from "./data.js";
import { TILE } from "./dungeon.js";
import {
  addFloat,
  addItemToInventory,
  addLog,
  dropInventoryItem,
  getActiveSetBonuses,
  getActiveSpells,
  getMaxInventory,
  getPlayerStats,
  getRarityInfo,
  getRequiredClassForItem,
  giveOrDropItem,
  grantRandomRelic,
  isItemAllowedForClass,
  isWeaponSubPairValid,
  keys,
  runtime,
  saveMeta,
  saveRun,
  spawnBurst,
  spawnGroundItem,
  spawnRing,
  storyPortraitCtx,
  touchMove,
} from "./state.js";
import { buildSpellButtons, uiHooks, updateCooldownUI, updateUI } from "./ui.js";
import { descendFloor, worldHooks } from "./world.js";

function escapeHtml(val) {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function useInventoryItem(index) {
  const s = runtime.state;
  if (!s || s.runEnded || s.dyingTimer > 0) return;
  const inv = s.player.inventory;
  const item = inv[index];
  if (!item) return;

  const p = s.player;
  const stats = getPlayerStats();

  if (item.type === "consumable") {
    if (item.healHp) {
      const gained = healPlayer(item.healHp);
      sfx.heal();
      addFloat(p.x, p.y, `+${gained} HP`, "#4ade80");
      spawnBurst(p.x, p.y, "#4ade80", 10);
      addLog(`Used ${item.name} (+${gained} HP).`, "heal");
    }
    if (item.healMp) {
      p.mp = Math.min(stats.maxMp, p.mp + item.healMp);
      sfx.spell();
      addFloat(p.x, p.y, `+${item.healMp} MP`, "#60a5fa");
      spawnBurst(p.x, p.y, "#60a5fa", 10);
      addLog(`Used ${item.name} (+${item.healMp} MP).`, "heal");
    }
    if (item.buffAtk) {
      p.baseAtk += item.buffAtk;
      sfx.levelUp();
      addFloat(p.x, p.y, `+${item.buffAtk} ATK`, "#fde047");
      spawnBurst(p.x, p.y, "#fde047", 14);
      addLog(`Read ${item.name}: permanently gained +${item.buffAtk} ATK!`, "loot");
    }
    item.qty -= 1;
    if (item.qty <= 0) inv.splice(index, 1);
    runtime.uiDirty = true;
  } else if (item.slot) {
    if (!isItemAllowedForClass(item, p.heroClass)) {
      const reqCls = HERO_CLASSES[getRequiredClassForItem(item)]?.name || "another class";
      sfx.hit();
      addFloat(p.x, p.y - 0.35, "Class Not Match!", "#f87171");
      addLog(`Cannot equip ${item.name}: Class Not Match (Requires ${reqCls}).`, "info");
      return;
    }
    const prev = p.equipment[item.slot];
    p.equipment[item.slot] = item;
    inv.splice(index, 1);
    if (prev) inv.push(prev);

    let unpaired = null;
    if (item.slot === "weapon" && p.equipment.subweapon && !isWeaponSubPairValid(item, p.equipment.subweapon)) {
      unpaired = p.equipment.subweapon;
      p.equipment.subweapon = null;
    } else if (item.slot === "subweapon" && p.equipment.weapon && !isWeaponSubPairValid(p.equipment.weapon, item)) {
      unpaired = p.equipment.weapon;
      p.equipment.weapon = null;
    }

    sfx.loot();
    addLog(`Equipped ${item.name}.`, "loot");
    if (unpaired) {
      if (addItemToInventory(unpaired, 1, { silentFull: true })) {
        addLog(`Returned ${unpaired.name} to your satchel (does not pair with ${item.name}).`, "info");
      } else {
        spawnGroundItem(unpaired, p.x, p.y, { requireLeave: true });
        addLog(`Satchel full! ${unpaired.name} placed on ground.`, "info");
      }
    }
    runtime.uiDirty = true;
    saveRun();
  }
}

export function quickPotion(id) {
  if (!runtime.state) return;
  const idx = runtime.state.player.inventory.findIndex((i) => i.id === id);
  if (idx >= 0) useInventoryItem(idx);
  else addLog("None left in your satchel!", "info");
}

export function useShortcut(slotIdx) {
  const s = runtime.state;
  if (!s || s.runEnded || s.dyingTimer > 0) return;
  const itemId = s.player.shortcuts?.[slotIdx];
  if (!itemId) {
    addLog(`Shortcut ${slotIdx + 1} is empty. Open Bag and tap an item to assign it.`, "info");
    return;
  }
  const idx = s.player.inventory.findIndex((i) => i.id === itemId);
  if (idx >= 0) useInventoryItem(idx);
  else addLog("None left in your satchel!", "info");
}

export function openItemActionDialog(index) {
  const s = runtime.state;
  if (!s || s.runEnded) return;
  const p = s.player;
  const item = p.inventory[index];
  if (!item) return;

  const dlg = document.getElementById("item-action-dialog");
  const rInfo = getRarityInfo(item);
  document.getElementById("item-action-icon").src = item.icon;
  const titleEl = document.getElementById("item-action-title");
  titleEl.textContent = item.qty > 1 ? `${item.name} (x${item.qty})` : item.name;
  titleEl.style.color = rInfo.color;
  document.getElementById("item-action-desc").innerHTML = `<span class="rarity-badge" style="color:${rInfo.color};border-color:${rInfo.color};background:${rInfo.bg}">${rInfo.label}</span> ${item.desc}`;

  const compareEl = document.getElementById("item-action-compare");
  if (compareEl) {
    if (item.slot) {
      const p = s.player;
      const equipped = p.equipment?.[item.slot] || null;
      const eqRarity = equipped ? getRarityInfo(equipped) : null;
      const slotLabel = item.slot === "subweapon" ? "Sub-Weapon" : item.slot;

      const nextEquipment = { ...p.equipment, [item.slot]: item };
      let unpairedOther = null;
      if (item.slot === "weapon" && nextEquipment.subweapon && !isWeaponSubPairValid(item, nextEquipment.subweapon)) {
        unpairedOther = nextEquipment.subweapon;
        nextEquipment.subweapon = null;
      } else if (item.slot === "subweapon" && nextEquipment.weapon && !isWeaponSubPairValid(nextEquipment.weapon, item)) {
        unpairedOther = nextEquipment.weapon;
        nextEquipment.weapon = null;
      }

      const curStats = getPlayerStats(p);
      const nextPlayer = { ...p, equipment: nextEquipment };
      const nextStats = getPlayerStats(nextPlayer);
      const curSets = getActiveSetBonuses(p).totals;
      const nextSets = getActiveSetBonuses(nextPlayer).totals;

      const statDefs = [
        { key: "atk", label: "ATK", suffix: "", netKey: "atk" },
        { key: "def", label: "DEF", suffix: "", netKey: "def" },
        { key: "crit", label: "CRIT", suffix: "%", netKey: "crit" },
        { key: "maxHp", label: "Max HP", suffix: "", netKey: "maxHp" },
        { key: "maxMp", label: "Max MP", suffix: "", netKey: "maxMp" },
      ];

      let rowsHtml = "";
      for (const sd of statDefs) {
        const oldItemVal = equipped?.[sd.key] || 0;
        const newItemVal = item?.[sd.key] || 0;
        const netDiff = nextStats[sd.netKey] - curStats[sd.netKey];
        if (oldItemVal === 0 && newItemVal === 0 && netDiff === 0) continue;
        const cls = netDiff > 0 ? "up" : netDiff < 0 ? "down" : "same";
        const deltaText = netDiff > 0 ? `▲ +${netDiff}${sd.suffix}` : netDiff < 0 ? `▼ ${netDiff}${sd.suffix}` : `— 0${sd.suffix}`;
        rowsHtml += `
          <div class="cmp-row">
            <span class="cmp-stat-name">${sd.label}</span>
            <span class="cmp-vals">${oldItemVal}${sd.suffix} → ${newItemVal}${sd.suffix}</span>
            <span class="cmp-delta ${cls}">${deltaText}</span>
          </div>
        `;
      }

      const setDeltaParts = [];
      for (const [k, lbl, sfxTxt] of [["atk", "ATK", ""], ["def", "DEF", ""], ["crit", "CRIT", "%"], ["maxHp", "Max HP", ""], ["maxMp", "Max MP", ""]]) {
        const d = (nextSets[k] || 0) - (curSets[k] || 0);
        if (d !== 0) {
          const c = d > 0 ? "#4ade80" : "#f87171";
          const arrow = d > 0 ? "▲ +" : "▼ ";
          setDeltaParts.push(`<span style="color:${c};font-weight:700">${arrow}${d} ${lbl}${sfxTxt}</span>`);
        }
      }

      compareEl.innerHTML = `
        <div class="item-compare-head">
          <div class="item-compare-side">
            <span class="cmp-label">Equipped (${slotLabel})</span>
            <div class="cmp-item">${equipped ? `<img src="${equipped.icon}" class="pixel-icon" alt="" /><span style="color:${eqRarity.color}">${equipped.name}</span>` : `<span style="color:var(--muted)">Empty Slot</span>`}</div>
          </div>
          <span class="item-compare-arrow">→</span>
          <div class="item-compare-side" style="border-color:${rInfo.color}">
            <span class="cmp-label">To Equip</span>
            <div class="cmp-item"><img src="${item.icon}" class="pixel-icon" alt="" /><span style="color:${rInfo.color}">${item.name}</span></div>
          </div>
        </div>
        <div class="item-compare-rows">${rowsHtml || `<div class="hint-text">Same stat values as equipped item.</div>`}</div>
        ${setDeltaParts.length > 0 ? `<div class="cmp-set-note">Set Bonus Change: ${setDeltaParts.join(" · ")}</div>` : ""}
        ${unpairedOther ? `<div class="cmp-pair-warn">Does not pair with <strong>${unpairedOther.name}</strong> — it will return to your satchel.</div>` : ""}
      `;
      compareEl.hidden = false;
    } else {
      compareEl.hidden = true;
      compareEl.innerHTML = "";
    }
  }

  const classAllowed = !item.slot || isItemAllowedForClass(item, p.heroClass);
  const reqClassName = !classAllowed ? (HERO_CLASSES[getRequiredClassForItem(item)]?.name || "Other Class") : null;

  const btnsEl = document.getElementById("item-action-buttons");
  btnsEl.innerHTML = "";

  if (!classAllowed && compareEl) {
    compareEl.hidden = false;
    compareEl.innerHTML += `<div class="cmp-pair-warn">Class Not Match — Requires <strong>${escapeHtml(reqClassName)}</strong></div>`;
  }

  const primaryBtn = document.createElement("button");
  primaryBtn.type = "button";
  primaryBtn.className = "btn btn-primary";
  primaryBtn.textContent = item.type === "consumable" ? "Consume / Use" : classAllowed ? "Equip" : "Class Not Match";
  primaryBtn.disabled = !classAllowed;
  primaryBtn.addEventListener("click", () => {
    useInventoryItem(index);
    dlg.close();
  });
  btnsEl.appendChild(primaryBtn);

  if (item.slot) {
    const dropBtn = document.createElement("button");
    dropBtn.type = "button";
    dropBtn.className = "btn btn-danger";
    dropBtn.textContent = "Discard to Ground";
    dropBtn.addEventListener("click", () => {
      dropInventoryItem(index, 1);
      sfx.step();
      dlg.close();
    });
    btnsEl.appendChild(dropBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn-secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => dlg.close());
    btnsEl.appendChild(cancelBtn);
  } else if (item.type === "consumable") {
    for (let sl = 0; sl < 4; sl++) {
      const sBtn = document.createElement("button");
      sBtn.type = "button";
      sBtn.className = "btn btn-secondary";
      const isAssigned = s.player.shortcuts?.[sl] === item.id;
      sBtn.textContent = isAssigned ? `Shortcut ${sl + 1} (Set)` : `Add to Shortcut ${sl + 1}`;
      sBtn.addEventListener("click", () => {
        if (!s.player.shortcuts) s.player.shortcuts = [null, null, null, null];
        s.player.shortcuts[sl] = item.id;
        sfx.loot();
        addLog(`Assigned ${item.name} to Shortcut ${sl + 1}.`, "info");
        runtime.uiDirty = true;
        saveRun();
        dlg.close();
      });
      btnsEl.appendChild(sBtn);
    }

    const qty = item.qty || 1;
    if (qty > 1) {
      const dropOneBtn = document.createElement("button");
      dropOneBtn.type = "button";
      dropOneBtn.className = "btn btn-danger";
      dropOneBtn.textContent = "Drop 1 to Ground";
      dropOneBtn.addEventListener("click", () => { dropInventoryItem(index, 1); sfx.step(); dlg.close(); });
      btnsEl.appendChild(dropOneBtn);

      const dropAllBtn = document.createElement("button");
      dropAllBtn.type = "button";
      dropAllBtn.className = "btn btn-danger";
      dropAllBtn.textContent = `Discard All (x${qty})`;
      dropAllBtn.addEventListener("click", () => { dropInventoryItem(index, qty); sfx.step(); dlg.close(); });
      btnsEl.appendChild(dropAllBtn);
    } else {
      const dropBtn = document.createElement("button");
      dropBtn.type = "button";
      dropBtn.className = "btn btn-danger btn-full";
      dropBtn.textContent = "Drop / Discard to Ground";
      dropBtn.addEventListener("click", () => { dropInventoryItem(index, 1); sfx.step(); dlg.close(); });
      btnsEl.appendChild(dropBtn);
    }
  }

  dlg.showModal();
}

export function openEquippedActionDialog(slot) {
  const s = runtime.state;
  if (!s || s.runEnded) return;
  const p = s.player;
  const item = p.equipment?.[slot];
  if (!item) return;

  const dlg = document.getElementById("item-action-dialog");
  const rInfo = getRarityInfo(item);
  document.getElementById("item-action-icon").src = item.icon;
  const titleEl = document.getElementById("item-action-title");
  titleEl.textContent = item.name;
  titleEl.style.color = rInfo.color;
  document.getElementById("item-action-desc").innerHTML = `<span class="rarity-badge" style="color:${rInfo.color};border-color:${rInfo.color};background:${rInfo.bg}">${rInfo.label}</span> ${item.desc}`;

  const compareEl = document.getElementById("item-action-compare");
  if (compareEl) {
    compareEl.hidden = true;
    compareEl.innerHTML = "";
  }

  const btnsEl = document.getElementById("item-action-buttons");
  btnsEl.innerHTML = "";

  const unequipBtn = document.createElement("button");
  unequipBtn.type = "button";
  unequipBtn.className = "btn btn-primary";
  unequipBtn.textContent = "Unequip to Bag";
  unequipBtn.addEventListener("click", () => {
    if (addItemToInventory(item)) {
      p.equipment[slot] = null;
      sfx.step();
      addLog(`Unequipped ${item.name}.`, "info");
      runtime.uiDirty = true;
      saveRun();
    } else {
      addFloat(p.x, p.y - 0.35, "Bag is full!", "#f87171");
      addLog("Cannot unequip: Satchel is full!", "info");
    }
    dlg.close();
  });
  btnsEl.appendChild(unequipBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn-danger";
  deleteBtn.textContent = "Delete Item";
  deleteBtn.addEventListener("click", () => {
    p.equipment[slot] = null;
    sfx.step();
    addLog(`Deleted equipped ${item.name}.`, "info");
    runtime.uiDirty = true;
    saveRun();
    dlg.close();
  });
  btnsEl.appendChild(deleteBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-secondary";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => dlg.close());
  btnsEl.appendChild(cancelBtn);

  dlg.showModal();
}

export function openSkillDialog() {
  const s = runtime.state;
  if (!s || s.runEnded) return;
  const p = s.player;
  const dlg = document.getElementById("skill-dialog");
  document.getElementById("modal-skill-points").textContent = p.skillPoints || 0;

  const list = document.getElementById("skill-upgrade-list");
  list.innerHTML = "";

  for (const sp of getActiveSpells(p)) {
    const rank = p.skillRanks[sp.id] || 0;
    const maxed = rank >= sp.maxRank;
    const reqHeroLv = !maxed && sp.reqLevels ? sp.reqLevels[rank] : null;
    const levelTooLow = reqHeroLv !== null && p.level < reqHeroLv;

    const card = document.createElement("div");
    card.className = `skill-upgrade-card ${sp.isUltimate ? "ult" : ""}`;
    card.innerHTML = `
      <div class="skill-upgrade-head">
        <img src="${sp.icon}" alt="" />
        <div>
          <strong>[${sp.hotkey}] ${sp.name} ${sp.isUltimate ? "(ULT)" : ""}</strong>
          <div style="font-size:0.75rem;color:var(--accent)">Rank ${rank} / ${sp.maxRank}</div>
        </div>
      </div>
      <p class="skill-upgrade-desc">${sp.desc}</p>
    `;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = rank === 0 ? "btn btn-primary" : "btn btn-secondary";
    if (maxed) btn.textContent = "Max Level";
    else if (levelTooLow) btn.textContent = `Requires Hero Lv ${reqHeroLv}`;
    else btn.textContent = rank === 0 ? "Unlock (1 Pt)" : `Upgrade to Lv ${rank + 1} (1 Pt)`;
    btn.disabled = maxed || levelTooLow || (p.skillPoints || 0) <= 0;
    btn.addEventListener("click", () => {
      if (!upgradeSkillById(sp.id)) return;
      if ((p.skillPoints || 0) <= 0) dlg.close("upgraded");
      else openSkillDialog();
    });
    card.appendChild(btn);
    list.appendChild(card);
  }

  if (!dlg.open) dlg.showModal();
}

export function openShopDialog(shop) {
  const s = runtime.state;
  if (!s || s.runEnded || !shop) return;
  const dlg = document.getElementById("shop-dialog");
  if (!dlg) return;

  const BASIC_SKILL_SWAP_COST = 1000;
  const ULT_SKILL_SWAP_COST = 2500;
  let swapState = null;

  const renderSkillSwapPanel = (locked) => {
    const panel = document.getElementById("shop-skill-swap-panel");
    const mainView = document.getElementById("shop-main-view");
    if (!panel || !mainView) return;

    if (!swapState || locked || shop.skillSold) {
      swapState = null;
      mainView.hidden = false;
      panel.hidden = true;
      panel.innerHTML = "";
      return;
    }

    mainView.hidden = true;
    panel.hidden = false;
    panel.innerHTML = "";

    const p = s.player;
    const activeSpells = getActiveSpells(p);

    if (swapState.step === 1) {
      const head = document.createElement("div");
      head.className = "skill-swap-step-head";
      head.innerHTML = `<div><strong>Step 1 of 2 — Select Skill to Swap Out</strong><div><span>Basic Skill: ${BASIC_SKILL_SWAP_COST}g · Ultimate Skill: ${ULT_SKILL_SWAP_COST}g</span></div></div>`;
      panel.appendChild(head);

      const grid = document.createElement("div");
      grid.className = "skill-swap-grid";
      activeSpells.forEach((sp, idx) => {
        const isUlt = Boolean(sp.isUltimate);
        const cost = isUlt ? ULT_SKILL_SWAP_COST : BASIC_SKILL_SWAP_COST;
        const rank = p.skillRanks[sp.id] || 0;
        const canAfford = p.gold >= cost;

        const card = document.createElement("button");
        card.type = "button";
        card.className = `skill-swap-card ${isUlt ? "ult" : ""}`;
        card.disabled = !canAfford;
        card.innerHTML = `<img src="${sp.icon}" alt="" /><div class="skill-swap-card-body"><strong>[${idx + 1}] ${sp.name}${isUlt ? " (ULT)" : ""}</strong><span class="skill-swap-meta">Rank ${rank}/${sp.maxRank} · ${canAfford ? `Swap for ${cost}g` : `Need ${cost}g`}</span><span class="skill-swap-desc">${sp.desc}</span></div>`;
        card.addEventListener("click", () => {
          if (!canAfford || locked || shop.skillSold) return;
          swapState = { step: 2, slotIdx: idx, candidateId: null };
          renderShopContents();
        });
        grid.appendChild(card);
      });
      panel.appendChild(grid);

      const actions = document.createElement("div");
      actions.className = "skill-swap-actions";
      const backBtn = document.createElement("button");
      backBtn.type = "button";
      backBtn.className = "btn btn-secondary";
      backBtn.textContent = "Back to Shop";
      backBtn.addEventListener("click", () => { swapState = null; renderShopContents(); });
      actions.appendChild(backBtn);
      panel.appendChild(actions);
      return;
    }

    const oldSpell = activeSpells[swapState.slotIdx];
    if (!oldSpell) { swapState = { step: 1, slotIdx: null, candidateId: null }; renderSkillSwapPanel(locked); return; }
    const isUlt = Boolean(oldSpell.isUltimate);
    const cost = isUlt ? ULT_SKILL_SWAP_COST : BASIC_SKILL_SWAP_COST;
    const oldRank = p.skillRanks[oldSpell.id] || 0;
    const targetSlot = swapState.slotIdx + 1;
    const heroCls = p.heroClass === "paladin" ? "gilded" : (p.heroClass || "gilded");
    const candidates = SPELLS.filter((sp) => !sp.legacy && sp.heroClass === heroCls && sp.slot === targetSlot && !p.loadout.includes(sp.id));

    const head = document.createElement("div");
    head.className = "skill-swap-step-head";
    head.innerHTML = `<div><strong>Step 2 of 2 — Select Skill for Slot [${swapState.slotIdx + 1}]</strong><div><span>Replacing ${oldSpell.name} (Carried Rank: Lv ${oldRank}) · Cost: ${cost}g</span></div></div>`;
    panel.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "skill-swap-grid";
    for (const cand of candidates) {
      const isSelected = swapState.candidateId === cand.id;
      const card = document.createElement("button");
      card.type = "button";
      card.className = `skill-swap-card ${isUlt ? "ult" : ""} ${isSelected ? "selected" : ""}`;
      card.innerHTML = `<img src="${cand.icon}" alt="" /><div class="skill-swap-card-body"><strong>${cand.name}${isUlt ? " (ULT)" : ""}</strong><span class="skill-swap-meta">${cand.mpCost} MP · ${cand.cooldowns[0]}s CD · Max Lv ${cand.maxRank}</span><span class="skill-swap-desc">${cand.desc}</span></div>`;
      card.addEventListener("click", () => { swapState.candidateId = cand.id; renderSkillSwapPanel(locked); });
      grid.appendChild(card);
    }
    panel.appendChild(grid);

    const actions = document.createElement("div");
    actions.className = "skill-swap-actions";
    const leftGroup = document.createElement("div");
    leftGroup.style.display = "flex";
    leftGroup.style.gap = "8px";
    const backStepBtn = document.createElement("button");
    backStepBtn.type = "button";
    backStepBtn.className = "btn btn-secondary";
    backStepBtn.textContent = "Change Slot";
    backStepBtn.addEventListener("click", () => { swapState = { step: 1, slotIdx: null, candidateId: null }; renderSkillSwapPanel(locked); });
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn-secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => { swapState = null; renderShopContents(); });
    leftGroup.appendChild(backStepBtn);
    leftGroup.appendChild(cancelBtn);

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "btn btn-primary";
    const selectedNew = candidates.find((c) => c.id === swapState.candidateId) || null;
    confirmBtn.disabled = !selectedNew || p.gold < cost || locked || Boolean(shop.skillSold);
    confirmBtn.textContent = selectedNew ? `Confirm Swap (${cost}g)` : `Pick a Skill (${cost}g)`;
    confirmBtn.addEventListener("click", () => {
      if (!selectedNew || p.gold < cost || locked || shop.skillSold) return;
      p.gold -= cost;
      shop.skillSold = true;
      p.loadout[swapState.slotIdx] = selectedNew.id;
      const existingNewRank = p.skillRanks[selectedNew.id] || 0;
      p.skillRanks[selectedNew.id] = Math.min(selectedNew.maxRank, Math.max(oldRank, existingNewRank));
      if (oldSpell.id !== selectedNew.id) p.skillRanks[oldSpell.id] = 0;
      s.spellCooldowns[oldSpell.id] = 0;
      s.spellCooldowns[selectedNew.id] = 0;
      buildSpellButtons();
      updateCooldownUI();
      sfx.levelUp();
      spawnBurst(p.x, p.y, selectedNew.color || "#facc15", 18, 1.25);
      addFloat(p.x, p.y - 0.35, `Learned ${selectedNew.name}!`, selectedNew.color || "#facc15");
      addLog(`Swapped [${swapState.slotIdx + 1}] ${oldSpell.name} -> ${selectedNew.name} for ${cost} Gold.`, "story");
      swapState = null;
      runtime.uiDirty = true;
      saveRun();
      renderShopContents();
    });
    actions.appendChild(leftGroup);
    actions.appendChild(confirmBtn);
    panel.appendChild(actions);
  };

  const renderShopContents = () => {
    const p = s.player;
    const nonBossLeft = s.level.enemies.filter((e) => !e.isBoss && !e.isClone).length;
    const locked = nonBossLeft > 0;

    document.getElementById("shop-gold").textContent = p.gold;
    const statusEl = document.getElementById("shop-status-banner");
    statusEl.className = locked ? "shop-status locked" : "shop-status open";
    statusEl.textContent = locked
      ? `Shop Locked — Defeat all enemies on this floor first! (${nonBossLeft} remaining)`
      : "All floor enemies defeated! Browse wares, swap a skill, or sell excess gear before facing the Boss.";

    const stockEl = document.getElementById("shop-stock-list");
    stockEl.innerHTML = "";
    for (const entry of shop.stock) {
      const rInfo = getRarityInfo(entry.item);
      const isVial = entry.item?.id === "health_potion" || entry.item?.id === "mana_potion";
      const maxBuys = typeof entry.maxBuys === "number" ? entry.maxBuys : isVial ? 5 : 1;
      const buys = typeof entry.buys === "number" ? entry.buys : entry.sold ? maxBuys : 0;
      const remaining = Math.max(0, maxBuys - buys);

      const row = document.createElement("div");
      row.className = "shop-row";
      row.style.borderLeft = `3px solid ${rInfo.color}`;
      const stockTag = maxBuys > 1 ? ` · Stock: ${remaining}/${maxBuys}` : " · Buy Once";
      const info = document.createElement("div");
      info.className = "shop-row-info";
      info.innerHTML = `<img src="${entry.item.icon}" class="pixel-icon" alt="" /><div class="shop-row-meta"><strong style="color:${rInfo.color}">${entry.item.name}</strong><span class="shop-desc"><span class="rarity-badge" style="color:${rInfo.color};border-color:${rInfo.color};background:${rInfo.bg}">${rInfo.label}</span>${entry.item.desc}${stockTag}</span></div>`;

      const buyBtn = document.createElement("button");
      buyBtn.type = "button";
      buyBtn.className = "btn btn-primary";
      if (remaining <= 0 || entry.sold) { buyBtn.textContent = maxBuys > 1 ? "Sold Out" : "Sold"; buyBtn.disabled = true; }
      else if (locked) { buyBtn.textContent = `${entry.price}g (Locked)`; buyBtn.disabled = true; }
      else { buyBtn.textContent = maxBuys > 1 ? `Buy (${entry.price}g · ${remaining})` : `Buy (${entry.price}g)`; buyBtn.disabled = p.gold < entry.price; }

      buyBtn.addEventListener("click", () => {
        if (locked || remaining <= 0 || entry.sold || p.gold < entry.price) return;
        if (!addItemToInventory(entry.item, 1, { silentFull: true })) {
          addFloat(p.x, p.y - 0.35, "Inventory is full!", "#f87171");
          return;
        }
        p.gold -= entry.price;
        entry.maxBuys = maxBuys;
        entry.buys = buys + 1;
        if (entry.buys >= maxBuys) entry.sold = true;
        sfx.loot();
        addFloat(p.x, p.y - 0.3, `+${entry.item.name}`, rInfo.color);
        addLog(`Bought [${rInfo.label}] ${entry.item.name} for ${entry.price} Gold.`, "loot");
        runtime.uiDirty = true;
        saveRun();
        renderShopContents();
      });
      row.appendChild(info);
      row.appendChild(buyBtn);
      stockEl.appendChild(row);
    }

    const skillOfferEl = document.getElementById("shop-skill-offer");
    if (skillOfferEl) {
      skillOfferEl.innerHTML = "";
      const skillRow = document.createElement("div");
      skillRow.className = "shop-row";
      skillRow.style.borderLeft = `3px solid ${RARITIES.legendary.color}`;
      skillRow.innerHTML = `<div class="shop-row-info"><img src="spritecook-inventory-icons/scroll.png" class="pixel-icon" alt="" /><div class="shop-row-meta"><strong style="color:${RARITIES.legendary.color}">Arcane Skill Swap</strong><span class="shop-desc"><span class="rarity-badge" style="color:${RARITIES.unique.color};border-color:${RARITIES.unique.color};background:${RARITIES.unique.bg}">Buy Once</span>Swap 1 Basic Skill (1000g) or Ultimate Skill (2500g).</span></div></div>`;
      const swapBtn = document.createElement("button");
      swapBtn.type = "button";
      swapBtn.className = "btn btn-primary";
      if (shop.skillSold) { swapBtn.textContent = "Swapped (Sold)"; swapBtn.disabled = true; }
      else if (locked) { swapBtn.textContent = "1000g / 2500g (Locked)"; swapBtn.disabled = true; }
      else if (p.gold < BASIC_SKILL_SWAP_COST) { swapBtn.textContent = `Need ${BASIC_SKILL_SWAP_COST}g+`; swapBtn.disabled = true; }
      else swapBtn.textContent = "Swap Skill (1000g / 2500g)";
      swapBtn.addEventListener("click", () => {
        if (locked || shop.skillSold || p.gold < BASIC_SKILL_SWAP_COST) return;
        swapState = { step: 1, slotIdx: null, candidateId: null };
        renderSkillSwapPanel(locked);
      });
      skillRow.appendChild(swapBtn);
      skillOfferEl.appendChild(skillRow);
    }

    const sellEl = document.getElementById("shop-sell-list");
    sellEl.innerHTML = "";
    if (p.inventory.length === 0) {
      sellEl.innerHTML = `<div class="hint-text">Your satchel is empty.</div>`;
    } else {
      p.inventory.forEach((item, idx) => {
        const rInfo = getRarityInfo(item);
        const sellVal = Math.max(4, Math.floor(getItemPrice(item) * 0.45));
        const row = document.createElement("div");
        row.className = "shop-row";
        row.style.borderLeft = `3px solid ${rInfo.color}`;
        const info = document.createElement("div");
        info.className = "shop-row-info";
        info.innerHTML = `<img src="${item.icon}" class="pixel-icon" alt="" /><div class="shop-row-meta"><strong style="color:${rInfo.color}">${item.name}${item.qty > 1 ? ` (x${item.qty})` : ""}</strong><span class="shop-desc"><span class="rarity-badge" style="color:${rInfo.color};border-color:${rInfo.color};background:${rInfo.bg}">${rInfo.label}</span>${item.desc}</span></div>`;
        const sellBtn = document.createElement("button");
        sellBtn.type = "button";
        sellBtn.className = "btn btn-secondary";
        sellBtn.textContent = locked ? `+${sellVal}g (Locked)` : `Sell (+${sellVal}g)`;
        sellBtn.disabled = locked;
        sellBtn.addEventListener("click", () => {
          if (locked) return;
          const target = p.inventory[idx];
          if (!target) return;
          if ((target.qty || 1) > 1) target.qty -= 1;
          else p.inventory.splice(idx, 1);
          p.gold += sellVal;
          sfx.loot();
          addFloat(p.x, p.y - 0.3, `+${sellVal}g`, "#fde047");
          runtime.uiDirty = true;
          saveRun();
          renderShopContents();
        });
        row.appendChild(info);
        row.appendChild(sellBtn);
        sellEl.appendChild(row);
      });
    }
    renderSkillSwapPanel(locked);
  };

  renderShopContents();
  if (!dlg.open) {
    keys.clear();
    touchMove.active = false;
    dlg.addEventListener("close", () => { swapState = null; s.shopCooldown = 1.8; }, { once: true });
    dlg.showModal();
  }
}

export function openConfirmDialog({ eyebrow = "Confirm", title = "Are you sure?", message = "", confirmLabel = "Confirm", altLabel = null, cancelLabel = "Stay" }) {
  return new Promise((resolve) => {
    const dlg = document.getElementById("confirm-dialog");
    if (!dlg) {
      resolve(window.confirm(message || title));
      return;
    }
    const eyebrowEl = document.getElementById("confirm-dialog-eyebrow");
    const titleEl = document.getElementById("confirm-dialog-title");
    const textEl = document.getElementById("confirm-dialog-text");
    const okBtn = document.getElementById("btn-confirm-ok");
    const altBtn = document.getElementById("btn-confirm-alt");
    const cancelBtn = document.getElementById("btn-confirm-cancel");
    if (eyebrowEl) eyebrowEl.textContent = eyebrow;
    if (titleEl) titleEl.textContent = title;
    if (textEl) textEl.textContent = message;
    if (okBtn) okBtn.textContent = confirmLabel;
    if (altBtn) {
      altBtn.hidden = !altLabel;
      if (altLabel) altBtn.textContent = altLabel;
    }
    if (cancelBtn) cancelBtn.textContent = cancelLabel;

    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      ac.abort();
      if (dlg.open) dlg.close(result ? String(result) : "cancel");
      resolve(result);
    };
    const ac = new AbortController();
    okBtn?.addEventListener("click", () => finish(altLabel ? "ok" : true), { signal: ac.signal });
    altBtn?.addEventListener("click", () => finish("alt"), { signal: ac.signal });
    cancelBtn?.addEventListener("click", () => finish(false), { signal: ac.signal });
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); finish(false); }, { signal: ac.signal });
    dlg.addEventListener("close", () => finish(false), { signal: ac.signal });
    if (!dlg.open) dlg.showModal();
  });
}

let forgeDialogAbort = null;

export function openForgeDialog(prop = null) {
  const s = runtime.state;
  if (!s || s.runEnded) return;
  const dlg = document.getElementById("forge-dialog");
  if (!dlg) return;

  const discount = 1 - (runtime.meta.soulForge?.forge_mastery || 0) * 0.2;

  const renderForge = () => {
    const p = s.player;
    document.getElementById("forge-gold").textContent = p.gold;
    const eqList = document.getElementById("forge-equip-list");
    eqList.innerHTML = "";

    for (const [slot, item] of Object.entries(p.equipment || {})) {
      if (!item) continue;
      const lv = item.upgradeLv || 0;
      const maxed = lv >= 3;
      const cost = Math.round((35 + lv * 35) * discount);
      const rInfo = getRarityInfo(item);
      const isOffense = slot === "weapon" || slot === "ring" || (slot === "subweapon" && item.subType !== "shield");

      const row = document.createElement("div");
      row.className = "shop-row";
      row.style.borderLeft = `3px solid ${rInfo.color}`;
      row.innerHTML = `
        <div class="shop-row-info">
          <img src="${item.icon}" class="pixel-icon" alt="" />
          <div class="shop-row-meta">
            <strong style="color:${rInfo.color}">${item.name} ${lv > 0 ? `+${lv}` : ""}</strong>
            <span class="shop-desc">${isOffense ? "+2 ATK, +2% CRIT per temper" : "+2 DEF, +6 Max HP per temper"} (${lv}/3)</span>
          </div>
        </div>
      `;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      btn.textContent = maxed ? "Max +3" : `Temper (${cost}g)`;
      btn.disabled = maxed || p.gold < cost;
      btn.addEventListener("click", () => {
        if (maxed || p.gold < cost) return;
        p.gold -= cost;
        item.upgradeLv = lv + 1;
        if (isOffense) {
          item.atk = (item.atk || 0) + 2;
          item.crit = (item.crit || 0) + 2;
        } else {
          item.def = (item.def || 0) + 2;
          item.maxHp = (item.maxHp || 0) + 6;
        }
        item.name = `${item.name.replace(/ \+\d+$/, "")} +${item.upgradeLv}`;
        sfx.levelUp();
        addFloat(p.x, p.y - 0.4, `Tempered +${item.upgradeLv}!`, "#fb923c");
        addLog(`Tempered ${item.name} at the Runic Anvil!`, "loot");
        runtime.uiDirty = true;
        saveRun();
        renderForge();
      });
      row.appendChild(btn);
      eqList.appendChild(row);
    }

    const salvEl = document.getElementById("forge-salvage-list");
    salvEl.innerHTML = "";
    const gearIndices = p.inventory.map((it, idx) => ({ it, idx })).filter((x) => x.it.slot);
    if (gearIndices.length === 0) {
      salvEl.innerHTML = `<div class="hint-text">No spare equipment in satchel to salvage.</div>`;
    } else {
      for (const { it, idx } of gearIndices) {
        const val = Math.max(8, Math.floor(getItemPrice(it) * 0.55));
        const rInfo = getRarityInfo(it);
        const row = document.createElement("div");
        row.className = "shop-row";
        row.style.borderLeft = `3px solid ${rInfo.color}`;
        row.innerHTML = `<div class="shop-row-info"><img src="${it.icon}" class="pixel-icon" alt="" /><div class="shop-row-meta"><strong style="color:${rInfo.color}">${it.name}</strong><span class="shop-desc">Salvage for +${val}g, +6 HP, +4 MP</span></div></div>`;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn-secondary";
        btn.textContent = `Salvage (+${val}g)`;
        btn.addEventListener("click", () => {
          p.inventory.splice(idx, 1);
          p.gold += val;
          healPlayer(6);
          const stats = getPlayerStats();
          p.mp = Math.min(stats.maxMp, p.mp + 4);
          sfx.loot();
          addFloat(p.x, p.y - 0.3, `Salvaged +${val}g!`, "#fde047");
          runtime.uiDirty = true;
          saveRun();
          renderForge();
        });
        row.appendChild(btn);
        salvEl.appendChild(row);
      }
    }
  };

  renderForge();
  if (!dlg.open) {
    keys.clear();
    touchMove.active = false;
    if (forgeDialogAbort) forgeDialogAbort.abort();
    forgeDialogAbort = new AbortController();
    let confirming = false;
    const tryCloseForge = async () => {
      if (confirming) return;
      confirming = true;
      const confirmed = await openConfirmDialog({
        eyebrow: "Runic Anvil",
        title: "Close Foundry Forge?",
        message: "Once closed, this Foundry Forge will disappear from this floor. Do you want to close?",
        confirmLabel: "Close & Dismiss",
        cancelLabel: "Keep Using",
      });
      confirming = false;
      if (!confirmed) return;
      if (prop && !prop.used) {
        prop.used = true;
        prop.solid = false;
        const idx = s.level.props.indexOf(prop);
        if (idx >= 0) s.level.props.splice(idx, 1);
        spawnBurst(prop.x + 0.5, prop.y + 0.5, "#fb923c", 14, 1.1);
        spawnRing(prop.x + 0.5, prop.y + 0.5, 24, "#fb923c", 0.3);
        addFloat(prop.x + 0.5, prop.y + 0.2, "Forge Dismissed", "#fb923c");
        addLog("Dismissed the Runic Anvil.", "info");
        runtime.uiDirty = true;
        saveRun();
      }
      s.forgeCooldown = 1.8;
      forgeDialogAbort?.abort();
      if (dlg.open) dlg.close("dismissed");
    };

    document.getElementById("btn-forge-close")?.addEventListener("click", tryCloseForge, { signal: forgeDialogAbort.signal });
    dlg.addEventListener("cancel", (e) => {
      e.preventDefault();
      tryCloseForge();
    }, { signal: forgeDialogAbort.signal });
    dlg.addEventListener("close", () => {
      s.forgeCooldown = 1.8;
      forgeDialogAbort?.abort();
    }, { signal: forgeDialogAbort.signal });
    dlg.showModal();
  }
}

let storyDialogAbort = null;

export function openShrineDialog(prop) {
  const s = runtime.state;
  const tpl = SHRINE_ENCOUNTERS[prop.shrineId] || SHRINE_ENCOUNTERS.sanctum;
  const dlg = document.getElementById("story-dialog");
  document.getElementById("story-role").textContent = tpl.role;
  document.getElementById("story-dialog-title").textContent = tpl.title;
  document.getElementById("story-dialog-text").textContent = tpl.desc;
  storyPortraitCtx.clearRect(0, 0, 80, 80);
  const shrineKey = tpl.id === "blood" ? "shrine_blood" : tpl.id === "aegis" ? "shrine_aegis" : "shrine_magic";
  const shrineImg = runtime.assets?.[shrineKey];
  if (shrineImg) {
    storyPortraitCtx.imageSmoothingEnabled = false;
    storyPortraitCtx.drawImage(shrineImg, 6, 6, 68, 68);
  } else {
    storyPortraitCtx.fillStyle = tpl.id === "blood" ? "#7f1d1d" : tpl.id === "aegis" ? "#854d0e" : "#0c4a6e";
    storyPortraitCtx.fillRect(10, 10, 60, 60);
  }

  const choicesEl = document.getElementById("story-choices");
  choicesEl.innerHTML = "";
  if (storyDialogAbort) storyDialogAbort.abort();
  storyDialogAbort = new AbortController();
  let confirming = false;
  const dismissShrine = async () => {
    if (confirming) return;
    confirming = true;
    const confirmed = await openConfirmDialog({
      eyebrow: tpl.role || "Ancient Shrine",
      title: `Close ${tpl.title}?`,
      message: "Leaving without claiming a blessing will cause this Shrine to vanish from the floor. Are you sure you want to close?",
      confirmLabel: "Close & Vanish",
      cancelLabel: "Stay",
    });
    confirming = false;
    if (!confirmed) return;
    prop.used = true;
    prop.solid = false;
    const idx = s.level.props.indexOf(prop);
    if (idx >= 0) s.level.props.splice(idx, 1);
    const col = prop.shrineId === "blood" ? "#ef4444" : prop.shrineId === "aegis" ? "#facc15" : "#38bdf8";
    spawnBurst(prop.x + 0.5, prop.y + 0.5, col, 14, 1.05);
    spawnRing(prop.x + 0.5, prop.y + 0.5, 24, col, 0.3);
    addLog(`Left ${tpl.title} behind — the altar faded away.`, "info");
    s.shrineCooldown = 1.5;
    runtime.uiDirty = true;
    saveRun();
    storyDialogAbort?.abort();
    if (dlg.open) dlg.close("dismissed");
  };

  tpl.choices.forEach((choice) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary";
    btn.textContent = choice.label;
    if (choice.cost && s.player.gold < choice.cost) {
      btn.disabled = true;
      btn.textContent += " (Not enough Gold)";
    }
    btn.addEventListener("click", () => {
      storyDialogAbort?.abort();
      dlg.close("chosen");
      s.shrineCooldown = 1.5;
      const p = s.player;
      const stats = getPlayerStats();
      if (choice.cost) p.gold -= choice.cost;
      if (choice.effect === "shrine_blood_atk") {
        const hpCost = Math.max(1, Math.floor(p.hp * 0.25));
        p.hp = Math.max(1, p.hp - hpCost);
        p.baseAtk += 3;
        p.baseCrit += 4;
        sfx.ultSlam();
        addFloat(p.x, p.y - 0.4, "+3 ATK +4% CRIT!", "#ef4444");
        addLog(`Offered ${hpCost} HP at the Altar (+3 ATK, +4% CRIT).`, "story");
        prop.used = true;
      } else if (choice.effect === "shrine_skill_pt") {
        p.skillPoints = (p.skillPoints || 0) + 1;
        grantXP(15);
        sfx.levelUp();
        addFloat(p.x, p.y - 0.4, "+1 SKILL POINT!", "#38bdf8");
        addLog("Starlight grants +1 Skill Point and +15 XP!", "story");
        prop.used = true;
      } else if (choice.effect === "shrine_mp") {
        p.maxMp += 8;
        p.hp = stats.maxHp;
        p.mp = stats.maxMp + 8;
        sfx.heal();
        addFloat(p.x, p.y - 0.4, "+8 MAX MP · FULL HEAL", "#38bdf8");
        addLog("Drank Starlight: Full HP/MP and +8 Max MP!", "heal");
        prop.used = true;
      } else if (choice.effect === "shrine_aegis_def") {
        p.baseDef += 3;
        p.maxHp += 12;
        p.hp = Math.min(getPlayerStats().maxHp, p.hp + 12);
        sfx.heal();
        addFloat(p.x, p.y - 0.4, "+3 DEF · +12 MAX HP!", "#facc15");
        addLog("Shrine of Aegis blessed your armor (+3 DEF, +12 Max HP)!", "loot");
        prop.used = true;
      } else if (choice.effect === "shrine_relic") {
        const rel = grantRandomRelic(p);
        sfx.levelUp();
        if (rel) {
          addFloat(p.x, p.y - 0.4, `Relic: ${rel.name}!`, rel.color);
          addLog(`Claimed Relic [${rel.name}]: ${rel.desc}`, "loot");
        } else {
          p.baseAtk += 3;
          addLog("All Relics claimed — Shrine grants +3 ATK instead!", "loot");
        }
        prop.used = true;
      }
      if (prop.used) {
        prop.solid = false;
        const idx = s.level.props.indexOf(prop);
        if (idx >= 0) s.level.props.splice(idx, 1);
        const col = prop.shrineId === "blood" ? "#ef4444" : prop.shrineId === "aegis" ? "#facc15" : "#38bdf8";
        spawnBurst(prop.x + 0.5, prop.y + 0.5, col, 16, 1.15);
        spawnRing(prop.x + 0.5, prop.y + 0.5, 28, col, 0.35);
      }
      runtime.uiDirty = true;
      saveRun();
    });
    choicesEl.appendChild(btn);
  });

  const leaveShrineBtn = document.createElement("button");
  leaveShrineBtn.type = "button";
  leaveShrineBtn.className = "btn btn-secondary";
  leaveShrineBtn.textContent = "Leave Shrine (Close)";
  leaveShrineBtn.addEventListener("click", dismissShrine, { signal: storyDialogAbort.signal });
  choicesEl.appendChild(leaveShrineBtn);

  dlg.addEventListener("cancel", (e) => {
    e.preventDefault();
    dismissShrine();
  }, { signal: storyDialogAbort.signal });

  dlg.showModal();
}

export function openEquippedActionDialog(slot) {
  const s = runtime.state;
  if (!s || s.runEnded) return;
  const p = s.player;
  const item = p.equipment?.[slot];
  if (!item) return;

  const dlg = document.getElementById("item-action-dialog");
  const rInfo = getRarityInfo(item);
  document.getElementById("item-action-icon").src = item.icon;
  const titleEl = document.getElementById("item-action-title");
  titleEl.textContent = item.name;
  titleEl.style.color = rInfo.color;
  document.getElementById("item-action-desc").innerHTML = `<span class="rarity-badge" style="color:${rInfo.color};border-color:${rInfo.color};background:${rInfo.bg}">${rInfo.label}</span> ${item.desc}`;

  const compareEl = document.getElementById("item-action-compare");
  if (compareEl) {
    compareEl.hidden = true;
    compareEl.innerHTML = "";
  }

  const btnsEl = document.getElementById("item-action-buttons");
  btnsEl.innerHTML = "";

  const unequipBtn = document.createElement("button");
  unequipBtn.type = "button";
  unequipBtn.className = "btn btn-primary";
  unequipBtn.textContent = "Unequip to Bag";
  unequipBtn.addEventListener("click", () => {
    if (addItemToInventory(item)) {
      p.equipment[slot] = null;
      sfx.step();
      addLog(`Unequipped ${item.name}.`, "info");
      runtime.uiDirty = true;
      saveRun();
    } else {
      addFloat(p.x, p.y - 0.35, "Bag is full!", "#f87171");
      addLog("Cannot unequip: Satchel is full!", "info");
    }
    dlg.close();
  });
  btnsEl.appendChild(unequipBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn-danger";
  deleteBtn.textContent = "Delete Item";
  deleteBtn.addEventListener("click", () => {
    p.equipment[slot] = null;
    sfx.step();
    addLog(`Deleted equipped ${item.name}.`, "info");
    runtime.uiDirty = true;
    saveRun();
    dlg.close();
  });
  btnsEl.appendChild(deleteBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-secondary";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => dlg.close());
  btnsEl.appendChild(cancelBtn);

  dlg.showModal();
}

export function openStoryDialog(npc) {
  const tpl = NPC_ENCOUNTERS[npc.id];
  if (!tpl) return;
  if (tpl.codexId) unlockCodex(tpl.codexId);

  const dlg = document.getElementById("story-dialog");
  document.getElementById("story-role").textContent = tpl.role;
  document.getElementById("story-dialog-title").textContent = tpl.speaker;
  document.getElementById("story-dialog-text").textContent = tpl.lines[0];

  storyPortraitCtx.clearRect(0, 0, 80, 80);
  storyPortraitCtx.imageSmoothingEnabled = false;
  drawSheetFrame(storyPortraitCtx, runtime.assets[tpl.sprite], 0, 4, 4, 72, 72);

  const choicesEl = document.getElementById("story-choices");
  choicesEl.innerHTML = "";
  if (storyDialogAbort) storyDialogAbort.abort();
  storyDialogAbort = new AbortController();
  let confirming = false;
  const dismissNpc = async () => {
    if (confirming) return;
    confirming = true;
    const confirmed = await openConfirmDialog({
      eyebrow: tpl.role || "Traveler",
      title: `Close ${tpl.speaker}?`,
      message: `Leaving without choosing a favor will cause ${tpl.speaker} to disappear from this floor. Do you want to close?`,
      confirmLabel: "Close & Depart",
      cancelLabel: "Stay",
    });
    confirming = false;
    if (!confirmed) return;
    npc.talked = true;
    const s = runtime.state;
    if (s?.level?.npcs) s.level.npcs = s.level.npcs.filter((n) => n !== npc);
    spawnBurst(npc.x + 0.5, npc.y + 0.5, "#94a3b8", 12, 1.0);
    addFloat(npc.x + 0.5, npc.y + 0.2, "Departed", "#94a3b8");
    addLog(`${tpl.speaker} departed into the shadows.`, "info");
    if (s) s.npcCooldown = 1.5;
    runtime.uiDirty = true;
    saveRun();
    storyDialogAbort?.abort();
    if (dlg.open) dlg.close("leave");
  };

  tpl.choices.forEach((choice, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary";
    if (i === 0) btn.autofocus = true;
    btn.textContent = choice.label;
    if (choice.cost && runtime.state.player.gold < choice.cost) {
      btn.disabled = true;
      btn.textContent += " (Not enough Gold)";
    }
    btn.addEventListener("click", () => {
      storyDialogAbort?.abort();
      dlg.close("chosen");
      runtime.state.npcCooldown = 1.5;
      applyStoryChoice(choice, npc);
    });
    choicesEl.appendChild(btn);
  });

  const leaveBtn = document.createElement("button");
  leaveBtn.type = "button";
  leaveBtn.className = "btn btn-secondary";
  leaveBtn.textContent = "Farewell (Close)";
  leaveBtn.addEventListener("click", dismissNpc, { signal: storyDialogAbort.signal });
  choicesEl.appendChild(leaveBtn);

  dlg.addEventListener("cancel", (e) => {
    e.preventDefault();
    dismissNpc();
  }, { signal: storyDialogAbort.signal });

  dlg.showModal();
}

export function openEquippedActionDialog(slot) {
  const s = runtime.state;
  if (!s || s.runEnded) return;
  const p = s.player;
  const item = p.equipment?.[slot];
  if (!item) return;

  const dlg = document.getElementById("item-action-dialog");
  const rInfo = getRarityInfo(item);
  document.getElementById("item-action-icon").src = item.icon;
  const titleEl = document.getElementById("item-action-title");
  titleEl.textContent = item.name;
  titleEl.style.color = rInfo.color;
  document.getElementById("item-action-desc").innerHTML = `<span class="rarity-badge" style="color:${rInfo.color};border-color:${rInfo.color};background:${rInfo.bg}">${rInfo.label}</span> ${item.desc}`;

  const compareEl = document.getElementById("item-action-compare");
  if (compareEl) {
    compareEl.hidden = true;
    compareEl.innerHTML = "";
  }

  const btnsEl = document.getElementById("item-action-buttons");
  btnsEl.innerHTML = "";

  const unequipBtn = document.createElement("button");
  unequipBtn.type = "button";
  unequipBtn.className = "btn btn-primary";
  unequipBtn.textContent = "Unequip to Bag";
  unequipBtn.addEventListener("click", () => {
    if (addItemToInventory(item)) {
      p.equipment[slot] = null;
      sfx.step();
      addLog(`Unequipped ${item.name}.`, "info");
      runtime.uiDirty = true;
      saveRun();
    } else {
      addFloat(p.x, p.y - 0.35, "Bag is full!", "#f87171");
      addLog("Cannot unequip: Satchel is full!", "info");
    }
    dlg.close();
  });
  btnsEl.appendChild(unequipBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn-danger";
  deleteBtn.textContent = "Delete Item";
  deleteBtn.addEventListener("click", () => {
    p.equipment[slot] = null;
    sfx.step();
    addLog(`Deleted equipped ${item.name}.`, "info");
    runtime.uiDirty = true;
    saveRun();
    dlg.close();
  });
  btnsEl.appendChild(deleteBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-secondary";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => dlg.close());
  btnsEl.appendChild(cancelBtn);

  dlg.showModal();
}

function revealEntireFloor(lvl) {
  if (!lvl?.explored || !lvl?.grid) return;
  const h = lvl.explored.length;
  for (let y = 0; y < h; y++) {
    const row = lvl.explored[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x++) {
      if (lvl.grid[y]?.[x] !== TILE.WALL) { row[x] = true; continue; }
      let touchesFloor = false;
      for (let dy = -1; dy <= 1 && !touchesFloor; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (lvl.grid[y + dy]?.[x + dx] !== undefined && lvl.grid[y + dy]?.[x + dx] !== TILE.WALL) {
            touchesFloor = true;
            break;
          }
        }
      }
      if (touchesFloor) row[x] = true;
    }
  }
}

function applyStoryChoice(choice, npc) {
  const s = runtime.state;
  const p = s.player;
  const stats = getPlayerStats();
  if (choice.cost) p.gold -= choice.cost;

  switch (choice.effect) {
    case "full_heal":
      p.hp = stats.maxHp;
      p.mp = stats.maxMp;
      sfx.heal();
      addLog("Brother Galen's prayer restores you completely.", "heal");
      break;
    case "gift_potions":
      giveOrDropItem(ITEMS.health_potion, p.x, p.y, { requireLeave: true });
      giveOrDropItem(ITEMS.mana_potion, p.x, p.y, { requireLeave: true });
      sfx.loot();
      addLog("Received a Crimson Vial and Azure Vial.", "loot");
      break;
    case "buy_scroll":
      p.baseAtk += 2;
      sfx.levelUp();
      addLog("Lyra hands you a Scroll of Valor (+2 ATK).", "loot");
      break;
    case "reveal_floor":
      revealEntireFloor(s.level);
      grantXP(15);
      addLog("Lyra shares her map of the floor (+15 XP).", "story");
      break;
    case "buy_atk":
      p.baseAtk += 3;
      sfx.levelUp();
      addLog("Unit-09 sharpens your blade with foundry plasma (+3 ATK).", "loot");
      break;
    case "reveal_and_mp":
      revealEntireFloor(s.level);
      sfx.loot();
      giveOrDropItem(ITEMS.mana_potion, p.x, p.y, { requireLeave: true });
      addLog("Downloaded floor schematic and received an Azure Vial.", "loot");
      break;
    case "buy_aegis":
      sfx.loot();
      giveOrDropItem(ITEMS.aegis_shield, p.x, p.y, { requireLeave: true });
      addLog("Purchased the Gilded Aegis!", "loot");
      break;
    case "small_heal":
      healPlayer(18, "Shared a warm draught");
      p.mp = Math.min(stats.maxMp, p.mp + 10);
      sfx.heal();
      break;
    case "upgrade_inventory":
      p.maxInventory = getMaxInventory(p) + 1;
      sfx.levelUp();
      addFloat(p.x, p.y - 0.25, `+1 Max Inventory (${p.maxInventory})`, "#fde047");
      spawnBurst(p.x, p.y, "#fde047", 14);
      addLog(`Max inventory increased to ${p.maxInventory}.`, "loot");
      break;
  }
  npc.talked = true;
  s.level.npcs = s.level.npcs.filter((n) => n !== npc);
  runtime.uiDirty = true;
  saveRun();
}

export function openStairsDialog() {
  const dlg = document.getElementById("stairs-dialog");
  if (!dlg || dlg.open) return;
  keys.clear();
  touchMove.active = false;
  touchMove.x = 0;
  touchMove.y = 0;
  const nextFloor = runtime.state.floor + 1;
  document.getElementById("stairs-dialog-title").textContent = `Descend to Floor ${nextFloor}?`;
  document.getElementById("stairs-dialog-text").textContent =
    `You found the stairs down to Floor ${nextFloor}. Do you want to proceed now or keep exploring Floor ${runtime.state.floor}?`;
  dlg.showModal();
}

export function openEquippedActionDialog(slot) {
  const s = runtime.state;
  if (!s || s.runEnded) return;
  const p = s.player;
  const item = p.equipment?.[slot];
  if (!item) return;

  const dlg = document.getElementById("item-action-dialog");
  const rInfo = getRarityInfo(item);
  document.getElementById("item-action-icon").src = item.icon;
  const titleEl = document.getElementById("item-action-title");
  titleEl.textContent = item.name;
  titleEl.style.color = rInfo.color;
  document.getElementById("item-action-desc").innerHTML = `<span class="rarity-badge" style="color:${rInfo.color};border-color:${rInfo.color};background:${rInfo.bg}">${rInfo.label}</span> ${item.desc}`;

  const compareEl = document.getElementById("item-action-compare");
  if (compareEl) {
    compareEl.hidden = true;
    compareEl.innerHTML = "";
  }

  const btnsEl = document.getElementById("item-action-buttons");
  btnsEl.innerHTML = "";

  const unequipBtn = document.createElement("button");
  unequipBtn.type = "button";
  unequipBtn.className = "btn btn-primary";
  unequipBtn.textContent = "Unequip to Bag";
  unequipBtn.addEventListener("click", () => {
    if (addItemToInventory(item)) {
      p.equipment[slot] = null;
      sfx.step();
      addLog(`Unequipped ${item.name}.`, "info");
      runtime.uiDirty = true;
      saveRun();
    } else {
      addFloat(p.x, p.y - 0.35, "Bag is full!", "#f87171");
      addLog("Cannot unequip: Satchel is full!", "info");
    }
    dlg.close();
  });
  btnsEl.appendChild(unequipBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn-danger";
  deleteBtn.textContent = "Delete Item";
  deleteBtn.addEventListener("click", () => {
    p.equipment[slot] = null;
    sfx.step();
    addLog(`Deleted equipped ${item.name}.`, "info");
    runtime.uiDirty = true;
    saveRun();
    dlg.close();
  });
  btnsEl.appendChild(deleteBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-secondary";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => dlg.close());
  btnsEl.appendChild(cancelBtn);

  dlg.showModal();
}

export function renderTitleSanctum() {
  const m = runtime.meta;
  const nameInput = document.getElementById("hero-name-input");
  if (nameInput && !nameInput.value.trim()) nameInput.value = m.heroName || "Sir Aldric";
  const diffSel = document.getElementById("difficulty-select");
  const curDiff = m.difficulty || "normal";
  if (diffSel) diffSel.value = curDiff;
  const diffCardsWrap = document.getElementById("difficulty-cards");
  if (diffCardsWrap) {
    const syncDiffCards = (val) => {
      if (diffSel) diffSel.value = val;
      for (const btn of diffCardsWrap.querySelectorAll(".difficulty-card")) {
        const active = (btn.dataset.diff || "normal") === val;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-checked", String(active));
      }
    };
    syncDiffCards(curDiff);
    if (!diffCardsWrap.dataset.bound) {
      diffCardsWrap.dataset.bound = "1";
      for (const btn of diffCardsWrap.querySelectorAll(".difficulty-card")) {
        btn.addEventListener("click", () => {
          const val = btn.dataset.diff || "normal";
          m.difficulty = val;
          saveMeta();
          syncDiffCards(val);
        });
      }
    }
  }
  document.getElementById("sanctum-shards").textContent = m.soulShards;

  const tabBlessings = document.getElementById("btn-sanctum-tab-blessings");
  const tabForge = document.getElementById("btn-sanctum-tab-forge");
  const paneBlessings = document.getElementById("sanctum-pane-blessings");
  const paneForge = document.getElementById("sanctum-pane-forge");
  const setSanctumTab = (tab) => {
    const isForge = tab === "forge";
    tabBlessings?.classList.toggle("active", !isForge);
    tabBlessings?.setAttribute("aria-selected", String(!isForge));
    tabForge?.classList.toggle("active", isForge);
    tabForge?.setAttribute("aria-selected", String(isForge));
    if (paneBlessings) paneBlessings.hidden = isForge;
    if (paneForge) paneForge.hidden = !isForge;
  };
  if (tabBlessings && !tabBlessings.dataset.bound) {
    tabBlessings.dataset.bound = "1";
    tabBlessings.addEventListener("click", () => setSanctumTab("blessings"));
  }
  if (tabForge && !tabForge.dataset.bound) {
    tabForge.dataset.bound = "1";
    tabForge.addEventListener("click", () => setSanctumTab("forge"));
  }

  const list = document.getElementById("meta-upgrades-list");
  list.innerHTML = "";
  for (const upg of META_UPGRADES) {
    const rank = m.upgrades[upg.id] || 0;
    const cost = upg.baseCost + rank * 2;
    const maxed = rank >= upg.maxRank;
    const card = document.createElement("div");
    card.className = "meta-card";
    card.innerHTML = `<strong>${upg.name} (${rank}/${upg.maxRank})</strong><span style="color:var(--muted)">${upg.desc}</span>`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary";
    btn.textContent = maxed ? "Maxed" : `Bless (${cost} Shards)`;
    btn.disabled = maxed || m.soulShards < cost;
    btn.addEventListener("click", () => {
      m.soulShards -= cost;
      m.upgrades[upg.id] = rank + 1;
      saveMeta();
      sfx.levelUp();
      renderTitleSanctum();
      document.getElementById("soul-shards-count").textContent = m.soulShards;
    });
    card.appendChild(btn);
    list.appendChild(card);
  }

  const forgeList = document.getElementById("soul-forge-list");
  if (forgeList) {
    forgeList.innerHTML = "";
    for (const upg of SOUL_FORGE_UPGRADES) {
      const rank = m.soulForge?.[upg.id] || 0;
      const cost = upg.baseCost + rank * (upg.stepCost || 0);
      const maxed = rank >= upg.maxRank;
      const card = document.createElement("div");
      card.className = "meta-card";
      card.innerHTML = `<strong>${upg.name} (${rank}/${upg.maxRank})</strong><span style="color:var(--muted)">${upg.desc}</span>`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-secondary";
      btn.textContent = maxed ? "Unlocked" : `Forge (${cost} Shards)`;
      btn.disabled = maxed || m.soulShards < cost;
      btn.addEventListener("click", () => {
        if (!m.soulForge) m.soulForge = {};
        m.soulShards -= cost;
        m.soulForge[upg.id] = rank + 1;
        saveMeta();
        sfx.levelUp();
        renderTitleSanctum();
        document.getElementById("soul-shards-count").textContent = m.soulShards;
      });
      card.appendChild(btn);
      forgeList.appendChild(card);
    }
  }
}

export function renderCodex(activeTab = "lore") {
  const m = runtime.meta;
  const el = document.getElementById("codex-entries");
  el.innerHTML = "";

  for (const tabBtn of document.querySelectorAll(".codex-tab")) {
    tabBtn.classList.toggle("active", tabBtn.dataset.codexTab === activeTab);
  }

  if (activeTab === "lore") {
    for (const entry of LORE_CODEX) {
      const unlocked = m.unlockedCodex.includes(entry.id);
      const div = document.createElement("div");
      div.className = "codex-item";
      div.innerHTML = unlocked
        ? `<h4>${entry.title}</h4><p>${entry.text}</p>`
        : `<h4>??? (Undiscovered)</h4><p>Explore deeper floors and speak with allies to uncover this chronicle.</p>`;
      el.appendChild(div);
    }
  } else if (activeTab === "bestiary") {
    for (const tpl of Object.values(ENEMIES)) {
      const rec = m.bestiary?.[tpl.id] || { seen: 0, kills: 0 };
      const discovered = rec.seen > 0 || rec.kills > 0;
      const div = document.createElement("div");
      div.className = "codex-item";
      div.innerHTML = discovered
        ? `<h4>${tpl.name}${tpl.isBoss ? " (Boss)" : ""}</h4><p>${tpl.lore || ""}</p><p style="color:var(--accent);margin-top:4px">Slain: ${rec.kills} · Base HP: ${tpl.hp} · ATK: ${tpl.atk}</p>`
        : `<h4>???</h4><p>Encounter this foe in the dungeon to record it in the Bestiary.</p>`;
      el.appendChild(div);
    }
  } else {
    const summary = document.createElement("div");
    summary.className = "codex-item";
    summary.innerHTML = `<h4>Sanctum Records</h4><p>Victories: <strong>${m.victories || 0}</strong> · Best Floor: <strong>${m.bestFloor || 1}</strong> · Endless Depth Best: <strong>${m.endlessBestFloor || 0}</strong></p>`;
    el.appendChild(summary);
    const history = m.runHistory || [];
    if (history.length === 0) {
      const empty = document.createElement("div");
      empty.className = "codex-item";
      empty.innerHTML = `<p>No completed expeditions recorded yet.</p>`;
      el.appendChild(empty);
    } else {
      for (const run of history) {
        const div = document.createElement("div");
        div.className = "codex-item";
        div.innerHTML = `<h4>${run.heroName} (${run.heroClass}) — ${run.victory ? "Victory" : `Floor ${run.floor}`}</h4><p>Difficulty: ${run.difficulty} · Kills: ${run.kills} · Time: ${run.time} · ${run.date}</p>`;
        el.appendChild(div);
      }
    }
  }
}

export function renderPatchNotes() {
  const badge = document.getElementById("menu-version-badge");
  if (badge) badge.textContent = GAME_VERSION;

  const isUnread = !runtime.meta?.lastSeenPatchVersion || runtime.meta.lastSeenPatchVersion !== GAME_VERSION;
  const patchBtn = document.getElementById("menu-btn-patch-notes");
  const patchNewBadge = document.getElementById("menu-patch-new-badge");
  if (patchBtn) patchBtn.classList.toggle("has-new-patch", isUnread);
  if (patchNewBadge) patchNewBadge.hidden = !isUnread;

  const recEl = document.getElementById("menu-records-strip");
  if (recEl && runtime.meta) {
    const bestFl = runtime.meta.bestFloor || 1;
    const wins = runtime.meta.victories || 0;
    const shards = runtime.meta.soulShards || 0;
    recEl.textContent = wins > 0 ? `Best Floor ${bestFl} · ${wins} Clear · ${shards} Shards` : `Best Floor ${bestFl} · ${shards} Shards`;
  }

  const latest = PATCH_NOTES[0];
  const patchTitle = document.getElementById("menu-patch-title");
  if (patchTitle && latest) {
    patchTitle.textContent = `Latest Update (${latest.version}) — ${latest.title}`;
  }
  const highlightsEl = document.getElementById("menu-patch-highlights");
  if (highlightsEl && latest) {
    highlightsEl.innerHTML = "";
    for (const line of latest.notes.slice(0, 3)) {
      const li = document.createElement("li");
      li.textContent = line;
      highlightsEl.appendChild(li);
    }
  }

  const listEl = document.getElementById("patch-notes-list");
  if (listEl) {
    listEl.innerHTML = "";
    const renderReleaseCard = (release) => {
      const iconsHtml = Array.isArray(release.icons) && release.icons.length
        ? `<div class="patch-icon-strip">${release.icons
            .map((ic) => `<div class="patch-icon-chip"><img src="${ic.src}" alt="${escapeHtml(ic.label)}" /><span>${escapeHtml(ic.label)}</span></div>`)
            .join("")}</div>`
        : "";
      const itemsHtml = release.notes.map((n) => `<li>${n}</li>`).join("");
      return `<div class="codex-item"><h4>${release.version} — ${release.title}</h4>${iconsHtml}<ul class="menu-patch-list">${itemsHtml}</ul></div>`;
    };

    const betaReleases = PATCH_NOTES.filter((r) => !/alpha/i.test(r.version));
    const alphaReleases = PATCH_NOTES.filter((r) => /alpha/i.test(r.version));

    if (betaReleases.length > 0) {
      const betaDet = document.createElement("details");
      betaDet.className = "patch-accordion";
      betaDet.open = true;
      betaDet.innerHTML = `<summary>BETA (${betaReleases.length} updates)</summary><div class="patch-accordion-body">${betaReleases.map(renderReleaseCard).join("")}</div>`;
      listEl.appendChild(betaDet);
    }

    if (alphaReleases.length > 0) {
      const alphaDet = document.createElement("details");
      alphaDet.className = "patch-accordion patch-accordion-alpha";
      alphaDet.innerHTML = `<summary>ALPHA (${alphaReleases.length} builds)</summary><div class="patch-accordion-body">${alphaReleases.map(renderReleaseCard).join("")}</div>`;
      listEl.appendChild(alphaDet);
    }
  }
}

export function markPatchNotesSeen() {
  if (!runtime.meta) return;
  if (runtime.meta.lastSeenPatchVersion !== GAME_VERSION) {
    runtime.meta.lastSeenPatchVersion = GAME_VERSION;
    saveMeta();
  }
  renderPatchNotes();
}

export function openHeroDialog(onSelectHero, onBack = null) {
  const dlg = document.getElementById("hero-dialog");
  const mageBtn = document.getElementById("btn-hero-mage");
  const gildedBtn = document.getElementById("btn-hero-gilded");
  const rangerBtn = document.getElementById("btn-hero-ranger");
  const nextBtn = document.getElementById("btn-hero-next");
  const backBtn = document.getElementById("btn-hero-back");

  const mageCtx = document.getElementById("hero-preview-mage")?.getContext("2d");
  const gildedCtx = document.getElementById("hero-preview-gilded")?.getContext("2d");
  const rangerCtx = document.getElementById("hero-preview-ranger")?.getContext("2d");

  let selectedHero = null;
  const attackFlash = { mage: 0, gilded: 0, ranger: 0 };
  let frame = 0;
  let lastTick = performance.now();
  let rafId = 0;

  function drawPreview(pCtx, prefix, isSel, now) {
    if (!pCtx) return;
    pCtx.clearRect(0, 0, 72, 72);
    pCtx.imageSmoothingEnabled = false;
    if (isSel) {
      pCtx.save();
      pCtx.strokeStyle = `rgba(250, 204, 21, ${0.55 + Math.sin(now * 0.008) * 0.25})`;
      pCtx.lineWidth = 2;
      pCtx.beginPath();
      pCtx.arc(36, 40, 28, 0, Math.PI * 2);
      pCtx.stroke();
      pCtx.restore();
    }
    let sheet = runtime.assets[`${prefix}_idle`];
    if (attackFlash[prefix] > 0) sheet = runtime.assets[`${prefix}_attack`] || sheet;
    else if (isSel) sheet = runtime.assets[`${prefix}_walk`] || sheet;
    if (sheet) {
      drawSheetFrame(pCtx, sheet, frame, 4, 4, 64, 64);
    }
  }

  function tickPreview(now) {
    if (!dlg.open) return;
    if (now - lastTick >= 110) {
      lastTick = now;
      frame = (frame + 1) % 24;
      if (attackFlash.mage > 0) attackFlash.mage -= 1;
      if (attackFlash.gilded > 0) attackFlash.gilded -= 1;
      if (attackFlash.ranger > 0) attackFlash.ranger -= 1;
    }
    drawPreview(mageCtx, "mage", selectedHero === "mage", now);
    drawPreview(gildedCtx, "gilded", selectedHero === "gilded", now);
    drawPreview(rangerCtx, "ranger", selectedHero === "ranger", now);
    rafId = requestAnimationFrame(tickPreview);
  }

  function updateSelection() {
    mageBtn?.classList.toggle("selected", selectedHero === "mage");
    gildedBtn.classList.toggle("selected", selectedHero === "gilded");
    rangerBtn?.classList.toggle("selected", selectedHero === "ranger");
    nextBtn.disabled = !selectedHero;
  }

  if (mageBtn) mageBtn.onclick = () => { selectedHero = "mage"; attackFlash.mage = 5; frame = 0; sfx.magicOrb(); updateSelection(); };
  gildedBtn.onclick = () => { selectedHero = "gilded"; attackFlash.gilded = 5; frame = 0; sfx.slash(); updateSelection(); };
  if (rangerBtn) rangerBtn.onclick = () => { selectedHero = "ranger"; attackFlash.ranger = 5; frame = 0; sfx.arrow(); updateSelection(); };

  nextBtn.onclick = () => {
    if (!selectedHero) return;
    cancelAnimationFrame(rafId);
    dlg.close("next");
    onSelectHero(selectedHero);
  };
  backBtn.onclick = () => {
    cancelAnimationFrame(rafId);
    dlg.close("back");
    if (onBack) onBack();
    else document.getElementById("title-dialog").showModal();
  };
  dlg.addEventListener("close", () => { if (rafId) cancelAnimationFrame(rafId); }, { once: true });

  updateSelection();
  dlg.showModal();
  rafId = requestAnimationFrame(tickPreview);
}

export function openLoadoutDialog(onConfirm, onBack, initialLoadout = null, heroClass = "gilded") {
  const dlg = document.getElementById("loadout-dialog");
  if (!dlg) return;
  const slotLists = [
    document.getElementById("loadout-slot1-list"),
    document.getElementById("loadout-slot2-list"),
    document.getElementById("loadout-slot3-list"),
    document.getElementById("loadout-ult-list"),
  ];
  const badge = document.getElementById("loadout-count-badge");
  const confirmBtn = document.getElementById("btn-loadout-confirm");
  const cancelBtn = document.getElementById("btn-loadout-cancel");

  const resolvedClass = heroClass === "paladin" ? "gilded" : (heroClass || "gilded");
  const classSpells = SPELLS.filter((s) => !s.legacy && s.heroClass === resolvedClass);
  const slotPools = [1, 2, 3, 4].map((slotNum) => classSpells.filter((s) => s.slot === slotNum));
  const defaults = CLASS_DEFAULT_LOADOUTS[resolvedClass] || DEFAULT_LOADOUT;

  const selectedSlots = slotPools.map((pool, idx) => {
    const fromInit = Array.isArray(initialLoadout)
      ? pool.find((sp) => sp.id === initialLoadout[idx] || initialLoadout.includes(sp.id))
      : null;
    if (fromInit) return fromInit.id;
    const fromDef = pool.find((sp) => sp.id === defaults[idx]);
    return (fromDef || pool[0])?.id || null;
  });

  function renderLoadout() {
    const readyCount = selectedSlots.filter(Boolean).length;
    badge.textContent = `${readyCount}/4 Slots Ready`;
    confirmBtn.disabled = readyCount !== 4;

    slotPools.forEach((pool, idx) => {
      const container = slotLists[idx];
      if (!container) return;
      container.innerHTML = "";
      const isUltSlot = idx === 3;
      for (const sp of pool) {
        const isSel = selectedSlots[idx] === sp.id;
        const card = document.createElement("button");
        card.type = "button";
        card.className = `loadout-card ${isUltSlot ? "ult " : ""}${isSel ? "selected" : ""}`;
        card.innerHTML = `<img src="${sp.icon}" alt="" /><div class="loadout-card-body"><strong>${sp.name}${isUltSlot ? " (ULT)" : ""} · ${sp.mpCost} MP</strong><span>${sp.desc}</span></div>`;
        card.addEventListener("click", () => {
          selectedSlots[idx] = sp.id;
          renderLoadout();
        });
        container.appendChild(card);
      }
    });
  }

  confirmBtn.onclick = () => {
    if (selectedSlots.some((id) => !id)) return;
    dlg.close("confirm");
    onConfirm([...selectedSlots]);
  };
  cancelBtn.onclick = () => {
    dlg.close("cancel");
    if (onBack) onBack();
    else document.getElementById("title-dialog").showModal();
  };

  renderLoadout();
  dlg.showModal();
}

export function openEquippedActionDialog(slot) {
  const s = runtime.state;
  if (!s || s.runEnded) return;
  const p = s.player;
  const item = p.equipment?.[slot];
  if (!item) return;

  const dlg = document.getElementById("item-action-dialog");
  const rInfo = getRarityInfo(item);
  document.getElementById("item-action-icon").src = item.icon;
  const titleEl = document.getElementById("item-action-title");
  titleEl.textContent = item.name;
  titleEl.style.color = rInfo.color;
  document.getElementById("item-action-desc").innerHTML = `<span class="rarity-badge" style="color:${rInfo.color};border-color:${rInfo.color};background:${rInfo.bg}">${rInfo.label}</span> ${item.desc}`;

  const compareEl = document.getElementById("item-action-compare");
  if (compareEl) {
    compareEl.hidden = true;
    compareEl.innerHTML = "";
  }

  const btnsEl = document.getElementById("item-action-buttons");
  btnsEl.innerHTML = "";

  const unequipBtn = document.createElement("button");
  unequipBtn.type = "button";
  unequipBtn.className = "btn btn-primary";
  unequipBtn.textContent = "Unequip to Bag";
  unequipBtn.addEventListener("click", () => {
    if (addItemToInventory(item)) {
      p.equipment[slot] = null;
      sfx.step();
      addLog(`Unequipped ${item.name}.`, "info");
      runtime.uiDirty = true;
      saveRun();
    } else {
      addFloat(p.x, p.y - 0.35, "Bag is full!", "#f87171");
      addLog("Cannot unequip: Satchel is full!", "info");
    }
    dlg.close();
  });
  btnsEl.appendChild(unequipBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn-danger";
  deleteBtn.textContent = "Delete Item";
  deleteBtn.addEventListener("click", () => {
    p.equipment[slot] = null;
    sfx.step();
    addLog(`Deleted equipped ${item.name}.`, "info");
    runtime.uiDirty = true;
    saveRun();
    dlg.close();
  });
  btnsEl.appendChild(deleteBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-secondary";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => dlg.close());
  btnsEl.appendChild(cancelBtn);

  dlg.showModal();
}

export { openPvpDialog } from "./pvpLobby.js";

// Wire hooks
combatHooks.openSkillDialog = openSkillDialog;
uiHooks.useShortcut = useShortcut;
uiHooks.openItemActionDialog = openItemActionDialog;
uiHooks.openEquippedActionDialog = openEquippedActionDialog;
worldHooks.openStairsDialog = openStairsDialog;
worldHooks.openShopDialog = openShopDialog;
worldHooks.openStoryDialog = openStoryDialog;
worldHooks.openShrineDialog = openShrineDialog;
worldHooks.openForgeDialog = openForgeDialog;
