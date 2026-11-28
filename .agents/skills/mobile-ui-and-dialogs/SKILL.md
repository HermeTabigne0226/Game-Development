---
name: mobile-ui-and-dialogs
description: >-
  Guide for editing responsive mobile landscape HUD, touch controls, Main Menu, and native <dialog>
  modals in Chronicles of the Shattered Crown. Use when fixing layout overlaps, mobile WebView quirks,
  joystick/button scaling, HUD elements, or modal flows across index.html, styles/main.css, src/ui.js, and src/dialogs.js.
---

# Mobile Landscape HUD, Touch Controls & Modal Guide

Avoid scanning all 3,585 lines of `styles/main.css`, 1,365 lines of `styles/pvp.css`, or 1,525 lines of `src/dialogs.js`. Jump straight to the target section below.

## 1. Exact File & Line Jump Table
- **`index.html`**:
  - `#main-menu`: L86–172
  - Desktop 3-column HUD + Mobile HUD (`#mobile-hud`, joysticks, action wheel): L173–465
  - Quest setup modals (`#title-dialog` L466–547, `#hero-dialog` L655–704, `#loadout-dialog` L707–737)
  - Gameplay modals (`#story-dialog`, `#shop-dialog`, `#codex-dialog`, `#help-dialog`, `#skill-dialog`, `#item-action-dialog`, `#patch-notes-dialog`, `#settings-dialog`, `#stairs-dialog`, `#forge-dialog`, `#update-dialog`, `#ingame-menu-dialog`, `#confirm-dialog`, `#end-dialog`): L550–1150
- **`styles/main.css` & `styles/pvp.css`** (run `node .agents/skills/codebase-map/scripts/find-landmarks.js styles/main.css styles/pvp.css` if shifted):
  - `:root` tokens & `--hud-auto-scale`: `styles/main.css` L1–76
  - Mobile HUD, touch joysticks, attack wheel (`@media (max-width: 960px), (pointer: coarse)`): `styles/main.css` L194–860 & L1453–1606
  - Hero & Loadout wizard modals: `styles/main.css` L1607–1769
  - `#loading-screen` & `#main-menu` (incl. `@media (max-height: 520px)`): `styles/main.css` L1770–2427
  - Inventory, Shop, Codex & Native `<dialog>` base rules: `styles/main.css` L2428–3586
  - PvP Lobby, VS Screen, Winner Overlay & `#pvp-sf-hud`: `styles/pvp.css` L1–1363
- **JS Controllers**:
  - HUD updates, cooldown rings, `syncSettingsUI`, button size (`small`/`medium`/`big`): `src/ui.js` L24–745
  - Touch joystick/aim math & listener setup: `src/game.js` L39–420
  - Modal rendering & event handlers: `src/dialogs.js` (dungeon/menu modals) & `src/pvpLobby.js` (PvP lobby modal)

## 2. Mobile WebView & Responsive Constraints
1. **Short-Phone Landscape Fit**: Mobile landscape viewports can be `360px–430px` tall. Always check `@media (max-height: 540px)` and `(pointer: coarse)` rules, and respect `--hud-auto-scale` so the top-right Minimap never overlaps the bottom-right Ultimate/Skill wheel.
2. **Touch Stick 1:1 Scaling**: When changing touch button sizes (`data-btn-size` / `--hud-auto-scale`), keep visual thumbstick radius synced with pointer drag radius in `src/game.js`.
3. **Android WebView Text Inputs**: Keep `autocomplete="off" autocorrect="off" spellcheck="false"` on hero/room `<input type="text">` elements to prevent reversed-character IME bugs on Android WebViews, and ensure focused inputs stay visible above the landscape virtual keyboard.
4. **Sync After Edits**: Always run `npm test; npm run sync` (use `;` on Windows PowerShell 5.1) so `www/` reflects `index.html` and `styles/main.css` updates.
