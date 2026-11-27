import { loadAllAssets } from "./assets.js";
import { bgm, sfx } from "./audio.js";
import { castSpell, performDash, performMeleeAttack } from "./combat.js";
import { DEFAULT_LOADOUT } from "./data.js";
import {
  markPatchNotesSeen,
  openHeroDialog,
  openLoadoutDialog,
  openPvpDialog,
  openSkillDialog,
  quickPotion,
  renderCodex,
  renderPatchNotes,
  renderTitleSanctum,
} from "./dialogs.js";
import { pvpNet } from "./pvp.js";
import { render } from "./renderer.js";
import {
  canvas,
  clearSavedRun,
  clientToTile,
  getActiveSpells,
  getEnteredHeroName,
  getSelectedDifficulty,
  isMobileLayout,
  keys,
  loadSavedRun,
  mouse,
  runtime,
  saveMeta,
  saveRun,
  touchAim,
  touchMove,
} from "./state.js";
import { hideMainMenu, showMainMenu, syncSettingsUI, updatePerfHUD, VOLUME_CYCLE } from "./ui.js";
import { createNewRun, descendFloor, enterEndlessMode, restoreRun, triggerNearbyInteract } from "./world.js";

function setupControls() {
  const unlockAudio = () => bgm.unlock();
  window.addEventListener("pointerdown", unlockAudio, { passive: true });
  window.addEventListener("keydown", unlockAudio, { passive: true });

  window.addEventListener("keydown", (e) => {
    if (document.querySelector("dialog[open]")) return;
    if (!document.getElementById("main-menu").hidden || !document.getElementById("loading-screen").hidden) return;
    if (!runtime.state || runtime.state.runEnded) return;

    const key = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) {
      e.preventDefault();
    }
    keys.add(key);

    if (key === " ") performDash();
    else if (key === "j") performMeleeAttack();
    else if (key === "f") triggerNearbyInteract();
    else if (key === "q") quickPotion("health_potion");
    else if (key === "e") quickPotion("mana_potion");
    else if (["1", "2", "3", "4"].includes(key)) {
      const sp = getActiveSpells(runtime.state.player)[Number(key) - 1];
      if (sp) castSpell(sp.id);
    }
  });

  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener("blur", () => keys.clear());

  canvas.addEventListener("mousemove", (e) => {
    if (isMobileLayout()) return;
    const pos = clientToTile(e.clientX, e.clientY);
    mouse.x = pos.x;
    mouse.y = pos.y;
    mouse.inside = true;
  });
  canvas.addEventListener("mouseleave", () => { mouse.inside = false; });
  canvas.addEventListener("mousedown", (e) => {
    if (isMobileLayout()) return;
    if (e.button === 0) {
      const pos = clientToTile(e.clientX, e.clientY);
      mouse.x = pos.x;
      mouse.y = pos.y;
      mouse.inside = true;
      performMeleeAttack();
    }
  });

  document.getElementById("btn-skills").addEventListener("click", openSkillDialog);
  document.getElementById("btn-attack").addEventListener("click", performMeleeAttack);
  document.getElementById("btn-dash").addEventListener("click", performDash);
  const interactBtn = document.getElementById("btn-interact-prompt");
  if (interactBtn) {
    interactBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    interactBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      triggerNearbyInteract();
    });
  }

  const panelStats = document.getElementById("panel-stats");
  const panelBag = document.getElementById("panel-bag");
  document.getElementById("btn-mobile-stats").addEventListener("click", () => {
    panelBag.classList.remove("mobile-open");
    panelStats.classList.toggle("mobile-open");
  });
  document.getElementById("btn-mobile-bag").addEventListener("click", () => {
    panelStats.classList.remove("mobile-open");
    panelBag.classList.toggle("mobile-open");
  });
  document.getElementById("btn-close-stats").addEventListener("click", () => panelStats.classList.remove("mobile-open"));
  document.getElementById("btn-close-bag").addEventListener("click", () => panelBag.classList.remove("mobile-open"));

  // Mobile Touch Joystick
  const joyZone = document.getElementById("touch-joy-zone");
  const joy = document.getElementById("touch-joystick");
  const knob = document.getElementById("touch-stick-knob");
  let joyPointerId = null;
  let joyOriginX = 0;
  let joyOriginY = 0;

  const updateJoystick = (clientX, clientY) => {
    const maxR = 42;
    let dx = clientX - joyOriginX;
    let dy = clientY - joyOriginY;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const norm = dist > 6 ? Math.min(1, dist / maxR) : 0;
    if (norm > 0) {
      touchMove.x = (dx / dist) * norm;
      touchMove.y = (dy / dist) * norm;
      touchMove.active = true;
    } else {
      touchMove.x = 0;
      touchMove.y = 0;
      touchMove.active = false;
    }
  };

  const resetJoystick = () => {
    joyPointerId = null;
    touchMove.x = 0;
    touchMove.y = 0;
    touchMove.active = false;
    joy.classList.remove("active");
    joy.style.left = "";
    joy.style.bottom = "";
    joy.style.top = "";
    knob.style.transform = "translate(-50%, -50%)";
  };

  joyZone.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const zRect = joyZone.getBoundingClientRect();
    joyPointerId = e.pointerId;
    joyZone.setPointerCapture(e.pointerId);
    const localX = Math.max(52, Math.min(zRect.width - 52, e.clientX - zRect.left));
    const localY = Math.max(52, Math.min(zRect.height - 52, e.clientY - zRect.top));
    joyOriginX = zRect.left + localX;
    joyOriginY = zRect.top + localY;
    joy.classList.add("active");
    joy.style.left = `${localX - 52}px`;
    joy.style.top = `${localY - 52}px`;
    joy.style.bottom = "auto";
    updateJoystick(e.clientX, e.clientY);
  });
  joyZone.addEventListener("pointermove", (e) => { if (e.pointerId === joyPointerId) updateJoystick(e.clientX, e.clientY); });
  joyZone.addEventListener("pointerup", (e) => { if (e.pointerId === joyPointerId) resetJoystick(); });
  joyZone.addEventListener("pointercancel", resetJoystick);

  // Mobile Directional Attack Wheel (Twin-Stick Aim + Auto-Attack)
  const atkWheel = document.getElementById("touch-atk-wheel");
  const atkKnob = document.getElementById("touch-atk-knob");
  let atkPointerId = null;
  let atkCenterX = 0;
  let atkCenterY = 0;

  const updateAttackWheel = (clientX, clientY) => {
    const maxR = 34;
    let dx = clientX - atkCenterX;
    let dy = clientY - atkCenterY;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }
    if (atkKnob) {
      atkKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    }
    if (dist > 8) {
      touchAim.x = dx / dist;
      touchAim.y = dy / dist;
      touchAim.angle = Math.atan2(dy, dx);
    } else if (runtime.state?.player) {
      // Quick tap / small nudge: keep current aim angle or auto-face nearest visible enemy in range
      const p = runtime.state.player;
      let nearest = null;
      let bestDist = 7.5;
      for (const e of runtime.state.level?.enemies || []) {
        if (e.isBoss && !runtime.state.bossFightStarted) continue;
        if (!runtime.state.level.visible[Math.floor(e.y)]?.[Math.floor(e.x)]) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < bestDist) {
          bestDist = d;
          nearest = e;
        }
      }
      touchAim.angle = nearest ? Math.atan2(nearest.y - p.y, nearest.x - p.x) : p.aimAngle;
    }
    touchAim.active = true;
  };

  const resetAttackWheel = () => {
    atkPointerId = null;
    touchAim.active = false;
    touchAim.x = 0;
    touchAim.y = 0;
    atkWheel?.classList.remove("active");
    if (atkKnob) atkKnob.style.transform = "translate(-50%, -50%)";
  };

  if (atkWheel) {
    atkWheel.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      atkPointerId = e.pointerId;
      atkWheel.setPointerCapture(e.pointerId);
      const rect = atkWheel.getBoundingClientRect();
      atkCenterX = rect.left + rect.width / 2;
      atkCenterY = rect.top + rect.height / 2;
      atkWheel.classList.add("active");
      updateAttackWheel(e.clientX, e.clientY);
      performMeleeAttack();
    });
    atkWheel.addEventListener("pointermove", (e) => {
      if (e.pointerId === atkPointerId) updateAttackWheel(e.clientX, e.clientY);
    });
    atkWheel.addEventListener("pointerup", (e) => {
      if (e.pointerId === atkPointerId) resetAttackWheel();
    });
    atkWheel.addEventListener("pointercancel", resetAttackWheel);
  }

  document.getElementById("touch-btn-dash").addEventListener("pointerdown", (e) => { e.preventDefault(); performDash(); });
  for (const tBtn of document.querySelectorAll(".touch-skill-btn")) {
    tBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const spId = tBtn.dataset.spellId;
      if (spId) castSpell(spId);
    });
  }

  document.getElementById("mhud-btn-skills").addEventListener("click", openSkillDialog);
  document.getElementById("mhud-btn-menu").addEventListener("click", () => { saveRun(); showMainMenu(); });
  document.getElementById("btn-potion-hp").addEventListener("click", () => quickPotion("health_potion"));
  document.getElementById("btn-potion-mp").addEventListener("click", () => quickPotion("mana_potion"));

  document.getElementById("btn-mute").addEventListener("click", () => {
    runtime.meta.settings.sfxLevel = runtime.meta.settings.sfxLevel === "off" ? "high" : "off";
    saveMeta();
    syncSettingsUI();
  });

  document.getElementById("setting-music-btn").addEventListener("click", () => {
    const idx = VOLUME_CYCLE.indexOf(runtime.meta.settings.musicLevel || "low");
    runtime.meta.settings.musicLevel = VOLUME_CYCLE[(idx + 1) % VOLUME_CYCLE.length];
    saveMeta();
    syncSettingsUI();
  });

  document.getElementById("setting-sfx-btn").addEventListener("click", () => {
    const idx = VOLUME_CYCLE.indexOf(runtime.meta.settings.sfxLevel || "high");
    runtime.meta.settings.sfxLevel = VOLUME_CYCLE[(idx + 1) % VOLUME_CYCLE.length];
    saveMeta();
    syncSettingsUI();
  });

  document.getElementById("setting-shake-btn").addEventListener("click", () => {
    runtime.meta.settings.screenShake = !runtime.meta.settings.screenShake;
    saveMeta();
    syncSettingsUI();
  });

  document.getElementById("setting-perf-btn")?.addEventListener("click", () => {
    runtime.meta.settings.showPerf = runtime.meta.settings.showPerf === false;
    saveMeta();
    syncSettingsUI();
  });

  // Periodic lightweight HTTP RTT ping check (replaced automatically by WebSocket RTT in Multiplayer)
  const probeHttpPing = async () => {
    if (document.hidden || runtime.meta?.settings?.showPerf === false) return;
    if (typeof runtime.netPingMs === "number") return;
    if (window.location.protocol === "capacitor:" || window.location.protocol === "file:" || !navigator.onLine) {
      runtime.httpPingMs = null;
      updatePerfHUD();
      return;
    }
    try {
      const t0 = performance.now();
      await fetch(`./manifest.webmanifest?ping=${Date.now()}`, { method: "HEAD", cache: "no-store" });
      runtime.httpPingMs = Math.max(1, performance.now() - t0);
    } catch {
      runtime.httpPingMs = null;
    }
    updatePerfHUD();
  };
  probeHttpPing();
  setInterval(probeHttpPing, 3500);

  document.getElementById("setting-controls-btn").addEventListener("click", () => {
    document.getElementById("settings-dialog").close();
    document.getElementById("help-dialog").showModal();
  });

  document.getElementById("btn-menu").addEventListener("click", () => { saveRun(); showMainMenu(); });

  document.getElementById("menu-btn-play").addEventListener("click", () => {
    hideMainMenu();
    renderTitleSanctum();
    document.getElementById("title-dialog").showModal();
  });

  document.getElementById("menu-btn-pvp")?.addEventListener("click", () => {
    openPvpDialog();
  });

  document.getElementById("menu-btn-resume").addEventListener("click", () => {
    const saved = loadSavedRun();
    if (saved) {
      restoreRun(saved);
      hideMainMenu();
    }
  });

  document.getElementById("menu-btn-settings").addEventListener("click", () => {
    syncSettingsUI();
    document.getElementById("settings-dialog").showModal();
  });

  const openPatchModal = () => {
    markPatchNotesSeen();
    document.getElementById("patch-notes-dialog").showModal();
  };
  document.getElementById("menu-btn-patch-notes")?.addEventListener("click", openPatchModal);
  document.getElementById("menu-btn-patch-more")?.addEventListener("click", openPatchModal);
  renderPatchNotes();

  document.getElementById("menu-btn-exit").addEventListener("click", () => {
    saveRun();
    if (window.AndroidApp && typeof window.AndroidApp.exitApp === "function") { window.AndroidApp.exitApp(); return; }
    const capApp = window.Capacitor?.Plugins?.App;
    if (capApp && typeof capApp.exitApp === "function") { capApp.exitApp(); return; }
    window.close();
    const status = document.querySelector("#main-menu .story-lead");
    if (status) status.textContent = "Progress saved. You may now safely close this window or tab.";
  });

  document.getElementById("btn-codex").addEventListener("click", () => {
    renderCodex("lore");
    document.getElementById("codex-dialog").showModal();
  });
  for (const tabBtn of document.querySelectorAll(".codex-tab")) {
    tabBtn.addEventListener("click", () => renderCodex(tabBtn.dataset.codexTab || "lore"));
  }

  document.getElementById("btn-help").addEventListener("click", () => document.getElementById("help-dialog").showModal());
  document.getElementById("btn-new-run").addEventListener("click", () => {
    renderTitleSanctum();
    document.getElementById("title-dialog").showModal();
  });
  document.getElementById("btn-title-back")?.addEventListener("click", () => {
    document.getElementById("title-dialog").close("back");
    if (runtime.state?.startedByUser && !runtime.state?.runEnded && !runtime.state?.isPvp) {
      saveRun();
    }
    showMainMenu();
  });
  document.getElementById("btn-stairs-stay").addEventListener("click", () => {
    runtime.state.stairsCooldown = 2.0;
    document.getElementById("stairs-dialog").close("stay");
  });
  document.getElementById("btn-stairs-proceed").addEventListener("click", () => {
    document.getElementById("stairs-dialog").close("proceed");
    descendFloor();
  });

  document.getElementById("btn-start-adventure").addEventListener("click", () => {
    document.getElementById("panel-stats").classList.remove("mobile-open");
    document.getElementById("panel-bag").classList.remove("mobile-open");
    document.getElementById("title-dialog").close("start");
    const startHeroAndSkills = () => {
      openHeroDialog((chosenHero) => {
        openLoadoutDialog(
          (chosenLoadout) => {
            createNewRun(getEnteredHeroName(), getSelectedDifficulty(), chosenLoadout, chosenHero);
          },
          startHeroAndSkills
        );
      });
    };
    startHeroAndSkills();
  });

  document.getElementById("btn-end-sanctum").addEventListener("click", () => {
    document.getElementById("end-dialog").close("sanctum");
    if (runtime.state?.isPvp) {
      runtime.state.isPvp = false;
      showMainMenu();
      if (pvpNet.connected) openPvpDialog();
      return;
    }
    renderTitleSanctum();
    document.getElementById("title-dialog").showModal();
  });

  const endlessBtn = document.getElementById("btn-end-endless");
  if (endlessBtn) {
    endlessBtn.addEventListener("click", () => {
      document.getElementById("end-dialog").close("endless");
      enterEndlessMode();
    });
  }

  const pauseAll = () => {
    saveRun();
    keys.clear();
    touchMove.active = false;
    touchMove.x = 0;
    touchMove.y = 0;
    touchAim.active = false;
    touchAim.x = 0;
    touchAim.y = 0;
    bgm.pauseForBackground();
    if (sfx.ctx && sfx.ctx.state === "running") sfx.ctx.suspend().catch(() => {});
  };
  const resumeAll = () => {
    runtime.lastFrameTime = performance.now();
    bgm.resumeFromBackground();
    if (sfx.ctx && sfx.ctx.state === "suspended") sfx.ctx.resume().catch(() => {});
  };

  window.addEventListener("pagehide", pauseAll);
  window.addEventListener("blur", pauseAll);
  window.addEventListener("focus", () => { if (!document.hidden) resumeAll(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) pauseAll(); else resumeAll(); });

  const canvasFrame = document.querySelector(".canvas-frame");
  if (canvasFrame) {
    canvasFrame.addEventListener("contentvisibilityautostatechange", (event) => {
      runtime.isCanvasVisible = !event.skipped;
      if (runtime.isCanvasVisible) runtime.lastFrameTime = performance.now();
    });
  }

  for (const dlg of document.querySelectorAll("dialog")) {
    dlg.addEventListener("close", () => {
      dlg.returnValue = "";
      keys.clear();
      runtime.lastFrameTime = performance.now();
    });
  }
}

