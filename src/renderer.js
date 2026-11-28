import { drawSheetFrame } from "./assets.js";
import { getAimAngle } from "./combat.js";
import { NPC_ENCOUNTERS } from "./data.js";
import { MAP_H, MAP_W, TILE } from "./dungeon.js";
import {
  camera,
  canvas,
  ctx,
  getRarityInfo,
  getWeaponCategory,
  isMobileLayout,
  mobilePortraitCtx,
  mouse,
  portraitCtx,
  runtime,
  TILE_SIZE,
  touchAim,
} from "./state.js";
import { syncPvpIntroTimer } from "./pvp.js";
import { updateSimulation } from "./world.js";

export const renderHooks = {
  updateCooldownUI: null,
  updateUI: null,
};

const VFX_SHEET_META = {
  vfx_arcane_beam: { fw: 168, fh: 64, cols: 8, frames: 8 },
  vfx_arcane_orb: { fw: 128, fh: 52, cols: 8, frames: 27 },
  vfx_blink_dash: { fw: 128, fh: 48, cols: 8, frames: 22 },
  vfx_mana_shield: { fw: 80, fh: 76, cols: 8, frames: 20 },
  vfx_fireball_impact: { fw: 96, fh: 64, cols: 8, frames: 15 },
  vfx_meteor_strike: { fw: 96, fh: 96, cols: 8, frames: 26 },
  vfx_chain_lightning: { fw: 180, fh: 72, cols: 8, frames: 14 },
  vfx_fireball_flight: { fw: 72, fh: 32, cols: 6, frames: 6 },
  vfx_ice_shard: { fw: 112, fh: 48, cols: 8, frames: 19 },
  vfx_lightning_bolt: { fw: 72, fh: 32, cols: 8, frames: 10 },
  vfx_holy_lance: { fw: 72, fh: 28, cols: 8, frames: 8 },
  vfx_magic_missile: { fw: 156, fh: 60, cols: 8, frames: 28 },
  vfx_arcane_burst: { fw: 72, fh: 72, cols: 8, frames: 20 },
  vfx_fire_explosion: { fw: 64, fh: 64, cols: 4, frames: 16 },
};

const PROJ_SHEET_MAP = {
  magic_missile: { key: "vfx_magic_missile", dw: 44, dh: 20 },
  fireball: { key: "vfx_fireball_flight", dw: 40, dh: 18 },
  ice_shard: { key: "vfx_ice_shard", dw: 44, dh: 20 },
  frost_orb: { key: "vfx_ice_shard", dw: 44, dh: 20 },
  lightning_bolt: { key: "vfx_lightning_bolt", dw: 42, dh: 18 },
  holy_lance: { key: "vfx_holy_lance", dw: 44, dh: 18 },
  sun_orb: { key: "vfx_holy_lance", dw: 44, dh: 18 },
  arcane_orb: { key: "vfx_arcane_orb", dw: 48, dh: 22 },
  void_orb: { key: "vfx_arcane_orb", dw: 48, dh: 22 },
};

function drawGridVfxFrame(targetCtx, sheet, meta, frameIdx, dx, dy, dw, dh) {
  if (!sheet || !meta) return;
  const f = ((frameIdx % meta.frames) + meta.frames) % meta.frames;
  const col = f % meta.cols;
  const row = Math.floor(f / meta.cols);
  targetCtx.imageSmoothingEnabled = false;
  targetCtx.drawImage(sheet, col * meta.fw, row * meta.fh, meta.fw, meta.fh, dx, dy, dw, dh);
}

export function render(ts) {
  requestAnimationFrame(render);
  if (!runtime.state || !runtime.state.level || !runtime.state.player) return;
  try {
    renderFrame(ts);
  } catch (err) {
    console.error("Frame error:", err);
  }
}

let perfFrames = 0;
let perfAccum = 0;

