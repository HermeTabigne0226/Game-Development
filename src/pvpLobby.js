import { sfx } from "./audio.js";
import { drawSheetFrame } from "./assets.js";
import {
  CLASS_DEFAULT_LOADOUTS,
  DEFAULT_LOADOUT,
  GAME_VERSION,
  HERO_CLASSES,
  SPELLS,
} from "./data.js";
import { openLoadoutDialog } from "./dialogs.js";
import { TILE } from "./dungeon.js";
import {
  buildPvpArenaLevel,
  DEFAULT_PVP_SERVER_URL,
  getDefaultLanUrl,
  getPvpMode,
  getSavedLanUrl,
  getSavedPvpServerUrl,
  normalizeWsUrl,
  PVP_MAPS,
  pvpHooks,
  pvpNet,
  setPvpMode,
  setSavedLanUrl,
} from "./pvp.js";
import { runtime } from "./state.js";

function escapeHtml(val) {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function openPvpDialog() {
  const dlg = document.getElementById("pvp-dialog");
  if (!dlg) return;

  const modeNetBtn = document.getElementById("btn-pvp-mode-network");
  const modeLanBtn = document.getElementById("btn-pvp-mode-lan");
  const connShell = document.getElementById("pvp-connection-shell");
  const netBar = document.getElementById("pvp-network-bar");
  const lanPanel = document.getElementById("pvp-lan-panel");

  const urlInput = document.getElementById("pvp-server-url");
  const connectBtn = document.getElementById("btn-pvp-connect");
  const cloudPresetBtn = document.getElementById("btn-pvp-cloud-preset");

  const lanUrlInput = document.getElementById("pvp-lan-url");
  const lanConnectBtn = document.getElementById("btn-pvp-lan-connect");
  const lanLocalBtn = document.getElementById("btn-pvp-lan-localhost");
  const lanScanBtn = document.getElementById("btn-pvp-lan-scan");
  const lanScanResults = document.getElementById("pvp-lan-scan-results");
  const lanHostBtn = document.getElementById("btn-pvp-host-lan");
  const lanCopyIpBtn = document.getElementById("btn-pvp-copy-ip");
  const lanHostTitle = document.getElementById("pvp-lan-host-title");
  const lanHostDesc = document.getElementById("pvp-lan-host-desc");

  const connPill = document.getElementById("pvp-conn-pill");
  const statusEl = document.getElementById("pvp-status-msg");
  const browserView = document.getElementById("pvp-browser-view");
  const roomView = document.getElementById("pvp-room-view");

  const heroNameInput = document.getElementById("pvp-hero-name");
  const lobbyListEl = document.getElementById("pvp-lobby-list");
  const roomNameInput = document.getElementById("pvp-room-name");
  const roomPassInput = document.getElementById("pvp-room-pass");
  const mapGridEl = document.getElementById("pvp-map-grid");
  const createBtn = document.getElementById("btn-pvp-create");
  const refreshBtn = document.getElementById("btn-pvp-refresh");

  const roomNetBadgeEl = document.getElementById("pvp-room-network-badge");
  const roomTitleEl = document.getElementById("pvp-room-title");
  const roomMetaEl = document.getElementById("pvp-room-meta");
  const roomErrorEl = document.getElementById("pvp-room-error");
  const roomSkillsPreviewEl = document.getElementById("pvp-room-skills-preview");
  const vsRowEl = document.getElementById("pvp-vs-row");
  const hostMapBar = document.getElementById("pvp-host-map-bar");
  const hostMapGrid = document.getElementById("pvp-room-map-grid");
  const leaveBtn = document.getElementById("btn-pvp-leave");
  const loadoutBtn = document.getElementById("btn-pvp-loadout");
  const readyBtn = document.getElementById("btn-pvp-ready");
  const startBtn = document.getElementById("btn-pvp-start");

  if (!openPvpDialog._prefs) {
    openPvpDialog._prefs = {
      heroClass: "mage",
      loadout: [...(CLASS_DEFAULT_LOADOUTS.mage || DEFAULT_LOADOUT)],
    };
  }
  const prefs = openPvpDialog._prefs;
  let selectedMapId = 0;
  let pvpHeroClass = prefs.heroClass;
  let pvpLoadout = [...prefs.loadout];
  let readyState = false;
  let activeMode = getPvpMode();
  let activeLanHostIp = "";
  let previewAnimFrame = 0;
  let previewLastTick = performance.now();
  let previewRafId = 0;

  const extractHostDisplay = (raw) =>
    String(raw || "")
      .trim()
      .replace(/^(wss?|https?):\/\//i, "")
      .replace(/\/ws$/i, "")
      .replace(/:8080$/i, "");

  if (heroNameInput && !heroNameInput.value) {
    heroNameInput.value = runtime.meta?.heroName || "Sir Aldric";
  }
  if (urlInput && !urlInput.value) {
    urlInput.value = getSavedPvpServerUrl();
  }
  if (lanUrlInput && !lanUrlInput.value) {
    lanUrlInput.value = extractHostDisplay(getSavedLanUrl());
  }

  const getLanStatusObj = () => {
    try {
      if (window.AndroidApp?.getLanStatus) return JSON.parse(window.AndroidApp.getLanStatus());
    } catch {}
    return null;
  };

  function syncModeAndLanHostUI() {
    const isLan = activeMode === "lan";
    if (modeNetBtn) {
      modeNetBtn.classList.toggle("active", !isLan);
      modeNetBtn.setAttribute("aria-selected", String(!isLan));
    }
    if (modeLanBtn) {
      modeLanBtn.classList.toggle("active", isLan);
      modeLanBtn.setAttribute("aria-selected", String(isLan));
    }
    if (netBar) netBar.hidden = isLan || pvpNet.connected || pvpNet.connecting || pvpNet.waking;
    if (lanPanel) lanPanel.hidden = !isLan;

    const hasApkLan = Boolean(window.AndroidApp?.startLanServer);
    const lanSt = hasApkLan ? getLanStatusObj() : null;
    if (hasApkLan && lanHostBtn && lanHostTitle && lanHostDesc) {
      lanHostBtn.hidden = false;
      if (lanSt?.running) {
        activeLanHostIp = lanSt.ip || "127.0.0.1";
        lanHostBtn.textContent = "Stop LAN Server";
        lanHostBtn.className = "btn btn-secondary btn-sm";
        lanHostTitle.textContent = `Phone LAN Host Active: ${activeLanHostIp}`;
        lanHostDesc.innerHTML = `2nd Phone APK: type <code>${escapeHtml(activeLanHostIp)}</code> (or tap <b>Scan Wi-Fi</b>).`;
        if (lanCopyIpBtn) lanCopyIpBtn.hidden = false;
      } else {
        activeLanHostIp = "";
        lanHostBtn.textContent = "Host LAN on Phone";
        lanHostBtn.className = "btn btn-primary btn-sm";
        lanHostTitle.textContent = "Phone-to-Phone LAN Server";
        lanHostDesc.innerHTML = `Tap <b>Host LAN on Phone</b> so friends on your Wi-Fi or Hotspot can join without Internet.`;
        if (lanCopyIpBtn) lanCopyIpBtn.hidden = true;
      }
    } else if (lanHostBtn && lanHostTitle && lanHostDesc) {
      lanHostBtn.hidden = true;
      if (lanCopyIpBtn) lanCopyIpBtn.hidden = true;
      lanHostTitle.textContent = "Local LAN Server";
      lanHostDesc.innerHTML = `Type the host friend's IP (e.g. <code>192.168.1.5</code>) below or tap <b>Scan Wi-Fi</b>.`;
      if (window.location.protocol === "http:" && !syncModeAndLanHostUI._fetchedLan) {
        syncModeAndLanHostUI._fetchedLan = true;
        fetch("/api/lan-info")
          .then((r) => (r.ok ? r.json() : null))
          .then((info) => {
            if (info?.ips?.length) {
              activeLanHostIp = info.ips[0];
              lanHostTitle.textContent = `Your LAN IP: ${info.ips.join(" / ")}`;
              lanHostDesc.innerHTML = `On a friend's Phone, type <code>${escapeHtml(activeLanHostIp)}</code> (or tap <b>Scan Wi-Fi</b>).`;
              if (lanCopyIpBtn) lanCopyIpBtn.hidden = false;
            }
          })
          .catch(() => {});
      }
    }
    if (lanScanBtn) {
      lanScanBtn.hidden = !Boolean(window.AndroidApp?.discoverLanHosts);
    }
  }

  const getFighterName = () => heroNameInput?.value.trim() || runtime.meta?.heroName || "Sir Aldric";

  function renderLobbyCharacterSetup() {
    for (const hBtn of document.querySelectorAll(".pvp-hero-card-btn")) {
      hBtn.classList.toggle("active", (hBtn.dataset.pvpHero || "mage") === pvpHeroClass);
    }
    if (roomSkillsPreviewEl) {
      roomSkillsPreviewEl.innerHTML = pvpLoadout
        .map((id) => SPELLS.find((sp) => sp.id === id))
        .filter(Boolean)
        .map(
          (sp) =>
            `<div class="pvp-room-skill-chip${sp.isUltimate ? " ult" : ""}" title="${sp.name}: ${sp.desc}"><img src="${sp.icon}" alt="" /><span>${sp.name}</span></div>`
        )
        .join("");
    }
  }

  function tickHeroPreviews(now) {
    if (!dlg.open) {
      previewRafId = 0;
      return;
    }
    if (pvpNet.room) {
      if (now - previewLastTick >= 120) {
        previewLastTick = now;
        previewAnimFrame = (previewAnimFrame + 1) % 24;
      }
      for (const prefix of ["mage", "gilded", "ranger"]) {
        const cvs = document.getElementById(`pvp-hero-preview-${prefix}`);
        const ctx = cvs?.getContext("2d");
        if (!ctx) continue;
        ctx.clearRect(0, 0, 56, 56);
        ctx.imageSmoothingEnabled = false;
        const isSel = pvpHeroClass === prefix;
        const sheet = isSel
          ? (runtime.assets[`${prefix}_walk`] || runtime.assets[`${prefix}_idle`])
          : runtime.assets[`${prefix}_idle`];
        if (sheet) drawSheetFrame(ctx, sheet, previewAnimFrame, 4, 4, 48, 48);
      }
    }
    previewRafId = requestAnimationFrame(tickHeroPreviews);
  }

  const PVP_MAP_THEMES = [
    { wall: "#2f384d", floor: "#141a26", accent: "#334155", torch: "#fb923c" },
    { wall: "#523a28", floor: "#1c1614", accent: "#78350f", torch: "#facc15" },
    { wall: "#2d1f47", floor: "#110d1c", accent: "#4c1d95", torch: "#c084fc" },
    { wall: "#4c222a", floor: "#1b1116", accent: "#7f1d1d", torch: "#f87171" },
  ];

  function drawPvpMapThumbnail(cvs, mapId) {
    if (!cvs) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    const lvl = buildPvpArenaLevel(mapId);
    const theme = PVP_MAP_THEMES[mapId] || PVP_MAP_THEMES[0];
    const grid = lvl.grid;
    const h = grid.length;
    const w = grid[0]?.length || 1;
    const cw = cvs.width;
    const ch = cvs.height;
    ctx.fillStyle = "#080a10";
    ctx.fillRect(0, 0, cw, ch);

    const tileW = cw / w;
    const tileH = ch / h;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const isWall = grid[y][x] === TILE.WALL;
        ctx.fillStyle = isWall ? theme.wall : ((x + y) % 2 === 0 ? theme.floor : theme.accent);
        ctx.fillRect(Math.floor(x * tileW), Math.floor(y * tileH), Math.ceil(tileW), Math.ceil(tileH));
      }
    }
    for (const pr of lvl.props || []) {
      if (pr.kind === "torch") {
        ctx.fillStyle = theme.torch;
        ctx.fillRect(Math.floor(pr.x * tileW), Math.floor(pr.y * tileH), Math.max(2, Math.ceil(tileW)), Math.max(2, Math.ceil(tileH)));
      }
    }
    for (const spot of lvl.pvpPowerupSpots || []) {
      ctx.fillStyle = "#facc15";
      ctx.beginPath();
      ctx.arc((spot.x + 0.5) * tileW, (spot.y + 0.5) * tileH, Math.max(2, tileW * 0.45), 0, Math.PI * 2);
      ctx.fill();
    }
    const sp0 = lvl.pvpSpawns?.[0];
    const sp1 = lvl.pvpSpawns?.[1];
    if (sp0) {
      ctx.fillStyle = "#38bdf8";
      ctx.beginPath();
      ctx.arc((sp0.x + 0.5) * tileW, (sp0.y + 0.5) * tileH, Math.max(2.4, tileW * 0.55), 0, Math.PI * 2);
      ctx.fill();
    }
    if (sp1) {
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.arc((sp1.x + 0.5) * tileW, (sp1.y + 0.5) * tileH, Math.max(2.4, tileW * 0.55), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function createMapPreviewEl(mapCfg, width, height) {
    if (mapCfg.splash) {
      const img = document.createElement("img");
      img.src = mapCfg.splash;
      img.alt = mapCfg.name;
      img.className = "pvp-map-splash-img";
      img.loading = "lazy";
      img.onerror = () => {
        const fallback = document.createElement("canvas");
        fallback.width = width;
        fallback.height = height;
        fallback.className = "pvp-map-thumb";
        drawPvpMapThumbnail(fallback, mapCfg.id);
        img.replaceWith(fallback);
      };
      return img;
    }
    const thumb = document.createElement("canvas");
    thumb.width = width;
    thumb.height = height;
    thumb.className = "pvp-map-thumb";
    thumb.setAttribute("aria-hidden", "true");
    drawPvpMapThumbnail(thumb, mapCfg.id);
    return thumb;
  }

  function renderMapPicker() {
    if (mapGridEl) {
      mapGridEl.innerHTML = "";
      for (const m of PVP_MAPS) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `pvp-map-card ${m.id === selectedMapId ? "selected" : ""}`;
        const preview = createMapPreviewEl(m, 88, 50);
        const meta = document.createElement("div");
        meta.className = "pvp-map-card-meta";
        const strong = document.createElement("strong");
        strong.textContent = m.name;
        const span = document.createElement("span");
        span.textContent = m.subtitle;
        meta.append(strong, span);
        btn.append(preview, meta);
        btn.addEventListener("click", () => {
          selectedMapId = m.id;
          renderMapPicker();
        });
        mapGridEl.appendChild(btn);
      }
    }
  }

  function renderHostRoomMapGrid(activeMapId) {
    if (!hostMapGrid) return;
    hostMapGrid.innerHTML = "";
    for (const m of PVP_MAPS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `pvp-room-map-card ${m.id === Number(activeMapId) ? "selected" : ""}`;
      btn.title = `${m.name} — ${m.subtitle}`;
      const preview = createMapPreviewEl(m, 88, 50);
      const label = document.createElement("span");
      label.className = "pvp-room-map-name";
      label.textContent = m.name;
      btn.append(preview, label);
      btn.addEventListener("click", () => {
        pvpNet.send({ type: "update_player", mapId: m.id });
      });
      hostMapGrid.appendChild(btn);
    }
  }

  function renderPvpUI(evt) {
    if (connPill) {
      if (pvpNet.connected) {
        const pingTxt = typeof runtime.netPingMs === "number" ? ` · ${Math.round(runtime.netPingMs)} ms` : "";
        connPill.textContent = `Connected${pingTxt}`;
        connPill.className = "pvp-conn-pill online";
      } else if (pvpNet.waking) {
        connPill.textContent = `Waking... (${pvpNet.retryAttempt}/${pvpNet.maxRetries})`;
        connPill.className = "pvp-conn-pill pending";
      } else if (pvpNet.connecting) {
        connPill.textContent = "Connecting...";
        connPill.className = "pvp-conn-pill pending";
      } else {
        connPill.textContent = "Offline";
        connPill.className = "pvp-conn-pill offline";
      }
    }

    if (netBar) {
      netBar.hidden = activeMode === "lan" || pvpNet.connected || pvpNet.connecting || pvpNet.waking;
    }

    if (statusEl) {
      if (pvpNet.lastError) {
        statusEl.hidden = false;
        statusEl.textContent = pvpNet.lastError;
        statusEl.className = "pvp-status-msg error";
      } else if (pvpNet.connected) {
        statusEl.hidden = true;
      } else if (pvpNet.waking) {
        statusEl.hidden = false;
        statusEl.textContent = `Waking PvP server, retrying automatically... (Attempt ${pvpNet.retryAttempt}/${pvpNet.maxRetries})`;
        statusEl.className = "pvp-status-msg waking";
      } else if (activeMode === "lan") {
        statusEl.hidden = false;
        statusEl.textContent = "Tap Host LAN on Phone, tap Scan Wi-Fi, or type your friend's IP (e.g. 192.168.1.5).";
        statusEl.className = "pvp-status-msg";
      } else {
        statusEl.hidden = true;
      }
    }

    if (createBtn) createBtn.disabled = !pvpNet.connected;
    if (refreshBtn) refreshBtn.disabled = !pvpNet.connected;

    const inRoom = Boolean(pvpNet.room);
    if (connShell) connShell.hidden = inRoom;
    if (browserView) browserView.hidden = inRoom;
    if (roomView) roomView.hidden = !inRoom;

    if (roomErrorEl) {
      if (inRoom && evt === "error" && pvpNet.lastError) {
        roomErrorEl.textContent = pvpNet.lastError;
        roomErrorEl.hidden = false;
      } else if (!inRoom || evt === "lobby_joined" || evt === "lobby_update") {
        roomErrorEl.hidden = true;
      }
    }

    const visibleLobbies = Array.isArray(pvpNet.lobbies)
      ? pvpNet.lobbies.filter((r) => (r.playerCount || 0) > 0 && (r.playerCount || 0) < 2)
      : [];
    if (!inRoom && lobbyListEl) {
      if (!pvpNet.connected) {
        lobbyListEl.innerHTML = `<div class="hint-text">Connect to a server above to view &amp; join open lobbies.</div>`;
      } else if (!visibleLobbies.length) {
        lobbyListEl.innerHTML = `<div class="hint-text">No open lobbies yet. Create one on the right!</div>`;
      } else {
        lobbyListEl.innerHTML = "";
        for (const r of visibleLobbies) {
          const card = document.createElement("div");
          card.className = `pvp-lobby-item ${r.sameNetwork ? "same-net" : ""}`;
          const m = PVP_MAPS[r.mapId] || PVP_MAPS[0];
          const lockBadge = r.hasPassword ? `<span class="pvp-lock-pill">🔒 Locked</span>` : "";
          const netBadge = r.sameNetwork ? `<span class="pvp-net-pill">Same Network</span>` : "";
          const safeRoomName = escapeHtml(r.name || "Dungeon Arena");
          const safeHostName = escapeHtml(r.hostName || "Challenger");
          const safeHostRole = escapeHtml(HERO_CLASSES[r.hostClass]?.name || r.hostClass || "Hero");
          const safeMapName = escapeHtml(m.name || "Arena");
          card.innerHTML = `
            <div class="pvp-lobby-meta">
              <strong>${safeRoomName} ${lockBadge} ${netBadge}</strong>
              <span>Host: ${safeHostName} (${safeHostRole}) · Map: ${safeMapName}</span>
            </div>
            <button type="button" class="btn btn-primary btn-sm">Join</button>
          `;
          card.querySelector("button").addEventListener("click", () => {
            let pass = "";
            if (r.hasPassword) {
              pass = window.prompt(`Enter password for "${r.name}":`, "") || "";
            }
            pvpNet.lastError = "";
            pvpNet.send({
              type: "join_lobby",
              roomId: r.id,
              password: pass,
              heroName: getFighterName(),
              heroClass: pvpHeroClass,
              appVersion: GAME_VERSION,
              loadout: pvpLoadout,
            });
          });
          lobbyListEl.appendChild(card);
        }
      }
    }

    if (inRoom && pvpNet.room) {
      const rm = pvpNet.room;
      const m = PVP_MAPS[rm.mapId] || PVP_MAPS[0];
      const myPl = rm.players[pvpNet.mySlot];
      if (myPl) {
        if (["mage", "gilded", "ranger"].includes(myPl.heroClass)) {
          pvpHeroClass = myPl.heroClass;
          prefs.heroClass = pvpHeroClass;
        }
        if (Array.isArray(myPl.loadout) && myPl.loadout.length >= 4) {
          pvpLoadout = [...myPl.loadout];
          prefs.loadout = [...pvpLoadout];
        }
      }
      renderLobbyCharacterSetup();

      if (roomNetBadgeEl) {
        const pingTxt = typeof runtime.netPingMs === "number" ? ` · ${Math.round(runtime.netPingMs)} ms` : "";
        roomNetBadgeEl.textContent = `${activeMode === "lan" ? "📡 LAN (Wi-Fi)" : "🌐 Online"}${pingTxt}`;
      }
      if (roomTitleEl) roomTitleEl.textContent = `${rm.name}${rm.hasPassword ? " 🔒" : ""}`;
      if (roomMetaEl) roomMetaEl.textContent = `Map: ${m.name} — ${m.desc}`;

      if (hostMapBar) hostMapBar.hidden = pvpNet.mySlot !== 0;
      if (pvpNet.mySlot === 0) renderHostRoomMapGrid(rm.mapId);

      if (vsRowEl) {
        vsRowEl.innerHTML = "";
        for (let slot = 0; slot < 2; slot++) {
          const pl = rm.players[slot];
          const box = document.createElement("div");
          box.className = `pvp-vs-card ${pl ? (pl.ready ? "ready" : "") : "waiting"}`;
          if (pl) {
            const cls = HERO_CLASSES[pl.heroClass] || HERO_CLASSES.gilded;
            const youTag = slot === pvpNet.mySlot ? " (You)" : "";
            const verTag = pl.appVersion && pl.appVersion !== "unknown" ? ` · ${escapeHtml(pl.appVersion)}` : "";
            box.innerHTML = `
              <span class="pvp-slot-tag">${slot === 0 ? "HOST" : "CHALLENGER"}${youTag}</span>
              <strong>${escapeHtml(pl.heroName || cls.name)}</strong>
              <span class="pvp-hero-role">${escapeHtml(cls.name)}${verTag}</span>
              <span class="pvp-ready-pill ${pl.ready ? "is-ready" : ""}">${pl.ready ? "READY" : "Not Ready"}</span>
            `;
          } else {
            box.innerHTML = `
              <span class="pvp-slot-tag">CHALLENGER</span>
              <strong>Waiting for Player...</strong>
              <span class="pvp-hero-role">Waiting for a challenger to join this lobby</span>
            `;
          }
          vsRowEl.appendChild(box);
        }
      }

      readyState = Boolean(myPl?.ready);
      const normV = (v) => String(v || "").replace(/^v\.?/i, "").trim();
      const hasOpp = rm.players.length === 2;
      const versionMismatch = Boolean(
        rm.versionMismatch ||
        (hasOpp && normV(rm.players[0].appVersion) !== normV(rm.players[1].appVersion))
      );
      const allReady = hasOpp && !versionMismatch && rm.players.every((pl) => pl.ready);
      const cdEl = document.getElementById("pvp-lobby-countdown");
      const updGameBtn = document.getElementById("btn-pvp-update-game");
      if (renderPvpUI._cdInterval) {
        clearInterval(renderPvpUI._cdInterval);
        renderPvpUI._cdInterval = null;
      }
      if (updGameBtn) {
        updGameBtn.hidden = !versionMismatch;
        updGameBtn.onclick = () => {
          if (typeof window.__openCheckUpdateModal === "function") {
            window.__openCheckUpdateModal();
          } else {
            document.getElementById("update-dialog")?.showModal();
          }
        };
      }
      if (cdEl) {
        cdEl.style.borderColor = "";
        cdEl.style.color = "";
        cdEl.style.background = "";
        if (versionMismatch) {
          const v0 = rm.players[0]?.appVersion || "unknown";
          const v1 = rm.players[1]?.appVersion || "unknown";
          cdEl.hidden = false;
          cdEl.style.borderColor = "#ef4444";
          cdEl.style.color = "#fecaca";
          cdEl.style.background = "rgba(153, 27, 27, 0.35)";
          cdEl.textContent = `Version didn't match (${v0} vs ${v1}) — Please update the game to play PvP!`;
        } else if (allReady) {
          let sec = Math.max(1, rm.autoStartSec || 3);
          cdEl.hidden = false;
          cdEl.textContent = `All Fighters Ready! Match starting in ${sec}...`;
          renderPvpUI._cdInterval = setInterval(() => {
            if (!dlg.open || !pvpNet.room || pvpNet.room.status !== "lobby") {
              clearInterval(renderPvpUI._cdInterval);
              renderPvpUI._cdInterval = null;
              return;
            }
            sec = Math.max(1, sec - 1);
            cdEl.textContent = sec <= 1 ? "Launching Arena..." : `All Fighters Ready! Match starting in ${sec}...`;
          }, 950);
        } else if (rm.players.length === 2) {
          cdEl.hidden = false;
          cdEl.textContent = `Press Ready Up (${rm.players.filter((x) => x.ready).length}/2 Ready) — Match auto-starts when both are Ready!`;
        } else {
          cdEl.hidden = true;
        }
      }
      if (readyBtn) {
        readyBtn.textContent = readyState ? "Unready" : "Ready Up";
        readyBtn.className = `btn ${readyState ? "btn-primary" : "btn-secondary"}`;
      }
      if (startBtn) {
        const isHost = pvpNet.mySlot === 0;
        startBtn.hidden = !isHost || !allReady;
        startBtn.disabled = !allReady;
        startBtn.textContent = "Start Now";
      }
    }

    if (evt === "error" && pvpNet.lastError && statusEl) {
      statusEl.textContent = pvpNet.lastError;
    }
  }

  const guideOpenBtn = document.getElementById("btn-pvp-guide-open");
  if (guideOpenBtn) {
    guideOpenBtn.onclick = () => document.getElementById("pvp-guide-dialog")?.showModal();
  }

  for (const hBtn of document.querySelectorAll(".pvp-hero-card-btn")) {
    hBtn.onclick = () => {
      pvpHeroClass = hBtn.dataset.pvpHero || "mage";
      pvpLoadout = [...(CLASS_DEFAULT_LOADOUTS[pvpHeroClass] || DEFAULT_LOADOUT)];
      prefs.heroClass = pvpHeroClass;
      prefs.loadout = [...pvpLoadout];
      if (pvpHeroClass === "mage") sfx.magicOrb();
      else if (pvpHeroClass === "ranger") sfx.arrow();
      else sfx.slash();
      renderLobbyCharacterSetup();
      if (pvpNet.room) {
        pvpNet.send({
          type: "update_player",
          heroName: getFighterName(),
          heroClass: pvpHeroClass,
          appVersion: GAME_VERSION,
          loadout: pvpLoadout,
          ready: false,
        });
      }
    };
  }
  if (heroNameInput) {
    heroNameInput.onchange = () => {
      if (pvpNet.room) {
        pvpNet.send({
          type: "update_player",
          heroName: getFighterName(),
          heroClass: pvpHeroClass,
          appVersion: GAME_VERSION,
          loadout: pvpLoadout,
        });
      }
    };
  }

  const connectForMode = (mode, customUrl = null) => {
    if (mode === "lan") {
      const target = normalizeWsUrl(customUrl ?? (lanUrlInput?.value || getSavedLanUrl()), { defaultLan: true });
      if (lanUrlInput && target) lanUrlInput.value = extractHostDisplay(target);
      if (target) setSavedLanUrl(target);
      pvpNet.connect(target);
    } else {
      const target = normalizeWsUrl(customUrl ?? DEFAULT_PVP_SERVER_URL, { defaultLan: false });
      pvpNet.connect(target);
    }
  };

  if (modeNetBtn) {
    modeNetBtn.onclick = () => {
      if (activeMode === "network") return;
      activeMode = "network";
      setPvpMode("network");
      syncModeAndLanHostUI();
      pvpNet.disconnect();
      connectForMode("network");
      renderPvpUI();
    };
  }
  if (modeLanBtn) {
    modeLanBtn.onclick = () => {
      if (activeMode === "lan") return;
      activeMode = "lan";
      setPvpMode("lan");
      syncModeAndLanHostUI();
      pvpNet.disconnect();
      if (window.location.protocol === "http:" || getLanStatusObj()?.running) {
        connectForMode("lan");
      }
      renderPvpUI();
    };
  }

  connectBtn.onclick = () => connectForMode("network");
  if (cloudPresetBtn) {
    cloudPresetBtn.onclick = () => connectForMode("network", DEFAULT_PVP_SERVER_URL);
  }
  if (lanConnectBtn) {
    lanConnectBtn.onclick = () => connectForMode("lan");
  }
  if (lanLocalBtn) {
    lanLocalBtn.onclick = () => {
      const target = getDefaultLanUrl().startsWith("ws://127.0.0.1") ? "ws://127.0.0.1:8080/ws" : "ws://localhost:8080/ws";
      if (lanUrlInput) lanUrlInput.value = extractHostDisplay(target);
      connectForMode("lan", target);
    };
  }
  if (lanHostBtn) {
    lanHostBtn.onclick = () => {
      if (!window.AndroidApp?.startLanServer) return;
      const st = getLanStatusObj();
      if (st?.running) {
        window.AndroidApp.stopLanServer();
        pvpNet.disconnect();
        syncModeAndLanHostUI();
        renderPvpUI();
        return;
      }
      try {
        const res = JSON.parse(window.AndroidApp.startLanServer());
        if (res?.ok) {
          syncModeAndLanHostUI();
          const selfUrl = res.selfUrl || "ws://127.0.0.1:8080/ws";
          if (lanUrlInput) lanUrlInput.value = extractHostDisplay(res.url || selfUrl);
          setSavedLanUrl(res.url || selfUrl);
          pvpNet.connect(selfUrl);
        } else if (statusEl) {
          statusEl.textContent = res?.error || "Could not start Phone LAN server on port 8080.";
          statusEl.className = "pvp-status-msg error";
        }
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = err?.message || "Failed to launch Phone LAN server.";
          statusEl.className = "pvp-status-msg error";
        }
      }
    };
  }
  if (lanCopyIpBtn) {
    lanCopyIpBtn.onclick = () => {
      const txt = activeLanHostIp || getLanStatusObj()?.ip || "";
      if (!txt) return;
      navigator.clipboard?.writeText(txt).catch(() => {});
      if (statusEl) {
        statusEl.textContent = `Copied LAN IP: ${txt}`;
        statusEl.className = "pvp-status-msg ok";
      }
    };
  }
  if (lanScanBtn) {
    lanScanBtn.onclick = () => {
      if (!window.AndroidApp?.discoverLanHosts || !lanScanResults) return;
      lanScanBtn.disabled = true;
      lanScanBtn.textContent = "Scanning...";
      setTimeout(() => {
        try {
          const found = JSON.parse(window.AndroidApp.discoverLanHosts() || "[]");
          lanScanResults.innerHTML = "";
          if (!found.length) {
            lanScanResults.hidden = false;
            lanScanResults.innerHTML = `<span class="hint-text">No LAN hosts found on Wi-Fi yet. Host on 1 Phone/PC or type their IP manually.</span>`;
          } else {
            lanScanResults.hidden = false;
            for (const h of found) {
              const chip = document.createElement("button");
              chip.type = "button";
              chip.className = "pvp-scan-chip";
              chip.textContent = `${h.name || h.ip} (${h.ip})`;
              chip.addEventListener("click", () => {
                if (lanUrlInput) lanUrlInput.value = extractHostDisplay(h.url || h.ip);
                connectForMode("lan", h.url);
              });
              lanScanResults.appendChild(chip);
            }
          }
        } catch {}
        lanScanBtn.disabled = false;
        lanScanBtn.textContent = "Scan Wi-Fi";
      }, 40);
    };
  }
  refreshBtn.onclick = () => pvpNet.send({ type: "list_lobbies" });
  createBtn.onclick = () => {
    pvpNet.lastError = "";
    pvpNet.send({
      type: "create_lobby",
      name: roomNameInput?.value.trim() || `${getFighterName()}'s Arena`,
      password: roomPassInput?.value || "",
      mapId: selectedMapId,
      heroName: getFighterName(),
      heroClass: pvpHeroClass,
      appVersion: GAME_VERSION,
      loadout: pvpLoadout,
    });
  };
  leaveBtn.onclick = () => pvpNet.send({ type: "leave_lobby" });
  readyBtn.onclick = () => {
    pvpNet.send({
      type: "update_player",
      heroName: getFighterName(),
      heroClass: pvpHeroClass,
      appVersion: GAME_VERSION,
      loadout: pvpLoadout,
      ready: !readyState,
    });
  };
  startBtn.onclick = () => pvpNet.send({ type: "start_match" });

  let keepRoomOnClose = false;
  loadoutBtn.onclick = () => {
    keepRoomOnClose = true;
    dlg.close("pick");
    const reopen = () => openPvpDialog();
    openLoadoutDialog(
      (chosenLoadout) => {
        pvpLoadout = [...chosenLoadout];
        prefs.loadout = [...pvpLoadout];
        pvpNet.send({
          type: "update_player",
          heroName: getFighterName(),
          heroClass: pvpHeroClass,
          appVersion: GAME_VERSION,
          loadout: pvpLoadout,
          ready: false,
        });
        reopen();
      },
      reopen,
      pvpLoadout,
      pvpHeroClass
    );
  };

  pvpHooks.onLobbyStateChange = renderPvpUI;
  syncModeAndLanHostUI();
  renderMapPicker();
  renderLobbyCharacterSetup();
  renderPvpUI();
  if (previewRafId) cancelAnimationFrame(previewRafId);
  previewRafId = requestAnimationFrame(tickHeroPreviews);
  if (dlg._pvpCloseHandler) {
    dlg.removeEventListener("close", dlg._pvpCloseHandler);
  }
  dlg._pvpCloseHandler = () => {
    if (previewRafId) {
      cancelAnimationFrame(previewRafId);
      previewRafId = 0;
    }
    if (!keepRoomOnClose && !runtime.state?.isPvp && pvpNet.connected && pvpNet.room) {
      pvpNet.send({ type: "leave_lobby" });
    }
  };
  dlg.addEventListener("close", dlg._pvpCloseHandler, { once: true });

  if (!pvpNet.connected && !pvpNet.connecting && !pvpNet.waking) {
    if (activeMode === "network") {
      connectForMode("network");
    } else if (activeMode === "lan" && (window.location.protocol === "http:" || getLanStatusObj()?.running)) {
      connectForMode("lan");
    }
  } else if (pvpNet.connected) {
    pvpNet.send({ type: "list_lobbies" });
  }

  if (!dlg.open) dlg.showModal();
}


pvpHooks.openPvpDialog = openPvpDialog;
