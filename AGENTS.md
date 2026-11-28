# Chronicles of the Shattered Crown — Token-Lean Agent Rules

Vanilla ES-module 2D Canvas RPG + 1v1 WebSocket PvP + Capacitor Android APK (`com.shatteredcrown.rpg`).

## Strict Context & Quota Rules
1. **Never read generated/mirrored trees**: `www/` is generated from root (`npm run sync`). Always edit root `index.html`, `sw.js`, `styles/`, and `src/` — NEVER inspect or edit `www/` or `android/app/src/main/assets/public/` directly.
2. **Surgical line-range reads only**: Several files exceed 1,300–3,500 lines (`styles/main.css`, `styles/pvp.css`, `src/data.js`, `src/pvp.js`, `src/world.js`, `src/renderer.js`, `src/combat.js`, `src/dialogs.js`). Never read whole large files. Activate the matching `.agents/skills/*` skill or run `node .agents/skills/codebase-map/scripts/find-landmarks.js <file>` first, then `read_file` with narrow `StartLine`–`EndLine` (~80–160 lines).
3. **Skip raw asset directories**: Do not scan `spritecook-*/`, `assets/`, or `node_modules/` unless explicitly working on sprites/audio (`src/assets.js` + `scripts/sync-www.js` list active runtime assets).
4. **One-command verification (Windows PowerShell 5.1)**: Use `;` (NOT `&&`, which errors in PS 5.1): `npm test; node --check server.js; npm run sync` (syncs root -> `www/`).