export function renderFrame(ts) {
  const s = runtime.state;
  const assets = runtime.assets;
  if (!runtime.lastFrameTime) runtime.lastFrameTime = ts;
  const rawDt = (ts - runtime.lastFrameTime) / 1000;
  runtime.lastFrameTime = ts;
  const dt = Math.min(0.05, Math.max(0, rawDt));

  if (rawDt > 0 && rawDt < 0.5) {
    perfFrames += 1;
    perfAccum += rawDt;
    if (perfAccum >= 0.45) {
      runtime.perfFps = Math.round(perfFrames / perfAccum);
      perfFrames = 0;
      perfAccum = 0;
      if (renderHooks.updatePerfHUD) renderHooks.updatePerfHUD();
    }
  }

  if (s.isPvp && (s.pvpIntroTimer || 0) > 0) {
    syncPvpIntroTimer(s);
  }
  const menuOpen = !document.getElementById("main-menu").hidden || !document.getElementById("loading-screen").hidden;
  const modalOpen = Boolean(document.querySelector("dialog[open]")) || menuOpen;
  const canSimulate = s.isPvp ? (!menuOpen && (!s.runEnded || s.pvpRoundEnded)) : (!modalOpen && runtime.isCanvasVisible && !document.hidden);
  if (canSimulate) {
    runtime.animTimer += dt;
    if (runtime.animTimer >= 0.095) {
      runtime.animFrame = (runtime.animFrame + 1) % 24;
      runtime.animTimer -= 0.095;
    }
    updateSimulation(dt);
    if (renderHooks.updateCooldownUI) renderHooks.updateCooldownUI();
    if (runtime.uiDirty && renderHooks.updateUI) renderHooks.updateUI();
  }

  if (isMobileLayout()) {
    const vw = window.innerWidth || 800;
    const vh = window.innerHeight || 360;
    const targetH = 340;
    const targetW = Math.max(420, Math.round(targetH * (vw / vh)));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    let focusX = s.player.x * TILE_SIZE;
    let focusY = s.player.y * TILE_SIZE;
    if (s.camReveal) {
      const cr = s.camReveal;
      const elapsed = cr.duration - cr.timer;
      let blend = 1;
      if (elapsed < 0.5) blend = elapsed / 0.5;
      else if (cr.timer < 0.5) blend = Math.max(0, cr.timer / 0.5);
      focusX = focusX + (cr.targetX * TILE_SIZE - focusX) * blend;
      focusY = focusY + (cr.targetY * TILE_SIZE - focusY) * blend;
    }
    camera.x = focusX - canvas.width / 2;
    camera.y = focusY - canvas.height / 2;
  } else {
    const fullW = MAP_W * TILE_SIZE;
    const fullH = MAP_H * TILE_SIZE;
    if (canvas.width !== fullW || canvas.height !== fullH) {
      canvas.width = fullW;
      canvas.height = fullH;
    }
    camera.x = 0;
    camera.y = 0;
  }

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#06080d";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(-Math.round(camera.x), -Math.round(camera.y));
  const shakeEnabled = runtime.meta.settings?.screenShake !== false;
  if (shakeEnabled && s.shake > 0.2) {
    ctx.translate((Math.random() - 0.5) * s.shake * 2, (Math.random() - 0.5) * s.shake * 2);
  }

  const lvl = s.level;
  const tilesImg = assets.dungeon_tiles;
  const animFrame = runtime.animFrame;

  const minTX = Math.max(0, Math.floor(camera.x / TILE_SIZE) - 1);
  const maxTX = Math.min(MAP_W - 1, Math.ceil((camera.x + canvas.width) / TILE_SIZE) + 1);
  const minTY = Math.max(0, Math.floor(camera.y / TILE_SIZE) - 1);
  const maxTY = Math.min(MAP_H - 1, Math.ceil((camera.y + canvas.height) / TILE_SIZE) + 1);

  for (let y = minTY; y <= maxTY; y++) {
    for (let x = minTX; x <= maxTX; x++) {
      if (!lvl.explored[y]?.[x]) continue;
      const isVis = lvl.visible[y][x];
      const tile = lvl.grid[y][x];
      const dx = x * TILE_SIZE;
      const dy = y * TILE_SIZE;

      if (tilesImg) {
        const quad = tile === TILE.WALL ? 2 : lvl.act.floorTileIdx;
        const sx = (quad % 2) * 128;
        const sy = Math.floor(quad / 2) * 128;
        ctx.drawImage(tilesImg, sx, sy, 128, 128, dx, dy, TILE_SIZE, TILE_SIZE);
        if (tile !== TILE.WALL) {
          ctx.fillStyle = quad === 3 ? "rgba(8, 10, 18, 0.44)" : "rgba(8, 10, 18, 0.24)";
          ctx.fillRect(dx, dy, TILE_SIZE, TILE_SIZE);
        }
      } else {
        ctx.fillStyle = tile === TILE.WALL ? "#1e2436" : "#2e3548";
        ctx.fillRect(dx, dy, TILE_SIZE, TILE_SIZE);
      }

      if (tile === TILE.STAIRS) {
        ctx.fillStyle = "#11151e";
        ctx.fillRect(dx + 2, dy + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        ctx.strokeStyle = "#475569";
        ctx.lineWidth = 2;
        ctx.strokeRect(dx + 2, dy + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        for (let st = 0; st < 5; st++) {
          const sy = dy + 4 + st * 5;
          const v = 148 - st * 22;
          ctx.fillStyle = `rgb(${v}, ${v + 4}, ${v + 10})`;
          ctx.fillRect(dx + 4, sy, TILE_SIZE - 8, 4);
          ctx.fillStyle = `rgb(${v + 24}, ${v + 28}, ${v + 34})`;
          ctx.fillRect(dx + 4, sy, TILE_SIZE - 8, 1);
        }
      }

      if (!isVis) {
        ctx.fillStyle = "rgba(6, 8, 13, 0.65)";
        ctx.fillRect(dx, dy, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  // Floor Traps (4-state Spike Trap sprites + Void Vent)
  if (Array.isArray(lvl.traps)) {
    for (const tr of lvl.traps) {
      if (!lvl.explored[tr.y]?.[tr.x]) continue;
      const tx = tr.x * TILE_SIZE;
      const ty = tr.y * TILE_SIZE;
      const warning = tr.phase >= tr.period - 1.45 && tr.phase < tr.period - 0.9;
      const extended = tr.phase >= tr.period - 0.9 && tr.phase < tr.period - 0.22;
      const retracting = tr.phase >= tr.period - 0.22;
      ctx.save();
      if (tr.kind === "void_vent") {
        ctx.fillStyle = "#2e1065";
        ctx.fillRect(tx + 4, ty + 4, TILE_SIZE - 8, TILE_SIZE - 8);
        if (warning) {
          ctx.strokeStyle = "#c084fc";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(tx + 4, ty + 4, TILE_SIZE - 8, TILE_SIZE - 8);
        } else if (extended || retracting) {
          ctx.fillStyle = extended ? "rgba(192, 132, 252, 0.85)" : "rgba(192, 132, 252, 0.45)";
          const tipH = extended ? 4 : 2;
          for (const [ox, oy] of [[9, 9], [20, 9], [9, 20], [20, 20]]) {
            ctx.beginPath();
            ctx.moveTo(tx + ox, ty + oy - tipH);
            ctx.lineTo(tx + ox + 3, ty + oy + 3);
            ctx.lineTo(tx + ox - 3, ty + oy + 3);
            ctx.closePath();
            ctx.fill();
          }
        } else {
          ctx.fillStyle = "#0f172a";
          for (const [ox, oy] of [[10, 10], [21, 10], [10, 21], [21, 21]]) {
            ctx.fillRect(tx + ox - 1, ty + oy - 1, 2, 2);
          }
        }
      } else {
        const spriteKey = extended
          ? "spike_trap_extended"
          : retracting
            ? "spike_trap_retracting"
            : warning
              ? "spike_trap_warning"
              : "spike_trap_retracted";
        const trapImg = assets[spriteKey];
        if (trapImg) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(trapImg, tx, ty, TILE_SIZE, TILE_SIZE);
          if (warning) {
            ctx.globalAlpha = 0.28 + 0.18 * Math.sin(ts * 0.025);
            ctx.strokeStyle = "#f59e0b";
            ctx.lineWidth = 1.5;
            ctx.strokeRect(tx + 1, ty + 1, TILE_SIZE - 2, TILE_SIZE - 2);
          } else if (extended && tr.bloodied) {
            ctx.globalAlpha = 0.85;
            ctx.fillStyle = "#dc2626";
            for (const [bx, by] of [[10, 4], [21, 4], [10, 15], [21, 15]]) {
              ctx.fillRect(tx + bx - 1, ty + by, 2, 3);
            }
          }
        } else {
          ctx.fillStyle = "#1e293b";
          ctx.fillRect(tx + 4, ty + 4, TILE_SIZE - 8, TILE_SIZE - 8);
        }
      }
      ctx.restore();
    }
  }

  // Props (Chests, Trial Chests, Shrines, Anvils, Doors, Breakables, Torches, Wells)
  for (const pr of lvl.props) {
    if (!lvl.explored[pr.y]?.[pr.x]) continue;
    const px = pr.x * TILE_SIZE;
    const py = pr.y * TILE_SIZE;

    if (pr.kind === "shrine") {
      const col = pr.shrineId === "blood" ? "#ef4444" : pr.shrineId === "aegis" ? "#facc15" : "#38bdf8";
      const spriteKey = pr.used
        ? "shrine_depleted"
        : pr.shrineId === "blood"
          ? "shrine_blood"
          : pr.shrineId === "aegis"
            ? "shrine_aegis"
            : "shrine_magic";
      const img = assets[spriteKey];
      ctx.save();
      if (!pr.used) {
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.24 + Math.sin(ts * 0.006) * 0.1;
        ctx.beginPath();
        ctx.arc(px + 16, py + 16, 17, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = pr.used ? 0.88 : 1;
      if (img) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, px - 2, py - 5, 36, 36);
      } else {
        ctx.fillStyle = "#475569";
        ctx.fillRect(px + 8, py + 12, 16, 14);
        ctx.fillStyle = pr.used ? "#64748b" : col;
        ctx.beginPath();
        ctx.arc(px + 16, py + 10, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!pr.used) {
        ctx.globalAlpha = 1;
        ctx.font = "bold 8px sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = col;
        ctx.fillText("SHRINE", px + 16, py - 4);
      }
      ctx.restore();
      continue;
    }

    if (pr.kind === "anvil") {
      ctx.save();
      ctx.fillStyle = "rgba(251, 146, 60, 0.2)";
      ctx.beginPath();
      ctx.arc(px + 16, py + 16, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#334155";
      ctx.fillRect(px + 7, py + 16, 18, 9);
      ctx.fillStyle = "#94a3b8";
      ctx.fillRect(px + 4, py + 11, 24, 6);
      ctx.fillStyle = "#fb923c";
      ctx.font = "bold 8px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("FORGE", px + 16, py - 2);
      ctx.restore();
      continue;
    }

    let img = null;
    if (pr.kind === "chest" || pr.kind === "trial_chest") img = pr.opened ? assets.chest_open : assets.chest_closed;
    else if (pr.kind === "door") img = pr.locked ? assets.door_locked : pr.opened ? assets.door_open : assets.door_closed;
    else if (pr.kind === "crate") img = pr.broken ? assets.crate_damaged : assets.crate_intact;
    else if (pr.kind === "barrel") img = pr.broken ? null : assets.barrel;
    else if (pr.kind === "urn") img = pr.broken ? null : assets.urn;
    else if (pr.kind === "torch") img = assets.torch_stand;
    else if (pr.kind === "well") img = assets.stone_well;

    if (img) {
      if (pr.kind === "trial_chest" && !pr.opened) {
        ctx.save();
        ctx.strokeStyle = `rgba(168, 85, 247, ${0.65 + Math.sin(ts * 0.008) * 0.25})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px + 16, py + 16, 15, 0, Math.PI * 2);
        ctx.stroke();
        ctx.font = "bold 8px sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "#d8b4fe";
        ctx.fillText("TRIAL", px + 16, py - 2);
        ctx.restore();
      }
      if (pr.kind === "door") ctx.drawImage(img, px, py, TILE_SIZE, TILE_SIZE);
      else ctx.drawImage(img, px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
      if (pr.kind === "torch" && lvl.visible[pr.y][pr.x]) {
        const flicker = 0.14 + Math.sin(ts * 0.012 + pr.x) * 0.045;
        const grad = ctx.createRadialGradient(px + 16, py + 10, 2, px + 16, py + 10, 46);
        grad.addColorStop(0, `rgba(251, 146, 60, ${flicker})`);
        grad.addColorStop(1, "rgba(251, 146, 60, 0)");
        ctx.fillStyle = grad;
        ctx.fillRect(px - 30, py - 36, 92, 92);
      }
    }
  }

  // PvP Arena Power-Up Vials (color-coded glass flasks with floating buff label)
  if (s.isPvp && Array.isArray(s.pvpPowerups)) {
    for (const pu of s.pvpPowerups) {
      const vx = (pu.x + 0.5) * TILE_SIZE;
      const vy = (pu.y + 0.5) * TILE_SIZE;
      const bob = Math.sin(ts * 0.0055 + pu.id) * 2.5;
      const inSight = Boolean(lvl.visible[pu.y]?.[pu.x]);
      ctx.save();
      ctx.globalAlpha = inSight ? 1 : 0.58;
      ctx.fillStyle = pu.glow || "rgba(250, 204, 21, 0.32)";
      ctx.beginPath();
      ctx.ellipse(vx, vy + 8, 13, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = pu.color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = (inSight ? 1 : 0.58) * (0.65 + Math.sin(ts * 0.008 + pu.id) * 0.25);
      ctx.beginPath();
      ctx.arc(vx, vy + bob, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = inSight ? 1 : 0.58;

      // Pixel-style potion vial silhouette with dynamic color
      const fy = vy + bob;
      ctx.fillStyle = "#b45309";
      ctx.fillRect(vx - 2.5, fy - 11, 5, 3);
      ctx.fillStyle = "rgba(226, 232, 240, 0.9)";
      ctx.fillRect(vx - 3.5, fy - 8, 7, 3);
      ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(vx, fy + 2, 7.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = pu.color;
      ctx.beginPath();
      ctx.arc(vx, fy + 2.5, 5.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(vx - 2, fy - 5, 4, 4);

      ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
      ctx.fillRect(vx - 4, fy - 1, 2, 4);

      ctx.font = "bold 9px sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#090b10";
      const lbl = pu.label || pu.name || "BUFF";
      ctx.strokeText(lbl, vx, fy - 15);
      ctx.fillStyle = pu.color;
      ctx.fillText(lbl, vx, fy - 15);
      ctx.restore();
    }
  }

  // Shops
  if (Array.isArray(lvl.shops)) {
    const nonBossLeft = lvl.enemies.filter((e) => !e.isBoss && !e.isClone).length;
    const isShopOpen = nonBossLeft === 0;
    for (const shop of lvl.shops) {
      if (!lvl.explored[shop.y]?.[shop.x]) continue;
      const isVis = Boolean(lvl.visible[shop.y]?.[shop.x]);
      const sx = shop.x * TILE_SIZE;
      const sy = shop.y * TILE_SIZE;
      ctx.save();
      ctx.globalAlpha = isVis ? 1 : 0.6;
      ctx.fillStyle = "rgba(250, 204, 21, 0.18)";
      ctx.beginPath();
      ctx.arc(sx + TILE_SIZE / 2, sy + TILE_SIZE / 2, 16, 0, Math.PI * 2);
      ctx.fill();
      if (assets.pirate_idle) drawSheetFrame(ctx, assets.pirate_idle, animFrame, sx - 2, sy - 6, TILE_SIZE + 4, TILE_SIZE + 4);
      ctx.fillStyle = "#78350f";
      ctx.fillRect(sx + 3, sy + TILE_SIZE - 8, TILE_SIZE - 6, 6);
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 3, sy + TILE_SIZE - 8, TILE_SIZE - 6, 6);
      const bob = Math.sin(ts * 0.005) * 1.5;
      ctx.fillStyle = isShopOpen ? "#facc15" : "#fca5a5";
      ctx.font = "bold 9px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(isShopOpen ? "SHOP" : "LOCKED", sx + TILE_SIZE / 2, sy - 3 + bob);
      ctx.restore();
    }
  }

  // NPCs
  for (const npc of lvl.npcs) {
    if (!lvl.visible[npc.y][npc.x]) continue;
    const tpl = NPC_ENCOUNTERS[npc.id];
    drawSheetFrame(ctx, assets[tpl.sprite], animFrame, npc.x * TILE_SIZE - 2, npc.y * TILE_SIZE - 4, TILE_SIZE + 4, TILE_SIZE + 4);
    const bob = Math.sin(ts * 0.006) * 2;
    ctx.fillStyle = "#c4b5fd";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("!", npc.x * TILE_SIZE + TILE_SIZE / 2, npc.y * TILE_SIZE - 3 + bob);
  }

  // Shockwave rings
  for (const rg of s.rings) {
    if ((rg.delay || 0) > 0) continue;
    ctx.save();
    ctx.globalAlpha = Math.max(0, rg.life / rg.maxLife);
    ctx.strokeStyle = rg.color;
    ctx.lineWidth = rg.lineWidth || 2.5;
    ctx.beginPath();
    ctx.arc(rg.x, rg.y, rg.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Pixel-art Ground Impact Decals & Timed Shockwave Sprites
  if (Array.isArray(s.groundDecals)) {
    for (const dc of s.groundDecals) {
      const img = assets[dc.spriteKey];
      if (!img) continue;
      const frac = Math.max(0, dc.life / (dc.maxLife || 0.6));
      const prog = 1 - frac;
      const scale = (dc.scaleStart ?? 1) + ((dc.scaleEnd ?? 1) - (dc.scaleStart ?? 1)) * prog;
      const drawSize = dc.sizePx * scale;
      ctx.save();
      ctx.globalAlpha = Math.min(1, frac * 1.25);
      ctx.imageSmoothingEnabled = false;
      ctx.translate(dc.x, dc.y);
      if (dc.angle) ctx.rotate(dc.angle);
      ctx.drawImage(img, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
      ctx.restore();
    }
  }

  // Enemy Delayed Hazards (Void Acolyte sigils, Boss Phase 2 hazards)
  if (Array.isArray(s.enemyHazards)) {
    for (const hz of s.enemyHazards) {
      const prog = Math.min(1, 1 - Math.max(0, hz.timer) / hz.maxTimer);
      const hx = hz.x * TILE_SIZE;
      const hy = hz.y * TILE_SIZE;
      const radPx = hz.radius * TILE_SIZE;
      ctx.save();
      ctx.strokeStyle = hz.color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(hx, hy, radPx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = hz.color;
      ctx.globalAlpha = 0.14 + prog * 0.25;
      ctx.beginPath();
      ctx.arc(hx, hy, radPx * prog, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Boss telegraphs
  for (const e of lvl.enemies) {
    if (!e.isBoss || !e.bossAction || !s.bossFightStarted) continue;
    const act = e.bossAction;
    const progress = Math.min(1, 1 - Math.max(0, act.timer) / act.duration);
    const ax = act.tx * TILE_SIZE;
    const ay = act.ty * TILE_SIZE;
    const radPx = act.radius * TILE_SIZE;
    ctx.save();
    ctx.strokeStyle = act.color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(ax, ay, radPx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = act.color;
    ctx.globalAlpha = 0.14 + progress * 0.24;
    ctx.beginPath();
    ctx.arc(ax, ay, radPx * progress, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Ground items
  if (Array.isArray(lvl.groundItems)) {
    for (const gItem of lvl.groundItems) {
      const gx = Math.floor(gItem.x);
      const gy = Math.floor(gItem.y);
      if (!lvl.explored[gy]?.[gx]) continue;
      const isVis = Boolean(lvl.visible[gy]?.[gx]);
      const px = gItem.x * TILE_SIZE;
      const py = gItem.y * TILE_SIZE + Math.sin(ts * 0.006 + (gItem.bobPhase || 0)) * 2.5;
      const rInfo = getRarityInfo(gItem.item);
      ctx.save();
      ctx.globalAlpha = isVis ? 1 : 0.55;
      ctx.fillStyle = rInfo.bg;
      ctx.beginPath();
      ctx.arc(px, py, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rInfo.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const iconImg = assets[gItem.item?.icon];
      if (iconImg) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(iconImg, px - 10, py - 10, 20, 20);
      }
      ctx.restore();
    }
  }

  // Boss Key drop
  if (s.bossKeyDrop) {
    const kx = s.bossKeyDrop.x * TILE_SIZE;
    const ky = s.bossKeyDrop.y * TILE_SIZE + Math.sin(ts * 0.007) * 3;
    ctx.save();
    ctx.fillStyle = "rgba(250, 204, 21, 0.25)";
    ctx.beginPath();
    ctx.arc(kx, ky, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(kx - 4, ky, 4, 0, Math.PI * 2);
    ctx.moveTo(kx, ky);
    ctx.lineTo(kx + 8, ky);
    ctx.moveTo(kx + 5, ky);
    ctx.lineTo(kx + 5, ky + 4);
    ctx.moveTo(kx + 8, ky);
    ctx.lineTo(kx + 8, ky + 4);
    ctx.stroke();
    ctx.restore();
  }

  // Enemies
  for (const e of lvl.enemies) {
    if (e.isBoss && (!s.bossFightStarted || s.bossIntroTimer > 0)) continue;
    const ex = Math.floor(e.x);
    const ey = Math.floor(e.y);
    if (!lvl.visible[ey]?.[ex] && !e.falling) continue;

    const cx = e.x * TILE_SIZE;
    const cy = e.y * TILE_SIZE;
    const ez = e.z || 0;
    const size = e.isPvpPlayer ? 40 : e.isBoss ? TILE_SIZE + 10 : e.isElite ? TILE_SIZE + 5 : TILE_SIZE;
    const speedAnim = e.id === "bat" ? 0.014 : 0.008;
    const bob = e.isSheet || ez > 0 ? 0 : Math.sin(ts * speedAnim + e.bobPhase) * (e.id === "bat" ? 4 : 2.2);
    const squash = e.id === "slime" ? 1 + Math.sin(ts * 0.01 + e.bobPhase) * 0.1 : 1;

    if (e.isPvpPlayer) {
      ctx.save();
      ctx.strokeStyle = "rgba(239, 68, 68, 0.78)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy + 12, 13, 6, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (e.isElite && e.eliteColor) {
      ctx.save();
      ctx.strokeStyle = e.eliteColor;
      ctx.globalAlpha = 0.6 + Math.sin(ts * 0.01) * 0.25;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.56, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (ez > 0) {
      ctx.save();
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      const sc = Math.max(0.4, 1 - ez / 150);
      ctx.beginPath();
      ctx.ellipse(cx, cy + 14, 15 * sc, 6 * sc, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const drawW = size * squash * (e.drawScale || 1);
    const drawH = (size / squash) * (e.drawScale || 1);
    const dx = cx - drawW / 2;
    const dy = cy - drawH / 2 + bob - ez - (e.isBoss ? 3 : 0);

    ctx.save();
    if (e.isClone) ctx.globalAlpha = 0.72;
    if (e.isSheet) {
      let spriteKey = e.sprite;
      if (e.anim === "attack" && e.attackSprite) spriteKey = e.attackSprite;
      else if (e.anim === "walk" && e.walkSprite) spriteKey = e.walkSprite;
      drawSheetFrame(ctx, assets[spriteKey] || assets[e.sprite], animFrame, dx, dy, drawW, drawH, e.facingLeft);
    } else if (assets[e.sprite]) {
      if (e.facingLeft && e.id !== "slime") {
        ctx.translate(dx + drawW, dy);
        ctx.scale(-1, 1);
        ctx.drawImage(assets[e.sprite], 0, 0, drawW, drawH);
      } else {
        ctx.drawImage(assets[e.sprite], dx, dy, drawW, drawH);
      }
    }
    ctx.restore();

    if (e.role === "shielded" && (e.stunTimer || 0) <= 0 && (e.frozenTimer || 0) <= 0 && (e.sunderTimer || 0) <= 0) {
      ctx.save();
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 2.5;
      const startA = e.facingLeft ? Math.PI * 0.65 : -Math.PI * 0.35;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.52, startA, startA + Math.PI * 0.7);
      ctx.stroke();
      ctx.restore();
    }

    if ((e.reflectTimer || 0) > 0) {
      ctx.save();
      ctx.strokeStyle = `rgba(253, 224, 71, ${0.65 + Math.sin(ts * 0.014) * 0.25})`;
      ctx.fillStyle = "rgba(250, 204, 21, 0.14)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    if (e.isPvpPlayer && (e.manaShieldTimer || 0) > 0 && assets.vfx_mana_shield) {
      const meta = VFX_SHEET_META.vfx_mana_shield;
      const mFrame = Math.floor(ts / 55) % meta.frames;
      ctx.save();
      ctx.globalAlpha = 0.78;
      drawGridVfxFrame(ctx, assets.vfx_mana_shield, meta, mFrame, cx - 28, cy - 28 - ez, 56, 54);
      ctx.restore();
    }
    if (e.isPvpPlayer) {
      drawEntityChargesAndAuras(ctx, assets, ts, e);
    }

    if ((e.frozenTimer || 0) > 0) {
      ctx.save();
      if (assets.vfx_frozen_crystal) {
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = e.frozenTimer < 0.3 ? Math.max(0.45, e.frozenTimer / 0.3) : 0.92;
        const fz = size * 1.18;
        ctx.drawImage(assets.vfx_frozen_crystal, cx - fz / 2, cy - fz / 2 - ez, fz, fz);
      } else {
        ctx.fillStyle = "rgba(125, 211, 252, 0.42)";
        ctx.strokeStyle = "#e0f2fe";
        ctx.lineWidth = 2;
        const r = size * 0.44;
        ctx.beginPath();
        ctx.moveTo(cx, cy - r * 1.15);
        ctx.lineTo(cx + r * 0.85, cy - r * 0.25);
        ctx.lineTo(cx + r * 0.65, cy + r * 0.9);
        ctx.lineTo(cx - r * 0.65, cy + r * 0.9);
        ctx.lineTo(cx - r * 0.85, cy - r * 0.25);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    } else if (e.hurtTimer > 0) {
      ctx.save();
      ctx.fillStyle = "rgba(255, 255, 255, 0.36)";
      ctx.beginPath();
      ctx.ellipse(cx, cy - ez, size * 0.32, size * 0.38, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (e.chilled > 0) {
      ctx.save();
      ctx.strokeStyle = "rgba(125, 211, 252, 0.85)";
      ctx.fillStyle = "rgba(56, 189, 248, 0.18)";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.ellipse(cx, cy + size * 0.36, size * 0.38, size * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      for (let k = 0; k < 3; k++) {
        const a = ts * 0.005 + (k * Math.PI * 2) / 3;
        ctx.fillStyle = "#e0f2fe";
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * size * 0.34, cy - ez + Math.sin(a) * size * 0.16, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    if (e.windupTimer > 0) {
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.45, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (e.stunTimer > 0) {
      const spin = ts * 0.008;
      ctx.save();
      ctx.strokeStyle = "#facc15";
      ctx.fillStyle = "#fef08a";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.ellipse(cx, cy - size * 0.52, 10, 4, 0, 0, Math.PI * 2);
      ctx.stroke();
      for (let st = 0; st < 3; st++) {
        const a = spin + (st * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * 10, cy - size * 0.52 + Math.sin(a) * 4, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    const hpPct = Math.max(0, e.hp / e.maxHp);
    const barW = e.isPvpPlayer ? 36 : e.isBoss ? 36 : e.isElite ? 30 : 26;
    ctx.fillStyle = "#111";
    ctx.fillRect(cx - barW / 2, cy - size / 2 - 6, barW, 4);
    ctx.fillStyle = e.isPvpPlayer ? "#f87171" : e.isBoss ? "#facc15" : e.isElite ? e.eliteColor : "#ef4444";
    ctx.fillRect(cx - barW / 2, cy - size / 2 - 6, barW * hpPct, 4);
    if (e.isPvpPlayer) {
      ctx.save();
      ctx.font = "bold 9px sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#000";
      ctx.fillText(e.name || "Rival", cx + 1, cy - size / 2 - 9);
      ctx.fillStyle = "#fca5a5";
      ctx.fillText(e.name || "Rival", cx, cy - size / 2 - 10);
      ctx.restore();
    }
  }

  // Hero Rendering (Arcane Archmage, Gilded Knight, and Sylvan Ranger all matched at heroDrawSize = 40)
  const p = s.player;
  const heroPrefix =
    p.heroClass === "mage"
      ? "mage"
      : p.heroClass === "ranger" || p.heroClass === "soldier"
        ? "ranger"
        : "gilded";
  const heroDrawSize = 40;

  for (const aft of s.afterimages) {
    const aftPrefix = aft.heroClass
      ? (aft.heroClass === "mage" ? "mage" : aft.heroClass === "ranger" || aft.heroClass === "soldier" ? "ranger" : "gilded")
      : heroPrefix;
    ctx.save();
    ctx.globalAlpha = (aft.life / aft.maxLife) * 0.45;
    drawSheetFrame(
      ctx,
      assets[`${aftPrefix}_walk`] || assets[`${aftPrefix}_idle`] || assets.gilded_idle,
      aft.frame,
      aft.x * TILE_SIZE - heroDrawSize / 2,
      aft.y * TILE_SIZE - heroDrawSize / 2 - 2,
      heroDrawSize,
      heroDrawSize,
      aft.facingLeft
    );
    ctx.restore();
  }

  const pz = p.z || 0;
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.42)";
  const shadowScale = Math.max(0.45, 1 - pz / 90);
  ctx.beginPath();
  ctx.ellipse(p.x * TILE_SIZE, p.y * TILE_SIZE + 12, 11 * shadowScale, 5 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const pSheet = assets[`${heroPrefix}_${p.anim}`] || assets[`${heroPrefix}_idle`] || assets.gilded_idle;
  ctx.save();
  if (p.iFrames > 0 && !p.leap && Math.floor(ts / 60) % 2 === 0) ctx.globalAlpha = 0.55;
  drawSheetFrame(
    ctx,
    pSheet,
    animFrame,
    p.x * TILE_SIZE - heroDrawSize / 2,
    p.y * TILE_SIZE - heroDrawSize / 2 - 2 - pz,
    heroDrawSize,
    heroDrawSize,
    p.facingLeft
  );
  ctx.restore();

  if ((p.manaShieldTimer || 0) > 0 && assets.vfx_mana_shield) {
    const meta = VFX_SHEET_META.vfx_mana_shield;
    const mFrame = Math.floor(ts / 55) % meta.frames;
    ctx.save();
    ctx.globalAlpha = Math.min(0.84, (p.manaShieldTimer < 0.8 ? p.manaShieldTimer / 0.8 : 1) * 0.82);
    drawGridVfxFrame(ctx, assets.vfx_mana_shield, meta, mFrame, p.x * TILE_SIZE - 28, p.y * TILE_SIZE - 28 - pz, 56, 54);
    ctx.restore();
  }

  if ((p.frozenTimer || 0) > 0 && assets.vfx_frozen_crystal) {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.88;
    ctx.drawImage(assets.vfx_frozen_crystal, p.x * TILE_SIZE - 22, p.y * TILE_SIZE - 22 - pz, 44, 44);
    ctx.restore();
  }

  if ((p.stunTimer || 0) > 0) {
    const spin = ts * 0.01;
    const pcx = p.x * TILE_SIZE;
    const pcy = p.y * TILE_SIZE - 22 - pz;
    ctx.save();
    ctx.strokeStyle = "#facc15";
    ctx.fillStyle = "#fef08a";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.ellipse(pcx, pcy, 10, 4, 0, 0, Math.PI * 2);
    ctx.stroke();
    for (let st = 0; st < 3; st++) {
      const a = spin + (st * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc(pcx + Math.cos(a) * 10, pcy + Math.sin(a) * 4, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  if (!s.runEnded && s.dyingTimer <= 0) {
    const ang = getAimAngle();
    const orbit = 21;
    const ax = p.x * TILE_SIZE + Math.cos(ang) * orbit;
    const ay = p.y * TILE_SIZE + Math.sin(ang) * orbit - pz * 0.5;
    if (touchAim.active) {
      const wCat = getWeaponCategory(p.equipment?.weapon);
      const sightTiles = wCat === "melee" ? 1.7 : 5.5;
      const sightColor = wCat === "wand" ? "rgba(96, 165, 250, 0.55)" : wCat === "bow" ? "rgba(74, 222, 128, 0.55)" : "rgba(248, 113, 113, 0.55)";
      ctx.save();
      ctx.strokeStyle = sightColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(p.x * TILE_SIZE, p.y * TILE_SIZE);
      ctx.lineTo((p.x + Math.cos(ang) * sightTiles) * TILE_SIZE, (p.y + Math.sin(ang) * sightTiles) * TILE_SIZE);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc((p.x + Math.cos(ang) * sightTiles) * TILE_SIZE, (p.y + Math.sin(ang) * sightTiles) * TILE_SIZE, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(ang);
    ctx.fillStyle = heroPrefix === "mage" ? "#c084fc" : heroPrefix === "ranger" ? "#4ade80" : "#38bdf8";
    ctx.strokeStyle = "#0c0e14";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-4, -5);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }

  // Slashes (3-Frame Holy Gold & Steel/Cyan Pixel-Art Sprites)
  for (const sl of s.slashes) {
    const maxL = Math.max(0.01, sl.maxLife || 0.21);
    const t = Math.max(0, Math.min(1, 1 - sl.life / maxL));
    const variant = sl.variant || (sl.color === "#38bdf8" ? "steel_cyan" : "gold");
    const baseSize = (sl.radius || 38) * 2.55;
    let img = null;
    let scale = 1;
    let alpha = 1;
    let angOffset = 0;

    if (variant === "steel_cyan") {
      img = assets.melee_slash_steel_cyan;
      if (t < 0.22) {
        scale = 0.88 + (t / 0.22) * 0.14;
        angOffset = -0.16 * (1 - t / 0.22);
        alpha = 0.95;
      } else if (t < 0.72) {
        scale = 1.04;
        alpha = 1;
      } else {
        const ft = (t - 0.72) / 0.28;
        scale = 1.04 + ft * 0.08;
        angOffset = ft * 0.1;
        alpha = Math.max(0.08, 1 - ft * 0.9);
      }
    } else {
      if (t < 0.26) {
        img = assets.melee_slash_frame1;
        scale = 0.95 + (t / 0.26) * 0.08;
        angOffset = -0.14 * (1 - t / 0.26);
        alpha = 0.96;
      } else if (t < 0.72) {
        img = assets.melee_slash_gold;
        scale = 1.05;
        alpha = 1;
      } else {
        img = assets.melee_slash_frame3;
        const ft = (t - 0.72) / 0.28;
        scale = 1.05 + ft * 0.06;
        angOffset = ft * 0.08;
        alpha = Math.max(0.12, 1 - ft * 0.85);
      }
    }

    ctx.save();
    if (img) {
      ctx.translate(sl.x, sl.y);
      ctx.rotate(sl.angle + angOffset);
      if (sl.flipY) ctx.scale(1, -1);
      ctx.globalAlpha = alpha;
      ctx.imageSmoothingEnabled = false;
      const sz = baseSize * scale;
      ctx.drawImage(img, -sz / 2, -sz / 2, sz, sz);
    } else {
      const sweepStart = sl.angle - 1.15 + t * 0.75;
      const sweepEnd = sl.angle - 0.35 + t * 1.55;
      const rad = 26 + t * 14;
      ctx.globalAlpha = Math.max(0, (1 - t) * 0.95);
      ctx.strokeStyle = sl.color;
      ctx.lineWidth = 7 * (1 - t * 0.45);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(sl.x, sl.y, rad, sweepStart, sweepEnd);
      ctx.stroke();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.5 * (1 - t * 0.5);
      ctx.beginPath();
      ctx.arc(sl.x, sl.y, rad + 2, sweepStart + 0.15, sweepEnd);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Projectiles
  for (const pr of s.projectiles) {
    ctx.save();
    ctx.translate(pr.x * TILE_SIZE, pr.y * TILE_SIZE);
    if (!pr.isEnemy || pr.isPvpVisual) {
      const ang = Math.atan2(pr.vy, pr.vx);
      ctx.rotate(ang);
      const sheetSpec = pr.projKind ? PROJ_SHEET_MAP[pr.projKind] : null;
      const sheetImg = sheetSpec ? assets[sheetSpec.key] : null;
      const sheetMeta = sheetSpec ? VFX_SHEET_META[sheetSpec.key] : null;
      if (sheetImg && sheetMeta) {
        const elapsed = Math.max(0, (pr.maxLife || 0.7) - pr.life);
        const fIdx = Math.floor(elapsed * 24) % sheetMeta.frames;
        const boost = pr.projKind === "arcane_orb" && pr.pierce ? 1.2 : 1;
        const dw = sheetSpec.dw * boost;
        const dh = sheetSpec.dh * boost;
        drawGridVfxFrame(ctx, sheetImg, sheetMeta, fIdx, -dw * 0.55, -dh / 2, dw, dh);
      } else if (pr.isArrow && assets.arrow_proj) {
        if (pr.fireTrail || pr.pierce) {
          ctx.fillStyle = pr.pierce ? "rgba(74, 222, 128, 0.35)" : "rgba(250, 204, 21, 0.35)";
          ctx.beginPath();
          ctx.arc(0, 0, 9, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.drawImage(assets.arrow_proj, -12, -12, 24, 24);
      } else if (pr.isSlashWave) {
        const lifeFrac = Math.max(0.25, pr.life / (pr.maxLife || 0.6));
        const rad = Math.max(24, pr.radius * TILE_SIZE);
        ctx.globalAlpha = Math.min(1, lifeFrac + 0.25);
        if (assets.vfx_radiant_wave) {
          ctx.imageSmoothingEnabled = false;
          ctx.scale(-1, 1);
          const sz = rad * 2.2;
          ctx.drawImage(assets.vfx_radiant_wave, -sz * 0.45, -sz / 2, sz, sz);
        } else {
          ctx.strokeStyle = "#f97316";
          ctx.lineWidth = 11;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.arc(-10, 0, rad, -1.08, 1.08);
          ctx.stroke();
          ctx.strokeStyle = "#facc15";
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.arc(-6, 0, rad, -1.0, 1.0);
          ctx.stroke();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(-3, 0, rad, -0.92, 0.92);
          ctx.stroke();
        }
      } else if (pr.isMagicOrb) {
        const rad = pr.radius * TILE_SIZE;
        ctx.globalAlpha = 0.32;
        ctx.fillStyle = pr.color;
        ctx.beginPath();
        ctx.arc(0, 0, rad * 1.65, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = pr.color;
        ctx.beginPath();
        ctx.arc(0, 0, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(1.5, -1, rad * 0.45, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = pr.color;
        ctx.beginPath();
        ctx.moveTo(12, 0);
        ctx.lineTo(-8, -4);
        ctx.lineTo(-4, 0);
        ctx.lineTo(-8, 4);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      ctx.fillStyle = pr.color;
      ctx.beginPath();
      ctx.arc(0, 0, pr.radius * TILE_SIZE, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Frost zones
  if (s.frostZones?.length) {
    for (const z of s.frostZones) {
      const fade = Math.min(1, z.timer / 0.6);
      const zx = z.x * TILE_SIZE;
      const zy = z.y * TILE_SIZE;
      const radPx = z.radius * TILE_SIZE;
      ctx.save();
      ctx.globalAlpha = fade * 0.92;
      ctx.fillStyle = "rgba(56, 189, 248, 0.14)";
      ctx.beginPath();
      ctx.arc(zx, zy, radPx, 0, Math.PI * 2);
      ctx.fill();
      if (assets.vfx_frost_zone) {
        ctx.imageSmoothingEnabled = false;
        ctx.translate(zx, zy);
        ctx.rotate(ts * 0.00055);
        const sz = radPx * 2.08;
        ctx.drawImage(assets.vfx_frost_zone, -sz / 2, -sz / 2, sz, sz);
      } else {
        ctx.strokeStyle = `rgba(186, 230, 253, ${0.55 + Math.sin(ts * 0.012) * 0.2})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Siege Barrage (Rain Storm) zones & falling volley
  if (s.arrowStorms?.length) {
    for (const st of s.arrowStorms) {
      const sx = st.x * TILE_SIZE;
      const sy = st.y * TILE_SIZE;
      const radPx = st.radius * TILE_SIZE;
      ctx.save();
      if (assets.vfx_arrow_storm_reticle) {
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = 0.85 + Math.sin(ts * 0.012) * 0.12;
        ctx.translate(sx, sy);
        ctx.rotate(ts * 0.0008);
        const sz = radPx * 2.08;
        ctx.drawImage(assets.vfx_arrow_storm_reticle, -sz / 2, -sz / 2, sz, sz);
      } else {
        ctx.strokeStyle = `rgba(250, 204, 21, ${0.45 + Math.sin(ts * 0.015) * 0.2})`;
        ctx.fillStyle = "rgba(250, 204, 21, 0.08)";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.arc(sx, sy, radPx, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  if (s.fallingArrows?.length) {
    for (const fa of s.fallingArrows) {
      const t = 1 - Math.max(0, fa.life / fa.maxLife);
      const cx = fa.x + (fa.targetX - fa.x) * t;
      const cy = fa.y + (fa.targetY - fa.y) * t;
      ctx.save();
      ctx.globalAlpha = Math.min(1, (1 - t * 0.25) * 0.95);
      if (assets.vfx_arrow_storm_volley) {
        ctx.imageSmoothingEnabled = false;
        const sz = fa.sizePx || 88;
        ctx.drawImage(assets.vfx_arrow_storm_volley, cx - sz / 2, cy - sz / 2, sz, sz);
      } else if (assets.arrow_proj) {
        const ang = Math.atan2(fa.targetY - fa.y, fa.targetX - fa.x);
        ctx.translate(cx, cy);
        ctx.rotate(ang);
        ctx.drawImage(assets.arrow_proj, -11, -11, 22, 22);
      }
      ctx.restore();
    }
  }

  for (const bm of s.beams) {
    const alpha = Math.max(0, bm.life / bm.maxLife);
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha * 1.15);
    if (assets.vfx_holy_beam) {
      ctx.imageSmoothingEnabled = false;
      const bw = 42 * alpha + 18;
      const bh = 176;
      ctx.drawImage(assets.vfx_holy_beam, bm.x - bw / 2, bm.y - bh + 6, bw, bh);
    } else {
      const w = 18 * alpha + 6;
      const grad = ctx.createLinearGradient(bm.x - w / 2, bm.y - 160, bm.x + w / 2, bm.y);
      grad.addColorStop(0, "rgba(253, 224, 71, 0)");
      grad.addColorStop(0.5, bm.color);
      grad.addColorStop(1, "#ffffff");
      ctx.fillStyle = grad;
      ctx.fillRect(bm.x - w / 2, bm.y - 160, w, 160);
    }
    ctx.restore();
  }

  if (s.pendingMeteors?.length) {
    for (const pm of s.pendingMeteors) {
      const prog = Math.max(0, Math.min(1, 1 - pm.timer / (pm.maxTimer || 0.26)));
      const radPx = pm.rad * TILE_SIZE;
      const mx = pm.x * TILE_SIZE;
      const my = pm.y * TILE_SIZE;
      ctx.save();
      ctx.strokeStyle = `rgba(251, 146, 60, ${0.45 + prog * 0.5})`;
      ctx.fillStyle = `rgba(249, 115, 22, ${0.1 + prog * 0.18})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(mx, my, radPx, radPx * 0.65, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "#fde047";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(mx, my, radPx * Math.max(0.12, 1 - prog), radPx * 0.65 * Math.max(0.12, 1 - prog), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  if (s.vfxAnims?.length) {
    for (const va of s.vfxAnims) {
      const sheet = assets[va.sheetKey];
      const meta = VFX_SHEET_META[va.sheetKey];
      if (!sheet || !meta) continue;
      const maxL = Math.max(0.01, va.maxLife || 0.5);
      const t = Math.max(0, Math.min(0.999, 1 - va.life / maxL));
      const frameIdx = Math.min(meta.frames - 1, Math.floor(t * meta.frames));
      const sc = (va.scaleStart || 1) + ((va.scaleEnd || 1) - (va.scaleStart || 1)) * t;
      const dw = (va.sizePx || 64) * sc;
      const dh = meta.fw === meta.fh ? dw : dw * (meta.fh / meta.fw);
      const fade = va.life < 0.08 ? va.life / 0.08 : 1;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, (va.alpha ?? 1) * fade));
      ctx.translate(va.x, va.y);
      if (va.angle) ctx.rotate(va.angle);
      if (va.flipX) ctx.scale(-1, 1);
      drawGridVfxFrame(
        ctx,
        sheet,
        meta,
        frameIdx,
        -dw * (va.anchorX ?? 0.5),
        -dh * (va.anchorY ?? 0.5),
        dw,
        dh
      );
      ctx.restore();
    }
  }

  drawEntityChargesAndAuras(ctx, assets, ts, p);

  for (const pt of s.particles) {
    ctx.fillStyle = pt.color;
    ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
    ctx.fillRect(pt.x, pt.y, pt.size, pt.size);
    ctx.globalAlpha = 1;
  }

  ctx.font = "bold 12px sans-serif";
  ctx.textAlign = "center";
  for (const ft of s.floatingTexts) {
    ctx.globalAlpha = Math.min(1, (ft.life / ft.maxLife) * 1.4);
    ctx.fillStyle = "#000";
    ctx.fillText(ft.text, ft.x + 1, ft.y + 1);
    ctx.fillStyle = ft.color;
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.globalAlpha = 1;
  }

  const ni = runtime.nearbyInteractable;
  if (ni && !modalOpen && !s.runEnded) {
    ctx.save();
    ctx.strokeStyle = ni.color || "#facc15";
    ctx.globalAlpha = 0.65 + Math.sin(ts * 0.009) * 0.25;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ni.x * TILE_SIZE, ni.y * TILE_SIZE, 16 + Math.sin(ts * 0.009) * 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (mouse.inside && mouse.x !== null && !modalOpen && !s.runEnded) {
    ctx.save();
    ctx.strokeStyle = "rgba(250, 204, 21, 0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(mouse.x * TILE_SIZE, mouse.y * TILE_SIZE, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();

  if (s.isPvp && (s.pvpIntroTimer || 0) > 0) {
    const showThreshold = (s.pvpRound || 1) > 1 ? 3.05 : 1.55;
    if (s.pvpIntroTimer <= showThreshold) {
      const num = (s.pvpRound || 1) > 1
        ? Math.max(1, Math.min(3, Math.ceil(s.pvpIntroTimer)))
        : Math.max(1, Math.min(3, Math.ceil(s.pvpIntroTimer * 2)));
      const label = String(num);
      ctx.save();
      ctx.fillStyle = "rgba(6, 8, 15, 0.35)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const pulse = 1 + Math.sin(ts * 0.02) * 0.08;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.scale(pulse, pulse);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.strokeStyle = "#090b10";
      ctx.lineWidth = 8;
      ctx.font = "900 18px system-ui, sans-serif";
      const roundHeader = `ROUND ${s.pvpRound || 1}`;
      ctx.strokeText(roundHeader, 0, -56);
      ctx.fillStyle = "#38bdf8";
      ctx.fillText(roundHeader, 0, -56);

      ctx.font = "900 72px system-ui, sans-serif";
      ctx.strokeText(label, 0, -4);
      ctx.fillStyle = "#fde047";
      ctx.fillText(label, 0, -4);

      ctx.font = "800 18px system-ui, sans-serif";
      ctx.strokeText("GET READY!", 0, 48);
      ctx.fillStyle = "#e2e8f0";
      ctx.fillText("GET READY!", 0, 48);
      ctx.restore();
    }
  } else if (s.isPvp && s.pvpRoundEnded && s.pvpRoundBanner) {
    ctx.save();
    ctx.fillStyle = "rgba(6, 8, 15, 0.45)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "#090b10";
    ctx.lineWidth = 8;
    ctx.font = "900 34px system-ui, sans-serif";
    ctx.strokeText(s.pvpRoundBanner.title, 0, -14);
    ctx.fillStyle = s.pvpRoundBanner.color || "#fde047";
    ctx.fillText(s.pvpRoundBanner.title, 0, -14);

    ctx.font = "700 16px system-ui, sans-serif";
    ctx.lineWidth = 4;
    ctx.strokeText(s.pvpRoundBanner.sub, 0, 24);
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText(s.pvpRoundBanner.sub, 0, 24);
    ctx.restore();
  }

  const pAnimSheet = assets[`${heroPrefix}_${p.anim}`] || assets[`${heroPrefix}_idle`] || assets.gilded_idle;
  portraitCtx.clearRect(0, 0, 64, 64);
  portraitCtx.imageSmoothingEnabled = false;
  drawSheetFrame(portraitCtx, pAnimSheet, animFrame, 4, 4, 56, 56);
  if (mobilePortraitCtx) {
    mobilePortraitCtx.clearRect(0, 0, 44, 44);
    mobilePortraitCtx.imageSmoothingEnabled = false;
    drawSheetFrame(mobilePortraitCtx, pAnimSheet, animFrame, 2, 2, 40, 40);
  }
  if (s.isPvp) {
    const p1HudCvs = document.getElementById("pvp-hud-p1-portrait");
    const p2HudCvs = document.getElementById("pvp-hud-p2-portrait");
    const opp = s.pvpOpponent;
    const oppPrefix = opp?.heroClass === "mage" ? "mage" : opp?.heroClass === "ranger" ? "ranger" : "gilded";
    const oppSheet = opp ? (assets[`${oppPrefix}_${opp.anim || "idle"}`] || assets[`${oppPrefix}_idle`] || assets.gilded_idle) : null;
    const leftSheet = s.pvpMySlot === 1 ? oppSheet : pAnimSheet;
    const rightSheet = s.pvpMySlot === 1 ? pAnimSheet : oppSheet;
    if (p1HudCvs && leftSheet) {
      const c1 = p1HudCvs.getContext("2d");
      c1.clearRect(0, 0, 44, 44);
      c1.imageSmoothingEnabled = false;
      drawSheetFrame(c1, leftSheet, animFrame, 2, 2, 40, 40, false);
    }
    if (p2HudCvs && rightSheet) {
      const c2 = p2HudCvs.getContext("2d");
      c2.clearRect(0, 0, 44, 44);
      c2.imageSmoothingEnabled = false;
      drawSheetFrame(c2, rightSheet, animFrame, 2, 2, 40, 40, true);
    }
  }
  if (!renderMinimap._lastTs || ts - renderMinimap._lastTs >= 150) {
    renderMinimap._lastTs = ts;
    renderMinimap();
  }
}

/** Render active skill charges, telegraphs, and buffs for either the local hero or a PvP rival. */
function drawEntityChargesAndAuras(ctx, assets, ts, entity) {
  const ez = entity.z || 0;
  if (entity.radiantCharge) {
    const rc = entity.radiantCharge;
    const prog = Math.min(1, 1 - rc.timer / rc.duration);
    const pxCenter = entity.x * TILE_SIZE;
    const pyCenter = entity.y * TILE_SIZE;
    ctx.save();
    ctx.strokeStyle = `rgba(251, 146, 60, ${0.4 + prog * 0.45})`;
    ctx.fillStyle = `rgba(250, 204, 21, ${0.08 + prog * 0.14})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pxCenter, pyCenter, 28 - prog * 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.translate(pxCenter, pyCenter);
    if (assets.vfx_ground_slam_shockwave) {
      ctx.imageSmoothingEnabled = false;
      ctx.rotate(rc.angle - Math.PI / 2);
      const sz = 44 + prog * 36;
      ctx.globalAlpha = 0.55 + prog * 0.45;
      ctx.drawImage(assets.vfx_ground_slam_shockwave, -sz / 2, -sz * 0.15, sz, sz);
    } else {
      const arcRad = 22 + prog * 14;
      ctx.rotate(rc.angle);
      ctx.strokeStyle = `rgba(249, 115, 22, ${0.5 + prog * 0.5})`;
      ctx.lineWidth = 5 + prog * 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(6, 0, arcRad, -1.05, 1.05);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (entity.ultCharge) {
    const uc = entity.ultCharge;
    const prog = Math.min(1, 1 - uc.timer / uc.duration);
    const radTiles = uc.radius ?? uc.spell?.radii?.[uc.rankIdx] ?? 2.8;
    const radPx = radTiles * TILE_SIZE;
    const pxCenter = entity.x * TILE_SIZE;
    const pyCenter = entity.y * TILE_SIZE;
    ctx.save();
    ctx.strokeStyle = `rgba(251, 191, 36, ${0.45 + Math.sin(ts * 0.015) * 0.25})`;
    ctx.fillStyle = `rgba(251, 191, 36, ${0.08 + prog * 0.14})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(pxCenter, pyCenter, radPx, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const gatherImg = assets.charging_ground_sigil || assets.vfx_holy_ground_impact;
    if (gatherImg) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 0.6 + prog * 0.35;
      ctx.translate(pxCenter, pyCenter);
      ctx.rotate(ts * 0.0006);
      const fullSz = radPx * 2.08;
      ctx.drawImage(gatherImg, -fullSz / 2, -fullSz / 2, fullSz, fullSz);
      ctx.restore();
    }
    ctx.strokeStyle = "#fef08a";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(pxCenter, pyCenter, radPx * prog, 0, Math.PI * 2);
    ctx.stroke();

    const lift = 28 + Math.sin(prog * Math.PI * 0.5) * 10;
    const sy = pyCenter - lift - ez;
    const swordKey = prog < 0.4 ? "charging_sword_stage1" : prog < 0.8 ? "charging_sword_stage2" : "charging_sword_max";
    const swordImg = assets[swordKey];
    if (swordImg) {
      ctx.imageSmoothingEnabled = false;
      const pulse = prog >= 0.8 ? 1 + Math.sin(ts * 0.025) * 0.08 : 1;
      const sz = 52 * pulse;
      ctx.drawImage(swordImg, pxCenter + (entity.facingLeft ? -4 : 4) - sz / 2, sy - sz * 0.62, sz, sz);
    } else {
      ctx.translate(pxCenter + (entity.facingLeft ? -4 : 4), sy);
      ctx.fillStyle = "#fef9c3";
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -28);
      ctx.lineTo(4, -6);
      ctx.lineTo(-4, -6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  if (entity.valiantCharge) {
    const vc = entity.valiantCharge;
    const ang = Math.atan2(vc.dirY, vc.dirX);
    const sx = vc.startX * TILE_SIZE;
    const sy = vc.startY * TILE_SIZE;
    const spearMaxPx = (vc.spearDistMax || 1.65) * TILE_SIZE;
    const spearEx = sx + Math.cos(ang) * spearMaxPx;
    const spearEy = sy + Math.sin(ang) * spearMaxPx;
    const markX = vc.travelDist > 0.5 ? vc.targetX * TILE_SIZE : spearEx;
    const markY = vc.travelDist > 0.5 ? vc.targetY * TILE_SIZE : spearEy;

    if (vc.phase === "windup") {
      const prog = Math.min(1, 1 - vc.timer / vc.windupDur);
      const eased = 1 - Math.pow(1 - prog, 2.2);
      const spearLen = (0.65 + ((vc.spearDistMax || 1.65) - 0.65) * eased) * TILE_SIZE;
      const tipX = sx + Math.cos(ang) * spearLen;
      const tipY = sy + Math.sin(ang) * spearLen;

      ctx.save();
      ctx.strokeStyle = `rgba(56, 189, 248, ${0.35 + prog * 0.3})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(markX, markY);
      ctx.stroke();

      ctx.setLineDash([]);
      if (assets.vfx_spear_impact_crater) {
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = 0.55 + prog * 0.45;
        ctx.translate(markX, markY);
        ctx.rotate(ts * 0.003);
        const reticleSz = 42 + (1 - eased) * 16;
        ctx.drawImage(assets.vfx_spear_impact_crater, -reticleSz / 2, -reticleSz / 2, reticleSz, reticleSz);
        ctx.restore();
      } else {
        ctx.strokeStyle = `rgba(250, 204, 21, ${0.5 + prog * 0.45})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(markX, markY, 11 + (1 - eased) * 10, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (assets.vfx_spear_charge_lunge) {
        ctx.imageSmoothingEnabled = false;
        ctx.translate(sx, sy);
        ctx.rotate(ang - Math.PI / 2);
        const wPx = 42;
        ctx.drawImage(assets.vfx_spear_charge_lunge, 0, 0, 128, 316, -wPx / 2, 0, wPx, spearLen + 4);
      } else {
        const grad = ctx.createLinearGradient(sx, sy, tipX, tipY);
        grad.addColorStop(0, "rgba(56, 189, 248, 0.25)");
        grad.addColorStop(0.55, "rgba(250, 204, 21, 0.85)");
        grad.addColorStop(1, "#ffffff");
        ctx.strokeStyle = grad;
        ctx.lineWidth = 7;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();
      }
      ctx.restore();
    } else {
      const hx = entity.x * TILE_SIZE;
      const hy = entity.y * TILE_SIZE;
      const wakeGrad = ctx.createLinearGradient(sx, sy, hx, hy);
      wakeGrad.addColorStop(0, "rgba(56, 189, 248, 0.15)");
      wakeGrad.addColorStop(0.5, "rgba(56, 189, 248, 0.65)");
      wakeGrad.addColorStop(1, "rgba(250, 204, 21, 0.95)");

      ctx.save();
      if (assets.vfx_spear_impact_crater) {
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = 0.85;
        ctx.translate(markX, markY);
        ctx.rotate(ts * 0.004);
        ctx.drawImage(assets.vfx_spear_impact_crater, -22, -22, 44, 44);
        ctx.restore();
      }

      ctx.strokeStyle = wakeGrad;
      ctx.lineWidth = 12;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(hx, hy);
      ctx.stroke();

      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(hx, hy);
      ctx.stroke();

      if (assets.vfx_spear_charge_lunge) {
        ctx.imageSmoothingEnabled = false;
        const remPx = Math.max(16, Math.hypot(markX - hx, markY - hy));
        const lenPx = Math.min(54, remPx + 14);
        const wPx = 30;
        ctx.translate(hx, hy - ez * 0.5);
        ctx.rotate(ang - Math.PI / 2);
        ctx.drawImage(assets.vfx_spear_charge_lunge, 0, 0, 128, 316, -wPx / 2, -6, wPx, lenPx);
      } else {
        ctx.translate(hx, hy - ez * 0.5);
        ctx.rotate(ang);
        ctx.fillStyle = "#fde047";
        ctx.beginPath();
        ctx.moveTo(28, 0);
        ctx.lineTo(4, -9);
        ctx.lineTo(4, 9);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  if (entity.leap) {
    const radTiles = entity.leap.radius ?? entity.leap.spell?.radii?.[entity.leap.rankIdx] ?? 2.8;
    const radPx = radTiles * TILE_SIZE;
    const lx = entity.x * TILE_SIZE;
    const ly = entity.y * TILE_SIZE;
    const prog = Math.min(1, entity.leap.progress || 0);
    const eased = 1 - Math.pow(1 - prog, 1.75);
    const curRadPx = Math.max(10, radPx * eased);
    ctx.save();
    ctx.fillStyle = `rgba(249, 115, 22, ${0.08 + eased * 0.14})`;
    ctx.beginPath();
    ctx.arc(lx, ly, curRadPx, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(249, 115, 22, 0.55)";
    ctx.lineWidth = 1.6;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(lx, ly, radPx, 0, Math.PI * 2);
    ctx.stroke();

    const reticleImg = assets.vfx_skyfall_stage3 || assets.vfx_skyfall_reticle;
    if (reticleImg) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 0.72 + eased * 0.28;
      ctx.translate(lx, ly);
      ctx.rotate(ts * 0.0014);
      const sz = Math.max(24, radPx * 2.24 * (0.28 + 0.72 * eased));
      ctx.drawImage(reticleImg, -sz / 2, -sz / 2, sz, sz);
      ctx.restore();
    }

    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(253, 224, 71, 0.9)";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(lx, ly, curRadPx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (entity.retributionTimer > 0) {
    const radPx = (entity.retributionRadius || 2.1) * TILE_SIZE;
    ctx.save();
    if (assets.vfx_damage_aoe_field) {
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 0.72 + Math.sin(ts * 0.01) * 0.15;
      ctx.translate(entity.x * TILE_SIZE, entity.y * TILE_SIZE);
      ctx.rotate(ts * 0.001);
      const sz = radPx * 2.12;
      ctx.drawImage(assets.vfx_damage_aoe_field, -sz / 2, -sz / 2, sz, sz);
    } else {
      ctx.strokeStyle = `rgba(239, 68, 68, ${0.55 + Math.sin(ts * 0.012) * 0.25})`;
      ctx.lineWidth = 2.2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(entity.x * TILE_SIZE, entity.y * TILE_SIZE, radPx, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (entity.hasteTimer > 0) {
    ctx.save();
    if (assets.vfx_heal_haste_aura) {
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 0.8 + Math.sin(ts * 0.014) * 0.15;
      ctx.translate(entity.x * TILE_SIZE, entity.y * TILE_SIZE - ez * 0.5);
      ctx.rotate(-ts * 0.0018);
      ctx.drawImage(assets.vfx_heal_haste_aura, -34, -34, 68, 68);
    } else {
      ctx.strokeStyle = `rgba(52, 211, 153, ${0.55 + Math.sin(ts * 0.014) * 0.25})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(entity.x * TILE_SIZE, entity.y * TILE_SIZE - ez * 0.5, 22, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (entity.tempDefTimer > 0) {
    ctx.save();
    if (assets.vfx_aegis_guard) {
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 0.85 + Math.sin(ts * 0.01) * 0.12;
      ctx.translate(entity.x * TILE_SIZE, entity.y * TILE_SIZE - ez * 0.5);
      ctx.rotate(ts * 0.0022);
      ctx.drawImage(assets.vfx_aegis_guard, -32, -32, 64, 64);
    } else {
      ctx.strokeStyle = `rgba(250, 204, 21, ${0.55 + Math.sin(ts * 0.01) * 0.25})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(entity.x * TILE_SIZE, entity.y * TILE_SIZE - ez * 0.5, 19, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  if ((entity.pvpDmgTimer || 0) > 0) {
    ctx.save();
    ctx.strokeStyle = `rgba(250, 204, 21, ${0.65 + Math.sin(ts * 0.014) * 0.25})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(entity.x * TILE_SIZE, entity.y * TILE_SIZE - ez * 0.5, 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if ((entity.regenTimer || 0) > 0) {
    ctx.save();
    ctx.strokeStyle = `rgba(34, 197, 94, ${0.65 + Math.sin(ts * 0.012) * 0.25})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(entity.x * TILE_SIZE, entity.y * TILE_SIZE - ez * 0.5, 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

export function renderMinimap() {
  const mmCanvas = document.getElementById("minimap-canvas");
  const s = runtime.state;
  if (!mmCanvas || !s) return;
  const mCtx = mmCanvas.getContext("2d");
  const mw = mmCanvas.width;
  const mh = mmCanvas.height;
  const sx = mw / MAP_W;
  const sy = mh / MAP_H;

  mCtx.fillStyle = "#06080d";
  mCtx.fillRect(0, 0, mw, mh);

  const lvl = s.level;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (!lvl.explored[y][x]) continue;
      const tile = lvl.grid[y][x];
      if (tile === TILE.WALL) mCtx.fillStyle = "#2b354f";
      else if (tile === TILE.STAIRS) mCtx.fillStyle = "#38bdf8";
      else mCtx.fillStyle = lvl.visible[y][x] ? "#4b5b7c" : "#1e2638";
      mCtx.fillRect(Math.floor(x * sx), Math.floor(y * sy), Math.ceil(sx), Math.ceil(sy));
    }
  }

  if (lvl.isBossFloor && lvl.rooms?.length) {
    const br = lvl.rooms[lvl.rooms.length - 1];
    if (lvl.explored[br.cy]?.[br.cx]) {
      mCtx.strokeStyle = "#ef4444";
      mCtx.lineWidth = 1;
      mCtx.strokeRect(br.x * sx, br.y * sy, br.w * sx, br.h * sy);
    }
  }

  if (Array.isArray(lvl.shops)) {
    for (const shop of lvl.shops) {
      if (!lvl.explored[shop.y]?.[shop.x]) continue;
      mCtx.fillStyle = "#fb923c";
      mCtx.fillRect((shop.x + 0.5) * sx - 2, (shop.y + 0.5) * sy - 2, 4, 4);
    }
  }

  for (const pr of lvl.props || []) {
    if (!lvl.explored[pr.y]?.[pr.x]) continue;
    if (pr.kind === "shrine" && !pr.used) {
      mCtx.fillStyle = "#c084fc";
      mCtx.fillRect((pr.x + 0.5) * sx - 1.5, (pr.y + 0.5) * sy - 1.5, 3, 3);
    } else if (pr.kind === "anvil") {
      mCtx.fillStyle = "#f97316";
      mCtx.fillRect((pr.x + 0.5) * sx - 1.5, (pr.y + 0.5) * sy - 1.5, 3, 3);
    }
  }

  if (Array.isArray(lvl.groundItems)) {
    for (const gItem of lvl.groundItems) {
      const gx = Math.floor(gItem.x);
      const gy = Math.floor(gItem.y);
      if (!lvl.explored[gy]?.[gx]) continue;
      mCtx.fillStyle = getRarityInfo(gItem.item).color;
      mCtx.fillRect(gItem.x * sx - 1.5, gItem.y * sy - 1.5, 3, 3);
    }
  }

  if (s.bossKeyDrop) {
    mCtx.fillStyle = "#facc15";
    mCtx.fillRect(s.bossKeyDrop.x * sx - 1.5, s.bossKeyDrop.y * sy - 1.5, 3, 3);
  }

  mCtx.fillStyle = "#22d3ee";
  mCtx.fillRect(s.player.x * sx - 2, s.player.y * sy - 2, 4, 4);
}
