# Pik Pro Player Handoff

## 2026-06-30 Pause Checkpoint

### Current User Request

Micky asked to pause immediately and record progress/handoff.

### Current State

- Active project: `/Users/mickyyang/Projects/pik-pro-player`
- GitHub remote: `git@github.com:mickyyang-1407/pik-pro-player.git`
- Last pushed commit before this pause: `7425968 feat: refine speaker stage from canvas notes`
- Working tree is dirty. Do not assume the current changes are pushed.

### Important Context

Micky was unhappy with the previous speaker placement attempts because:

- The listener was being covered by speaker elements.
- The speakers were not centered correctly.
- The layout relied on manual percentage coordinates, which broke under resize/scale.
- The app allowed free resizing, causing the interface to fall apart.
- The first-open view must show the full Speaker View and the full Metering/Loudness panel.
- User zoom must be fixed choices only: `50%`, `75%`, `100%`, `125%`, `150%`.

### Work Done Since Last Commit

Files modified:

- `src/main.tsx`
- `src/styles.css`
- `src-tauri/tauri.conf.json`
- `PROGRESS.md`

Canvas files are also dirty because Micky drew/annotated in Cowart:

- `canvas/cowart-selection.json`
- `canvas/cowart-view-state.json`
- `canvas/pages/page/cowart-canvas.json`

Do not commit or revert the canvas files unless Micky explicitly asks.

### Implementation Direction Attempted

The latest in-progress code moves away from speaker `left/top` percentage coordinates and toward a grid-based room model:

- `Speaker` now uses `area: string`.
- `speakers` map to named CSS grid areas.
- `.speaker-grid` uses CSS `grid-template-areas`.
- `.listener-dot` has its own `listener` grid area.
- The listener is no longer positioned with absolute percentages.
- Tauri window config was changed to fixed size:
  - `width`: `1500`
  - `height`: `940`
  - `minWidth`: `1500`
  - `minHeight`: `940`
  - `resizable`: `false`
- A zoom selector was added in the top bar with fixed choices:
  - `50`
  - `75`
  - `100`
  - `125`
  - `150`

### Verification Run

Latest checks before pause:

- `npm run build`: PASS
- `npm run tauri:build`: PASS
- Latest visual screenshot was inspected manually. It improved the overlap problem, but Micky requested an immediate pause before final acceptance.

### Running Processes

- The directly launched `Pik Pro Player` binary session was stopped with Ctrl-C.
- Cowart canvas service may still be running from an earlier session on `http://127.0.0.1:43217/`.

### Next Agent Instructions

1. Start by reading `~/STATUS.md`, `PROGRESS.md`, and this `HANDOFF.md`.
2. Check `git status --short` before editing.
3. Do not commit canvas files unless Micky asks.
4. Continue from the grid-based speaker layout, not the old percentage-coordinate approach.
5. Before further UI changes, visually verify the actual app window, not the Cowart canvas screenshot.
6. If Micky resumes the speaker layout task, focus only on:
   - speaker room geometry,
   - fixed zoom choices,
   - fixed app window behavior,
   - first-open full visibility.

### Suggested Next Step

Ask Micky whether to keep the current grid-based direction and refine it, or revert the latest uncommitted layout attempt and rebuild the speaker room from a simpler static CSS grid mock.
