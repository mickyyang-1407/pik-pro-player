# Pik Pro Player Handoff — 2026-07-01 (Claude Code → CodeX)

For: CodeX
Project: `/Users/mickyyang/Projects/pik-pro-player`
User: Micky

## Read This First

Claude Code is near its usage limit for this session and is handing off to CodeX. Continue from the current repository state. The user speaks Traditional Chinese and reviews the app visually (screenshots / live preview). Keep updates short, concrete, and in Traditional Chinese.

**Constraints (unchanged from the start of Claude Code's session, still apply):**
- Do not commit unless Micky explicitly asks.
- Do not touch `canvas/*`.
- Do not capture the whole desktop or unrelated apps.
- Update `~/STATUS.md` after each phase/checkpoint.
- **New rule from this session**: after any UI code change, proactively reload/refresh the live preview so Micky can see it without asking — do not just describe changes in text. (Saved as memory `feedback-always-show-preview.md`.)

## Current Git State

```bash
cd /Users/mickyyang/Projects/pik-pro-player
git status --short
#  M src/main.tsx
#  M src/styles.css
#  ?? PLAYER-ENGINE-PLAN.md
git log -1 --oneline
# 2772d76 auto: 2026-07-01 19:48 自動備份
```

**Important**: This repo has an hourly cron auto-backup that commits as `auto: <timestamp> 自動備份`. Nothing from this session is at risk of being lost — most of the session's work is already captured across several of those auto-commits (from `13426fa` at session start through `2772d76`). The `git status --short` output above is only the delta since the *last* auto-commit; it does not represent "everything done this session." Do not be alarmed by the small diff size — the real scope of this session's work is summarized below.

Nothing has been committed intentionally (no `git commit` was run by Claude Code this session apart from the auto-backup cron, which is not something Claude Code or CodeX triggers). Do not run `git commit` unless Micky explicitly asks.

## Dev Server

```bash
cd /Users/mickyyang/Projects/pik-pro-player
npm run tauri dev
```

For quick iteration Claude Code used the `Claude Preview` tool pointed at plain `npm run dev` (Vite only, port 1420) via `.claude/launch.json` (already created, safe to keep or ignore — it's just a dev-server launch config, not app code). If you have an equivalent preview/browser tool, prefer that over guessing; otherwise `npm run tauri dev` is the normal path.

One gotcha hit repeatedly this session: after many hot edits, the Vite dev server's HMR state can get corrupted and throw a **fake** error like `ReferenceError: draft is not defined` (referencing a signal that was renamed/removed many edits ago) even though `npm run build` is clean. If you see a console error that doesn't match the current source, **restart the dev server** before assuming it's a real bug.

## What Was Done This Session (chronological)

Claude Code picked up from a Codex→Claude Code handoff (`HANDOFF-2026-07-01-Claude-Code.md`, still in repo, useful background reading) that was mid-way through a 5-phase Metering redesign (P1-P5). Everything below happened after that handoff, all confirmed OK by Micky via live preview testing unless noted otherwise.

### Metering P1–P4 (LUFS / PPM / Target platforms / Pass-Warn-Fail) — ✅ done, confirmed OK
- P1 Loudness: Integrated LUFS is its own large card (36px bold), Range/Short/True Peak in one 3-column row below it.
- P2 PPM: single-column, 12 channels stacked vertically (`L/R/C/LFE/Ls/Rs/Lrs/Rrs/Ltf/Rtf/Ltr/Rtr`), horizontal bars, with a horizontal dB scale ruler above them (`ppmTicks`, light theme, quiet-to-loud left-to-right).
- P3 Target platforms: dropdown with Apple Music/Spotify/YouTube/Amazon Music/EBU R128/ATSC A-85 (well-known industry norms) **plus two Atmos-specific entries verified via live web research** (not guessed): `Atmos Music (-18)` (Apple Music/Amazon Music/Tidal, -18 LKFS / -1 dBTP, source: Dolby's official Atmos Music Delivery Playbook) and `Netflix Atmos (-27)` (-27 LKFS ±2 LU dialogue-gated, -2 dBTP, source: Netflix Partner Help Center official page). Sources are cited as code comments above the `targetPlatforms` array in `main.tsx`.
- P4 Pass/Warn/Fail: `lufsStatus`/`truePeakStatus` memos compare hardcoded mock measurements (`currentIntegratedLufs = -14.2`, `currentTruePeak = -1.1`) against the selected platform's target/tolerance. Status pill on the Integrated card, color-tinted True Peak cell, color-tinted LUFS Bar marker.
- P5 Polish: in progress. One real bug found and fixed: `.notes-panel` was missing `min-height: 0`, causing a classic CSS Grid "blowout" — when Notes Panel content grew, it silently overflowed past the visible window and got clipped by an ancestor's `overflow: hidden` instead of scrolling internally. Fixed. **P5 is not formally closed out** — no full "resize/zoom sweep + final screenshot review" pass has been done yet. That's a good candidate for CodeX's first task if nothing else is prioritized.

### Timeline / Transport T1–T4 — ✅ done, confirmed OK
- T1: Transport bar in the topbar (`.transport-bar`): Stop (■) / Play (▶ ↔ ❚❚, green) / Loop (🔁) buttons + live time readout. `h1` in the topbar now shows `trackTitle()` (currently a static signal defaulting to `'No File Loaded'`) instead of the old decorative "Mix Review Workspace" title.
- Mock playback clock: `isPlaying` / `playheadTime` / `loopEnabled` signals, driven by a `setInterval` (100ms tick, +0.1s), respecting `lockedRange` as a loop region. **This is intentionally isolated** so that hooking up a real audio engine later only requires replacing what drives `setPlayheadTime` — no other UI logic should need to change.
- T2: Playhead line on the Timeline (`.playhead`, orange, triangle marker). Global `N` key (via a `window.keydown` listener, guarded by `isTypingTarget` so it doesn't fire while typing) creates a point note at the current `playheadTime()` and immediately enters inline-edit mode on it, without pausing playback.
- T3: Click-and-drag on the Timeline still does range selection (pre-existing). New: clicking *inside* an already-selected range, or pressing `Enter`, creates a range note from the current selection and enters inline-edit mode. The "Add Range Note" button in the Notes Panel does the same thing (`addRangeNoteDraft()`), replacing the old separate free-text-then-click-button flow.
- T4: Delete notes from either the Timeline (hover → small × on the note marker) or the Notes Panel (× next to each note). Both call the same `deleteNote(id)`.

### Bugs fixed this session (read these before touching the Notes system — real lessons, not just changelog)

1. **Critical Solid.js `<For>` reconciliation bug** (the most important one): the Notes Panel's inline note-body textarea was originally a *controlled* input (`value={note.body}` + `onInput` calling `setNotes(...)`). Every keystroke created a new note object, and since `<For each={notes()}>` reconciles by object reference, every keystroke destroyed and recreated that note's entire DOM subtree — losing focus/cursor on every character typed. **Fixed by making it uncontrolled**: `ref` sets `el.value = note.body` once on mount, and `updateNoteBody(id, value)` is only called on blur/Enter (a single commit), never per-keystroke. **Rule for any future inline-edit-inside-a-`<For>`-list feature in this codebase: never wire `onInput` straight into the signal that drives the `<For>`'s array. Uncontrolled + commit-on-blur/Enter, always.**
2. Range-note duplication: creating a note via Enter/click-inside-box didn't mark that range as "already has a note," so pressing Enter again created a duplicate for the same range. Fixed by having `startEditingNote` immediately call `setSelectedNoteId(note.id)` — the existing "click an existing note to select/highlight it, which disables further creation on that range" mechanism now also applies to freshly-created notes.
3. Clicking an existing note range now correctly highlights it (`.is-selected` on both the Timeline marker and the Notes Panel item, with auto `scrollIntoView`) instead of allowing a duplicate "Add Range Note".
4. N-key created notes always landed at 00:00 when paused, because clicking the Timeline never moved `playheadTime`. Fixed: `onTimelineDown`'s "start a fresh drag" branch now also calls `setPlayheadTime(time)` — clicking the Timeline always seeks, whether playing or paused.
5. Severity-color inconsistency: point notes got a cyan/red left-accent tied to severity by coincidence (from `.is-point`'s default style), but range notes only ever showed red (critical) and never showed any color for minor. Fixed so the accent color is driven purely by `severity`, independent of `kind` (point vs range), on both the Timeline and the Notes Panel.

### Producer Workflow features (Phase N1–N2 of 6) — ✅ done, N3+ not started

After T1–T4, Micky asked Claude Code to also brainstorm "what else does a producer need when checking a mix" and to execute the resulting list one phase at a time, with Micky's explicit statement that he doesn't need to understand the technical details — "you (Claude Code / CodeX) decide, one phase at a time, report back for me to test after each one."

Full phase list (unchanged, still the plan to follow):

| Phase | Content | Needs real audio? | Status |
|---|---|---|---|
| N1 | Note severity tag (Critical/Minor, click to toggle) + search/status/severity filter bar | No | ✅ done |
| N2 | Export Notes as CSV (filter-aware, includes General Note) + export a Loudness Compliance Report (.txt) | No | ✅ done |
| **N3** | **Standard transport keyboard shortcuts: Space = play/pause, arrow keys = nudge/scrub playhead** | No | **← START HERE** |
| N4 | A/B version compare (data model can be prototyped now; real value needs E1) | Partial | Not started |
| N5 | Reference track loading + loudness-over-time graph | Yes | Not started |
| N6 | Correlation/phase meter + spectrum analyzer | Yes | Not started |

Also added along the way (not originally in the N-list, but shipped as part of N1/N2 polish since Micky asked in the moment):
- Clickable note status cycling: `open → checking → done → open` (was previously just static display text). Colors: open=grey (default), checking=amber (same visual language as the LUFS "Warn" state), done=green (same as "Pass").
- General Note card pinned at the top of the Notes Panel — a single free-text field not tied to any timecode, for overall mix impressions.
- Notes are now sorted by timecode (`sortedNotes` memo) instead of newest-first insertion order.

### Player Engine planning (not yet started, but thoroughly researched — read before starting E1)

Micky separately asked for an overall project plan to turn this from a mock UI into an actual working player. Claude Code wrote **`/Users/mickyyang/Projects/pik-pro-player/PLAYER-ENGINE-PLAN.md`** — read that file in full before starting any E-phase work. Summary of the one finding that matters most:

**The sibling project `~/Projects/pik-player` already has a working, native multichannel Atmos playback engine** at `src-tauri/src/player/atmos.rs` + `atmos_wrapper.m` (Rust wrapping an Objective-C bridge to `AVPlayer`/`AVMutableAudioMixInputParameters`/`MTAudioProcessingTap`). It already implements: play/pause/seek/position/duration reporting via a background thread + Tauri `Emitter` events, output device selection, EQ injection, **and per-channel RMS/Peak metering via vDSP for up to 12 channels with labels `L/R/C/LFE/Ls/Rs/Lrs/Rrs/Ltf/Rtf/Ltr/Rtr`** — the exact same 12-channel naming this app's PPM meter already uses. **Strong recommendation: port/adapt that code rather than building a playback engine from scratch with `cpal`/`symphonia`.** LUFS/True Peak (K-weighted, gated loudness) is *not* present there and would be new work — the plan recommends the `ebur128` crate (a Rust binding to the well-tested `libebur128` C library) over hand-rolling K-weighting filters.

The plan's phase breakdown (E1–E7) is in the file. High-level order: E1 file import + basic transport (port AtmosPlayer) → E2 real per-channel solo/mute → E3 real PPM (port vDSP tap, low effort) → E4 real LUFS (new, via `ebur128`) → E5 SQLite project persistence (notes currently only live in memory and are lost on reload — no persistence exists at all yet) → E6 waveform visualization (low priority) → E7 ADM BWF/`.atmos` format support (only if Micky's real files need it).

`src-tauri/Cargo.toml` currently has zero audio-related dependencies — this is 100% greenfield backend work.

## Key Files

- `src/main.tsx` (979 lines) — all SolidJS app logic + JSX. Single-file app, no component splitting yet.
- `src/styles.css` (1644 lines) — all styles, plain CSS, custom properties in `:root`.
- `PLAYER-ENGINE-PLAN.md` — the engine architecture plan, read before E-phase work.
- `HANDOFF-2026-07-01-Claude-Code.md` — the handoff Claude Code received at the start of this session (background on the Metering phases and earlier layout decisions).
- `~/STATUS.md` — cross-project status file, has a very detailed rolling log of every phase/fix this session under the `pik-pro-player` section. Read it for the full blow-by-blow if this handoff doc isn't enough detail.
- Memory files at `~/.claude/projects/-Users-mickyyang-Projects-pik-pro-player/memory/` (if your tooling reads Claude Code's memory format, otherwise treat this handoff + STATUS.md as the source of truth): `project-pik-pro-player.md` (full running log + locked-in decisions) and `feedback-always-show-preview.md` (the "always show preview after changes" rule).

## Locked-In Decisions (do not relitigate)

- White/light UI theme throughout, not the dark reference screenshots Micky occasionally shares for *color values only*.
- Speaker Room visual design is considered final ("定版").
- Notes Panel is fixed at 25% width, collapse/expand only — dragging to resize was deliberately removed and should not come back.
- Solo = blue/cyan, Mute = red, consistently across speaker buttons, group pills, and the Speaker View title.
- Tauri window is fixed-size per zoom level (50/75/100/125/150%), not freely resizable.
- `canvas/*` is never committed.
- Mock playback clock architecture (`isPlaying`/`playheadTime`/`loopEnabled` signals) is intentionally the seam where a real engine gets plugged in later — don't restructure this without a reason tied to E1.

## Immediate Next Step

Start **N3**: Space bar toggles play/pause, arrow keys nudge/scrub the playhead (left/right = small step, maybe with a modifier for a bigger jump — use judgment, keep it simple). Wire into the existing global `keydown` listener (already has the `isTypingTarget` guard and handles `n`/`Enter`). Test via live preview exactly like every other change this session: build, reload, exercise the feature with simulated events, check for console errors, leave a clean/reset state, update `~/STATUS.md`, then report to Micky and wait for his test/feedback before moving to N4.
