---
name: codebase-map
description: >-
  Fast file, export, DOM modal, and CSS section map for Chronicles of the Shattered Crown.
  Use before searching or reading large files (src/data.js, src/dialogs.js, src/pvpLobby.js,
  styles/main.css, styles/pvp.css, src/combat.js, src/pvp.js, src/renderer.js, src/world.js, index.html)
  to jump directly to exact line ranges.
---

# Codebase Map & Line-Range Navigator

Use this skill to jump directly to the right file and line range instead of grepping or reading multi-thousand-line files.

## Live Line Numbers (When Files Have Shifted)
Run the zero-dependency landmark indexer for exact current line numbers:
```powershell
node .agents/skills/codebase-map/scripts/find-landmarks.js styles/main.css styles/pvp.css src/dialogs.js src/pvpLobby.js
```

## Module Ownership Summary
| File | ~Lines | Owns |
| :--- | :--- | :--- |
| `index.html` | 1,155 | Overlays (`#studio-intro`, `#loading-screen`, `#pvp-vs-screen`, `#pvp-match-overlay`, `#main-menu`), 3-col HUD, `#pvp-sf-hud`, all `<dialog>` modals |
| `styles/main.css` | 3,585 | CSS variables (`:root`), desktop 3-col layout, mobile landscape HUD (`--hud-auto-scale`), `#main-menu`, dungeon modals & responsive breakpoints |
| `styles/pvp.css` | 1,365 | PvP lobby modal (`.pvp-card`, LAN/Online tabs, map cards, room setup), VS matchup screen (`.pvp-vs-screen`), winner overlay (`.pvp-match-overlay`), `#pvp-sf-hud` |
| `src/game.js` | 975 | Bootstrap, keyboard/mouse/touch joysticks, button listeners, main `requestAnimationFrame` loop, APK updater |
| `src/state.js` | 565 | `runtime`, `SAVE_KEY` / `RUN_SAVE_KEY` (`localStorage`), camera, stat calculation, inventory helpers |
| `src/data.js` | 2,065 | `GAME_VERSION`, `PATCH_NOTES`, `DIFFICULTIES`, `HERO_CLASSES`, `ACTS`, `SPELLS`, `RELICS`, `ELITE_AFFIXES`, `ITEMS`, `EQUIPMENT_SETS`, `ENEMIES`, `META_UPGRADES`, `SOUL_FORGE_UPGRADES`, `LORE_CODEX`, `NPC_ENCOUNTERS`, `SHRINE_ENCOUNTERS` |
| `src/combat.js` | 1,585 | `damageEnemy`, `handleBossDefeated`, `performMeleeAttack`, `performDash`, `castSpell`, `stunPlayer`, `hurtPlayer`, `endRun` |
| `src/world.js` | 1,865 | `createNewRun`, `restoreRun`, `descendFloor`, `enterEndlessMode`, `interactProp`, `updateSimulation` |
| `src/enemyAI.js` | 640 | Dungeon enemy + Act boss behaviors, telegraphs, projectiles |
| `src/dungeon.js` | 630 | Procedural room/corridor generator, `MAP_W`/`MAP_H`, props/spawns |
| `src/renderer.js` | 1,785 | 2D Canvas `renderFrame`, tile/prop/entity/projectile/VFX drawing, `drawEntityChargesAndAuras`, `renderMinimap` |
| `src/ui.js` | 745 | `buildSpellButtons`, `updateCooldownUI`, `updateUI`, `updateRoomAndBossHUD`, `updatePerfHUD`, `syncSettingsUI`, `showMainMenu`/`hideMainMenu` |
| `src/dialogs.js` | 1,525 | Inventory/item modal, skill upgrade, shop, confirm, forge, shrine, story/NPC, stairs, sanctum, codex, patch notes, hero & loadout wizard |
| `src/pvpLobby.js` | 845 | `openPvpDialog` — Online/LAN connection UI, Phone LAN host controls, map thumbnail/splash picker, lobby browser, 1v1 room setup & Ready countdown |
| `src/pvp.js` | 1,945 | `PVP_MAPS`, `buildPvpArenaLevel`, `buildBalancedPvpPlayer`, `PvpNetworkClient` (`pvpNet`), VS screen, round lifecycle, remote sync/hit handling |
| `server.js` | 975 | Static dev/relay HTTP server + pure-Node RFC 6455 WebSocket (`/ws`) + UDP LAN discovery (`8081`) |
| `src/assets.js` / `src/audio.js` | ~200 ea | Image/sprite manifest loader & WebAudio synth/BGM |

## Key Section Landmarks
- **`src/data.js`**: `GAME_VERSION`/`PATCH_NOTES` (L1–293), `HERO_CLASSES` (L300–353), `SPELLS` (L387–733), `RELICS` & `ELITE_AFFIXES` (L734–827), `ITEMS` & `EQUIPMENT_SETS` (L856–1709), `ENEMIES` (L1710–1879), Meta/Codex/NPC/Shrines (L1880–2062).
- **`src/dialogs.js`**: Inventory/Shortcuts (L56–315), Skill/Shop/Confirm/Forge/Shrine/Story (L316–1146), Sanctum/Codex/PatchNotes (L1147–1363), Hero & Loadout Wizard (L1364–1512).
- **`src/pvpLobby.js`**: `openPvpDialog` (L39–844): LAN/Online sync (L130+), Hero & map pickers (L189–358), `renderPvpUI` room/lobby state (L360–591), button/network handlers (L593–842).
- **`styles/main.css`**: `:root` & Top Bar (L1–185), Desktop & Mobile HUD `@media` (L186–860), Sidebar/Canvas/Action Bar (L861–1606), Hero & Loadout Modals (L1607–1769), Loading & `#main-menu` (L1770–2427), Inventory/Shop/Dialogs & responsive rules (L2428–3586).
- **`styles/pvp.css`**: Lobby & Room UI `.pvp-card` + mobile `@media` (L1–755), Countdown/VS Screen/Winner Overlay (L756–1044), `#pvp-sf-hud` & `body.pvp-active` rules (L1045–1363).
