---
name: pvp-and-combat
description: >-
  Architecture and targeted edit guide for 1v1 PvP multiplayer (WebSocket relay, LAN, lobby UI,
  VS screen, round sync, hit validation) and combat/spells/classes. Use when fixing PvP bugs,
  balancing classes or skills, adding spells/items, or modifying server.js / src/pvp.js / src/combat.js.
---

# PvP Multiplayer & Combat Workflow

Read only the targeted line ranges below instead of loading `src/pvp.js`, `src/combat.js`, `src/dialogs.js`, or `server.js` in full.

## 1. 1v1 PvP Architecture & Exact Touchpoints
- **Server Relay & LAN (`server.js`)**:
  - Constants & rate/damage caps (`MAX_PVP_HIT_DMG`, `MAX_PVP_HIT_RATE`): L14–22.
  - Room state, `finishPvpRound`, `launchPvpRoomMatch`: L134–408.
  - Message router `handleClientMessage` (`create_lobby`, `join_lobby`, `update_player`, `start_match`, `round_lost`, `claim_round_win`, `round_timeout`, `pvp_sync`, `pvp_hit` + anti-AFK background damage + 1.0s lethal verify): L410–719.
  - RFC 6455 WebSocket upgrade (`/ws`), 15s stale-client sweep, UDP LAN responder (`8081`): L791–971.
- **Client Netcode & Arena Runtime (`src/pvp.js`)**:
  - `PVP_MAPS` & `buildPvpArenaLevel(mapId)`: L25–305.
  - Balanced PvP stat normalization (`buildBalancedPvpPlayer`, 1,000 HP baseline): L306–429.
  - Background tab heartbeat (`startPvpBgHeartbeat`) & lobby return cleanup: L445–558.
  - `PvpNetworkClient` (`pvpNet`, cloud wake backoff, LAN scan): L559–877.
  - Spawn slots (Slot 0 = Left, Slot 1 = Right), `showPvpVsLoadingScreen`, `startPvpMatchSession`, `startPvpRound`: L878–1173.
  - Per-frame tick `updatePvpFrame`, powerups, `applyRemoteOpponentAction`, `applyIncomingPvpHit`, `handleRemoteRoundOver`: L1240–1942.
- **PvP Lobby DOM & Styling**:
  - Lobby modal logic: `openPvpDialog` in `src/pvpLobby.js` (L39–844).
  - Markup: `#pvp-vs-screen` (L35–68), `#pvp-match-overlay` (L71–83), `#pvp-sf-hud` (L282–345), `#pvp-dialog` (L873–1026) in `index.html`.
  - Styles: `styles/pvp.css` (Lobby L1–755, VS & Winner Overlay L756–1044, `#pvp-sf-hud` L1045–1363).

## 2. Classes, Spells & Combat Touchpoints
- **Definitions (`src/data.js`)**:
  - `HERO_CLASSES` (`mage`, `gilded`, `ranger`): L300–353.
  - `SPELLS` & `CLASS_DEFAULT_LOADOUTS` (3 basic + 1 ultimate): L387–733.
  - `ITEMS` / `EQUIPMENT_SETS` / `ENEMIES`: L856–1879.
- **Execution (`src/combat.js` & `src/renderer.js`)**:
  - Melee & class passives (`performMeleeAttack`): `src/combat.js` L455–610.
  - Sub-weapon dash (`performDash` — Shield Bash / 3x Ricochet / Blink): `src/combat.js` L611–763.
  - Spell casting (`castSpell`): `src/combat.js` L764–1443 (if PvP-visible, mirror remote VFX in `broadcastPvpAction` / `applyRemoteOpponentAction` in `src/pvp.js` L1441–1698).
  - Canvas VFX rendering: `src/renderer.js` (`renderFrame` L78+, `drawEntityChargesAndAuras` L1379+).

## 3. Verification
Run `npm test; node --check server.js; npm run sync` after edits (use `;` on Windows PowerShell 5.1). Note: `server.js` caps single-hit PvP damage at `MAX_PVP_HIT_DMG` (340) and range at `15.5` tiles (ranged/skill) or `5.5` tiles (melee).
