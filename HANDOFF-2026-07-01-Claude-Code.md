# Pik Pro Player Handoff - 2026-07-01

For: Claude Code
Project: `/Users/mickyyang/Projects/pik-pro-player`
User: Micky

## Read This First

Micky asked Codex to stop because the session is near the 5 hour limit. Continue from the current repository state, but do not make new UI changes until you understand this handoff.

The user speaks Traditional Chinese and is visually reviewing the app by screenshot. Keep updates short, concrete, and in Traditional Chinese.

Important constraints:
- Do not commit unless Micky explicitly asks.
- Do not touch `canvas/*`.
- Do not capture the whole desktop or unrelated apps. Earlier a screenshot accidentally captured Micky's work area; avoid that. If verification needs screenshots, use only the app window or ask Micky to provide screenshots.
- Update `~/STATUS.md` after each phase/checkpoint.
- The current task is layout/design work, not audio engine work.

## Current Git State

As of handoff creation:

```bash
cd /Users/mickyyang/Projects/pik-pro-player
git status --short
# clean
git log -1 --oneline
# 13426fa auto: 2026-07-01 10:48 自動備份
```

The current files already include the latest layout experiment. There are no uncommitted diffs at handoff time.

## Dev Server Notes

Normal local command should be:

```bash
cd /Users/mickyyang/Projects/pik-pro-player
npm run tauri dev
```

During Codex sandbox testing, Vite sometimes needed to be started separately:

```bash
npm run dev -- --host 127.0.0.1
npx tauri dev --config /private/tmp/pik-pro-tauri-use-existing-vite.json --no-dev-server-wait
```

Temp Tauri config exists at:

```text
/private/tmp/pik-pro-tauri-use-existing-vite.json
```

This was only for sandbox/dev-server collision handling. Claude Code can probably use the normal `npm run tauri dev` path.

Tauri window default is in:

```text
src-tauri/tauri.conf.json
```

Current default size:

```json
"width": 1500,
"height": 940,
"resizable": false
```

## Checkpoint / Rollback

Before the big "merge Top Monitoring View into Speaker View" experiment, a file checkpoint was created:

```text
/private/tmp/pik-pro-checkpoints/metering-p2-before-speaker-header-merge/main.tsx
/private/tmp/pik-pro-checkpoints/metering-p2-before-speaker-header-merge/styles.css
```

If Micky says the experiment is bad and wants rollback:

```bash
cd /Users/mickyyang/Projects/pik-pro-player
cp /private/tmp/pik-pro-checkpoints/metering-p2-before-speaker-header-merge/main.tsx src/main.tsx
cp /private/tmp/pik-pro-checkpoints/metering-p2-before-speaker-header-merge/styles.css src/styles.css
npm run build
```

Do not use git reset unless Micky explicitly requests it.

## What Micky Likes So Far

- Overall white/light UI direction.
- Speaker room visual language is mostly considered "定版".
- Pressed/active top speakers now use the rounded rectangle shape Micky liked.
- Solo = cyan/blue, Mute = red. This must apply consistently to:
  - group pills
  - direct speaker clicks
  - status text in the Speaker View title
- Right notes panel should only collapse/open. The draggable divider should not be draggable anymore because the speaker/group-pills layout cannot gracefully shrink.

## Recent Completed Fixes

Speaker mode / color fixes:
- Mute pill now changes group action label from Solo to Mute.
- Mute state uses red background and red text where relevant.
- Direct speaker clicks in mute mode also use red.
- Solo remains cyan/blue.

Layout/system fixes:
- A previous blank-window problem came from an unsafe `.scaled-app` width/height calc. It was corrected back to:
  - `.scaled-app { width: 100%; height: 100%; }`
  - `.review-app { overflow: hidden; }`
- Whole-app scrolling should be avoided. If anything scrolls later, it should ideally be the Notes Panel content, not the entire player.

## Metering Phase Plan

Micky asked for this as phased work. Current work is still in P1/P2 refinement; do not start P3 until the layout is accepted.

### P1 - LUFS / Loudness

Goal:
- Keep the top important loudness values clear.
- Add horizontal loudness bar metering.
- Include Short Term Max / Momentary Max if space allows.
- Include LUFS on/off toggle.

Current status:
- Implemented, but currently visually cramped because LUFS and PPM are side-by-side in the left card.
- Needs layout refinement now.

### P2 - PPM 12 Channels

Goal:
- Show all 12 channels:
  `L, R, C, LFE, Ls, Rs, Lrs, Rrs, Ltf, Rtf, Ltr, Rtr`
- Include PPM on/off toggle.
- Fit without looking painful.

Current status:
- Implemented as a vertical 12-channel PPM meter.
- It is too cramped. Micky wants this changed.

### P3 - Target Platform / Atmos Research

Goal:
- Add target/platform loudness presets.
- Must include Atmos-related targets/references because this player will support Atmos.
- Micky explicitly said: when this phase starts, research it carefully.

Do not start yet.

### P4 - Target Status / Warnings

Goal:
- Compare current measurements against selected target.
- Show clear pass/warn/fail style feedback.

Do not start yet.