async function init() {
  let deferredInstallPrompt = null;
  const mobileAppBox = document.getElementById("menu-mobile-app-box");
  const mobileAppHint = document.getElementById("menu-mobile-app-hint");
  const installBtn = document.getElementById("btn-install-pwa");
  const isNativeApk = Boolean(window.Capacitor || window.AndroidApp);
  const isStandalone = window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;

  if (mobileAppBox && !isNativeApk) {
    mobileAppBox.hidden = false;
    if (installBtn && isStandalone) installBtn.hidden = true;
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (installBtn && !isNativeApk) installBtn.hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    if (installBtn) installBtn.hidden = true;
    if (mobileAppHint) mobileAppHint.textContent = "App installed! Launch from your home screen.";
  });

  if (installBtn) {
    installBtn.addEventListener("click", async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice.catch(() => null);
        deferredInstallPrompt = null;
        if (choice?.outcome === "accepted" && mobileAppHint) {
          mobileAppHint.textContent = "Installing Chronicles of the Shattered Crown...";
        }
        return;
      }
      const isIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent || "");
      if (mobileAppHint) {
        mobileAppHint.textContent = isIOS
          ? "On iPhone/iPad: tap Share, then choose 'Add to Home Screen'."
          : "Open browser menu -> 'Install app' / 'Add to Home Screen', or download the Android APK.";
      }
    });
  }

  if ("serviceWorker" in navigator) {
    if (window.Capacitor) {
      navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister())).catch(() => {});
      if ("caches" in window) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
    } else {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }
  syncSettingsUI();

  const studioIntro = document.getElementById("studio-intro");
  const loadingScreen = document.getElementById("loading-screen");

  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (studioIntro) studioIntro.hidden = true;
      resolve();
    };
    const timer = setTimeout(finish, 2100);
    if (studioIntro) {
      studioIntro.addEventListener("click", () => { clearTimeout(timer); finish(); }, { once: true });
    }
  });

  if (loadingScreen) loadingScreen.hidden = false;
  const barFill = document.getElementById("loading-bar-fill");
  const statusEl = document.getElementById("loading-status");
  let assetProgress = 0;
  let assetsReady = false;
  let loadedCount = 0;
  let totalCount = 1;

  const assetsPromise = loadAllAssets((loaded, total) => {
    loadedCount = loaded;
    totalCount = total;
    assetProgress = loaded / total;
  }).then((res) => {
    assetsReady = true;
    return res;
  });

  const minLoadMs = 3800;
  const loadStart = performance.now();
  await new Promise((resolve) => {
    function step(now) {
      const timeProgress = Math.min(1, (now - loadStart) / minLoadMs);
      const displayPct = Math.round(Math.min(timeProgress, assetProgress || timeProgress * 0.9) * 100);
      if (barFill) barFill.style.width = `${displayPct}%`;
      if (statusEl) {
        statusEl.textContent =
          displayPct < 100
            ? `Loading realms & sprites... (${loadedCount}/${totalCount}) ${displayPct}%`
            : "Entering Oakhaven Bastion...";
      }
      if (timeProgress >= 1 && assetsReady) {
        if (barFill) barFill.style.width = "100%";
        resolve();
      } else {
        requestAnimationFrame(step);
      }
    }
    requestAnimationFrame(step);
  });

  runtime.assets = await assetsPromise;

  try {
    setupControls();
    const saved = loadSavedRun();
    if (saved) {
      try {
        restoreRun(saved);
      } catch (err) {
        console.warn("Failed to restore saved run, starting fresh:", err);
        clearSavedRun();
        createNewRun(runtime.meta.heroName || "Sir Aldric", "normal", DEFAULT_LOADOUT, "gilded", true);
      }
    } else {
      createNewRun(runtime.meta.heroName || "Sir Aldric", "normal", DEFAULT_LOADOUT, "gilded", true);
    }
  } catch (err) {
    console.error("Init run error:", err);
  }

  await new Promise((r) => setTimeout(r, 200));
  if (loadingScreen) loadingScreen.hidden = true;
  showMainMenu();
  requestAnimationFrame(render);
}

init();
