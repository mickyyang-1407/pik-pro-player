# Pik Pro Player Progress

## 2026-06-30 Reset

### Completed

- Archived mixed/failed workspace contents to `_legacy/2026-06-30-pik-pro-reset/`.
- Created clean Tauri v2 + SolidJS skeleton.
- Added reset notes to prevent old Pik Player / Pik Review context from being reused accidentally.
- Installed fresh npm dependencies.
- Verified frontend production build.
- Verified Rust backend with `cargo check`.
- Verified macOS app bundle build.

### Verification

- `npm install`: PASS, 0 vulnerabilities.
- `npm run build`: PASS.
- `cargo check` in `src-tauri`: PASS.
- `npm run tauri:build`: PASS.
- Built app: `src-tauri/target/release/bundle/macos/Pik Pro Player.app`
- GitHub remote: `git@github.com:mickyyang-1407/pik-pro-player.git`
- Baseline commit: `3ead1d8 chore: reset clean pik pro player baseline`

### Current Status

Phase 0 reset baseline is complete and pushed to GitHub `main`.

### Next Product Work After Baseline

Define Phase 1 from scratch for Pik Pro Player:

- Professional review layout
- Real import/playback architecture decision
- Project/version/note model
- Speaker room visualization

## 2026-06-30 Phase 1 UI Prototype

### Completed

- Replaced reset landing screen with the first professional review workspace.
- Implemented a 70% speaker stage / 30% notes panel layout.
- Added draggable notes panel width, clamped between 24% and 42%.
- Added collapsible right notes panel.
- Implemented a light Apple-style visual direction with white surfaces and cyan accents.
- Added a 3D-perspective 7.1.4 speaker room mockup.
- Enlarged speaker buttons and added hover/active cyan glow states.
- Implemented left-button timeline drag to lock a time range.
- Notes bind to time ranges, not single-point timecodes.
- Timeline pointer-down immediately locks the current timecode/range.

### Verification

- `npm run build`: PASS.
- `npm run tauri:build`: PASS.

### Notes

- This is still a frontend prototype. It does not yet connect to real playback, import, SQLite, or audio meters.

## 2026-06-30 Phase 1 Canvas Fixes

### Completed

- Changed the speaker area from angled perspective to a direct top-down view.
- Made group buttons function as solo selectors:
  - Front: L/C/R
  - Side: Ls/Rs
  - Rear: Lrs/Rrs
  - Top: Ltf/Rtf/Ltr/Rtr
  - LFE: independent solo
- Split the main speaker stage into two blocks:
  - Left: Metering and Loudness placeholder panel
  - Right: Speaker View
- Reworked speaker layout into a rectangular room:
  - Front row: L/C/R
  - LFE between L and C, slightly behind the front row
  - Side and rear speakers aligned as separate rows
  - Top speakers form a square around the listener

### Verification

- `npm run build`: PASS.
- `npm run tauri:build`: PASS.

## 2026-06-30 Speaker Position Adjustment

### Completed

- Adjusted the top-down speaker coordinates to match Micky's provided reference image.
- Front row now places L/C/R across the upper center.
- LFE now sits between L and C, slightly below the front row.
- Ls/Rs now sit on the side row.
- Lrs/Rrs now sit on the rear row.
- Top speakers now form a square around the listener.
- Listener position was moved down to sit between the top-front and top-rear speakers.

### Verification

- `npm run build`: PASS.
- `npm run tauri:build`: PASS.

## 2026-06-30 Speaker Layout Correction

### Problem

- The previous implementation used absolute percentage coordinates for speakers.
- That made the speaker layout fragile: resizing or changing the available panel width caused the room to distort.
- Listener could be covered by top speakers, and the speaker group was not reliably centered.

### Correction Direction

- Replace percentage-coordinate placement with a calculated CSS grid layout using named speaker cells.
- Keep the listener in its own center cell so no speaker can overlap it.
- Ensure the first app open shows the full Speaker View and complete Metering/Loudness panel.
- Disable free window resizing in Tauri; expose fixed UI zoom choices instead: 50%, 75%, 100%, 125%, 150%.

### Completed

- Replaced speaker placement with CSS grid named areas.
- Added a fixed listener grid cell so speakers cannot overlap listener.
- Added a fixed UI zoom selector: 50%, 75%, 100%, 125%, 150%.
- Set the Tauri window to a fixed 1500x940, non-resizable desktop window.
- Adjusted the speaker grid so all speakers are visible on first open with the Metering/Loudness panel also visible.

### Verification

- `npm run build`: PASS.
- `npm run tauri:build`: PASS.
- Visual screenshot check: PASS; all speakers are visible inside Speaker View, and Metering/Loudness is visible on first open.

### Pause

- Micky asked to pause immediately before final acceptance of this layout. See `HANDOFF.md`.