### P5 - Polish / Verification

Goal:
- Responsive fit at default Tauri window size.
- No whole-app scroll unless intentionally scoped.
- Notes Panel scrolls internally if content grows.
- Visual screenshot review with Micky.

Do not start yet.

## Current Big Layout Experiment

Micky proposed a larger structural change:
- Remove the separate top `Top Monitoring View` header strip.
- Put `Speaker Room / Top Monitoring View` inside the Speaker View card.
- Shrink pills.
- Disable divider dragging.
- Use the recovered vertical space for Loudness/Metering.

This experiment is currently in the repo.

Current relevant JSX:

```text
src/main.tsx
```

Key areas:
- `meterRows`: near top, 12 PPM channels.
- `notesWidth`: still exists but divider is disabled.
- `panelWidth`: currently still uses `notesWidth()` when expanded.
- `workspaceGrid`: uses `minmax(0, 1fr) 10px ${panelWidth()}`.
- `.speaker-stage` contains:
  - `.room-wrap`
  - `.analysis-panel`
  - `.speaker-view`
  - `.timeline-card`
- `.speaker-control-bar` is now inside `.speaker-view`.
- `.panel-resizer` has `is-disabled` and prevents pointer down.

Current relevant CSS:

```text
src/styles.css
```

Key areas:
- `.speaker-stage`
- `.room-wrap`
- `.analysis-panel`
- `.meter-list`, `.ppm-grid`, `.ppm-meters`, `.ppm-channel`
- `.speaker-view`
- `.speaker-control-bar`
- `.room-plane`
- speaker position classes around `.speaker.*`
- `.panel-resizer`
- `.notes-panel`

## Micky's Latest Requested Direction

Do these one block at a time. The latest user message asked for confirmation, but now Micky is handing off to Claude Code, so the next agent should continue from this exact plan.

### 1. Loudness Block

Current problem:
- LUFS and PPM are side-by-side.
- Text wraps ugly and information is cramped.

Desired direction:
- Loudness/LUFS stays on top.
- PPM becomes horizontal and goes below.
- This should give all text enough room and avoid awkward line breaks.

Suggested implementation:
- Change `.analysis-panel` from side-by-side grid to vertical stack:
  - heading
  - loudness readout
  - loudness stats
  - loudness bar
  - horizontal PPM
- Redesign PPM as horizontal meter rows, likely 12 compact rows in two columns, or one full-width dense horizontal meter grid.
- Keep the white UI style. Do not copy dark reference colors.

### 2. Notes Panel Block

Current problem:
- Notes Panel is taking too much width.

Desired direction:
- Shrink Notes Panel more to the right.
- Leave more room for Speaker Room.
- Keep collapse/open only; do not restore drag resizing.

Suggested implementation:
- Change `panelWidth` to a fixed expanded value, probably `24%` to `26%`.
- Since dragging is disabled, `notesWidth` and resize handlers can stay unused for now or be cleaned later if safe.
- Keep collapsed width around `52px`.

Possible change:

```ts
const panelWidth = createMemo(() => (notesCollapsed() ? '52px' : '25%'));
```

### 3. Speaker Room Block

Current problem:
- The speaker control/header area still feels crowded.
- Speaker View content can overflow visually.

Desired direction:
- In the top area, put `SOLO/MUTE` on the upper row.
- Put group pills (`Front / Side / Rear / Top / LFE / Clear`) on the lower row.
- Slightly compress Speaker View on Y-axis if needed.
- Pull `Ls` and `Rs` inward. They should protrude only a little more than the `L/Lrs` and `R/Rrs` columns.

Suggested implementation:
- Change `.speaker-control-bar` from one flex row to a small two-row layout.
- Consider:
  - row 1: title left, solo/mute right
  - row 2: group pills full width, compact gaps
- Speaker positions are CSS-driven, so adjust side speaker placement and/or grid columns rather than changing data.
- Keep speaker-room aspect behavior: do not distort shapes. The room may scale horizontally with available width, but speaker shapes should remain visually consistent.

## Important Visual Bugs To Avoid

- Do not let the whole Tauri app scroll vertically at default size.
- Do not let the PPM labels rotate/cram until unreadable.
- Do not let group pills overflow or disappear when Notes Panel is open.
- Do not re-enable dragging on the right divider.
- Do not let active/mute color regress:
  - Solo = cyan/blue
  - Mute = red
- Do not move into P3 target research until Micky accepts the layout cleanup.

## Verification

After each meaningful phase:

```bash
cd /Users/mickyyang/Projects/pik-pro-player
npm run build
```

Then update:

```text
~/STATUS.md
```

When showing Micky screenshots:
- Prefer Micky-provided screenshots.
- If taking your own, crop to the Pik Pro Player window only.

## Suggested Next Move

Start with the smallest high-impact change:

1. Make Notes Panel fixed/narrower at about `25%`.
2. Split `.speaker-control-bar` into two rows so pills stop competing with the title.
3. Convert `.analysis-panel` to vertical stack and make PPM horizontal below LUFS.
4. Run `npm run build`.
5. Ask Micky for visual review before starting P3.

