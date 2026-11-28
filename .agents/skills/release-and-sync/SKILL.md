---
name: release-and-sync
description: >-
  Version bumping, patch notes, PWA cache invalidation, www/ sync, and Android APK release checklist
  for Chronicles of the Shattered Crown. Use whenever syncing web assets, bumping app versions,
  adding patch notes, adding new runtime sprites/VFX, or preparing a Capacitor/Android build.
---

# Release, Asset Sync & Version Bump Runbook

Follow this exact checklist instead of grepping across the workspace for version strings or asset manifests.

## 1. Adding New Runtime Assets (Sprites, Icons, Maps, VFX)
Root `assets/` and `spritecook-*/` are gitignored; only `www/` is shipped to Vercel, Render, and Android APK.
Whenever a new image/SVG/audio file is referenced by the game:
1. Register it in `src/assets.js` (if preloaded on canvas).
2. Add its relative path or folder to `ITEMS_TO_COPY` in `scripts/sync-www.js` (L7–35).
3. Add critical offline-first files to `PRECACHE_URLS` in `sw.js` (L3–190) and increment `CACHE_NAME` (`sw.js` L1).
4. Run `npm run sync` to copy root files into `www/`.

## 2. Version Bump & Patch Notes (All 5 Touchpoints)
Keep semver/display versions synchronized across all 5 files (mismatch breaks PvP `hasVersionMismatch` checks and APK self-update):
1. **`package.json` (L3)**: `"version": "X.Y.Z.W-beta"` (used by `.github/workflows/build-apk.yml`).
2. **`android/app/build.gradle` (L10–11)**: Increment integer `versionCode` (+1) and update `versionName "X.Y.Z.W-beta"`.
3. **`src/data.js` (L3 & L5+)**: Update `export const GAME_VERSION = "v.X.Y.Z.W Beta";` and prepend a new entry to `PATCH_NOTES`.
4. **`index.html` (L91 & L1079)**: Update static fallback text in `#menu-version-badge` and `#update-current-ver`.
5. **`sw.js` (L1)**: Increment `CACHE_NAME = "shattered-crown-vNN"`.

## 3. Single-Command Verification & Sync (PowerShell 5.1)
Always finish code/UI/version changes with one chained command using `;` (PS 5.1 rejects `&&`):
```powershell
npm test; node --check server.js; npm run sync
```
*(If testing Capacitor Android locally, append `; npx cap copy android`.)*
