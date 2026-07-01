import { For, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import './styles.css';

const BASE_W = 1500;
const BASE_H = 940;

type Speaker = {
  label: string;
  group: 'front' | 'side' | 'rear' | 'top' | 'lfe';
  area: string;
};

type Note = {
  id: number;
  rangeStart: number;
  rangeEnd: number;
  body: string;
  status: 'open' | 'checking' | 'done';
  kind: 'point' | 'range';
  severity: 'critical' | 'minor';
};

const durationSeconds = 214;
const PLAYHEAD_NUDGE_SECONDS = 1;
const PLAYHEAD_SCRUB_SECONDS = 5;
const zoomOptions = [50, 75, 100, 125, 150];

const currentIntegratedLufs = -14.2;
const currentTruePeak = -1.1;

type TargetStatus = 'pass' | 'warn' | 'fail';

const statusLabel: Record<TargetStatus, string> = { pass: 'Pass', warn: 'Warn', fail: 'Fail' };

const speakers: Speaker[] = [
  { label: 'L',   group: 'front', area: 'left' },
  { label: 'C',   group: 'front', area: 'center' },
  { label: 'R',   group: 'front', area: 'right' },
  { label: 'LFE', group: 'lfe',   area: 'lfe' },
  { label: 'Ls',  group: 'side',  area: 'leftSide' },
  { label: 'Rs',  group: 'side',  area: 'rightSide' },
  { label: 'Lrs', group: 'rear',  area: 'leftRear' },
  { label: 'Rrs', group: 'rear',  area: 'rightRear' },
  { label: 'Ltf', group: 'top',   area: 'leftTopFront' },
  { label: 'Rtf', group: 'top',   area: 'rightTopFront' },
  { label: 'Ltr', group: 'top',   area: 'leftTopRear' },
  { label: 'Rtr', group: 'top',   area: 'rightTopRear' },
];

const meterRows = [
  { label: 'L', value: 72 },
  { label: 'R', value: 69 },
  { label: 'C', value: 78 },
  { label: 'LFE', value: 52 },
  { label: 'Ls', value: 42 },
  { label: 'Rs', value: 45 },
  { label: 'Lrs', value: 38 },
  { label: 'Rrs', value: 36 },
  { label: 'Ltf', value: 31 },
  { label: 'Rtf', value: 33 },
  { label: 'Ltr', value: 28 },
  { label: 'Rtr', value: 30 },
];

const loudnessTicks = ['-inf', '-54', '-45', '-36', '-16', '-9', '-6', '-3', '0'];
const ppmTicks = ['-inf', '-54', '-45', '-36', '-27', '-24', '-18', '-9', '-6', '-1'];

const loudnessPosition = (value: number) => `${Math.max(0, Math.min(100, ((value + 60) / 60) * 100))}%`;

type TargetPlatform = { id: string; label: string; target: number; truePeak: number; tolerance?: number; note?: string };

// Stereo/broadcast targets: widely published industry norms (Spotify/YouTube -14, Apple Sound Check -16,
// Amazon Music -14/-2dBTP, EBU R128 -23, ATSC A/85 -24).
// Atmos entries verified 2026-07-01 against official sources:
//   - Dolby Atmos Music (Apple Music / Amazon Music / Tidal): -18 LKFS, -1 dBTP
//     https://www.dolby.com/siteassets/dolby-creator-lab/dolby-atmos-music-accelerator/dolby-atmos-music-delivery-playbook-1.pdf
//   - Netflix Dolby Atmos Home Mix: -27 LKFS +/-2 LU dialogue-gated (ITU-R BS.1770-1), -2 dBFS true peak
//     https://partnerhelp.netflixstudios.com/hc/en-us/articles/115001539991-Netflix-Dolby-Atmos-Home-Mix-Deliverable-Requirements-v2-3
const targetPlatforms: TargetPlatform[] = [
  { id: 'apple', label: 'Apple Music (-16)', target: -16, truePeak: -1 },
  { id: 'spotify', label: 'Spotify (-14)', target: -14, truePeak: -1 },
  { id: 'youtube', label: 'YouTube (-14)', target: -14, truePeak: -1 },
  { id: 'amazon', label: 'Amazon Music (-14)', target: -14, truePeak: -2 },
  { id: 'ebu', label: 'EBU R128 (-23)', target: -23, truePeak: -1 },
  { id: 'atsc', label: 'ATSC A/85 (-24)', target: -24, truePeak: -2 },
  { id: 'atmos-music', label: 'Atmos Music (-18)', target: -18, truePeak: -1, note: 'Dolby Atmos: Apple Music / Amazon Music / Tidal' },
  { id: 'atmos-netflix', label: 'Netflix Atmos (-27)', target: -27, truePeak: -2, tolerance: 2, note: 'dialogue-gated ±2 LU, BS.1770-1' },
];

const seedNotes: Note[] = [
  {
    id: 1,
    rangeStart: 38,
    rangeEnd: 58,
    body: 'Verse low-mid feels crowded. Try a tighter pocket around 180 Hz.',
    status: 'open',
    kind: 'range',
    severity: 'critical',
  },
  {
    id: 2,
    rangeStart: 95,
    rangeEnd: 153,
    body: 'Chorus lift works. Check vocal edge after the downbeat.',
    status: 'checking',
    kind: 'range',
    severity: 'minor',
  },
];

function formatTime(seconds: number) {
  const clamped = Math.max(0, Math.min(durationSeconds, seconds));
  const minutes = Math.floor(clamped / 60);
  const wholeSeconds = Math.floor(clamped % 60);
  return `${minutes.toString().padStart(2, '0')}:${wholeSeconds.toString().padStart(2, '0')}`;
}

let noteIdSeed = 100;
const nextNoteId = () => ++noteIdSeed;

const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable;
};

const isControlTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'BUTTON' || target.tagName === 'SELECT' || isTypingTarget(target);
};

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function safeFileName(name: string) {
  return name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'session';
}

function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function App() {
  const [notesWidth, setNotesWidth] = createSignal(30);
  const [zoom, setZoom] = createSignal(100);
  const [notesCollapsed, setNotesCollapsed] = createSignal(false);
  const [lockedRange, setLockedRange] = createSignal({ start: 95, end: 153 });
  const [notes, setNotes] = createSignal(seedNotes);
  const sortedNotes = createMemo(() => [...notes()].sort((a, b) => a.rangeStart - b.rangeStart));
  const [generalNote, setGeneralNote] = createSignal('');
  const [editingNoteId, setEditingNoteId] = createSignal<number | null>(null);
  const [selectedNoteId, setSelectedNoteId] = createSignal<number | null>(null);
  const [noteSearch, setNoteSearch] = createSignal('');
  const [statusFilter, setStatusFilter] = createSignal<'all' | 'open' | 'checking' | 'done'>('all');
  const [severityFilter, setSeverityFilter] = createSignal<'all' | 'critical' | 'minor'>('all');
  const filteredSortedNotes = createMemo(() => {
    const query = noteSearch().trim().toLowerCase();
    const status = statusFilter();
    const severity = severityFilter();
    return sortedNotes().filter((note) => {
      if (note.id === editingNoteId() || note.id === selectedNoteId()) return true;
      if (status !== 'all' && note.status !== status) return false;
      if (severity !== 'all' && note.severity !== severity) return false;
      if (query && !note.body.toLowerCase().includes(query)) return false;
      return true;
    });
  });
  const [trackTitle] = createSignal('No File Loaded');
  const [isPlaying, setIsPlaying] = createSignal(false);
  const [playheadTime, setPlayheadTime] = createSignal(0);
  const [loopEnabled, setLoopEnabled] = createSignal(false);
  const [activeSpeakers, setActiveSpeakers] = createSignal<Set<string>>(new Set(['C']));
  const [soloGroups, setSoloGroups] = createSignal<Set<Speaker['group']>>(new Set());
  const [speakerMode, setSpeakerMode] = createSignal<'solo' | 'mute'>('solo');

  const toggleGroup = (groupId: Speaker['group'], shift: boolean) => {
    if (shift) {
      setSoloGroups((prev) => {
        const next = new Set(prev);
        if (next.has(groupId)) next.delete(groupId);
        else next.add(groupId);
        return next;
      });
      return;
    }
    const isSoleSelection = soloGroups().size === 1 && soloGroups().has(groupId) && activeSpeakers().size === 0;
    setActiveSpeakers(new Set<string>());
    setSoloGroups(isSoleSelection ? new Set<Speaker['group']>() : new Set<Speaker['group']>([groupId]));
  };

  const toggleSpeaker = (label: string, shift: boolean) => {
    if (shift) {
      setActiveSpeakers((prev) => {
        const next = new Set(prev);
        if (next.has(label)) next.delete(label);
        else next.add(label);
        return next;
      });
      return;
    }
    const isSoleSelection = activeSpeakers().size === 1 && activeSpeakers().has(label) && soloGroups().size === 0;
    setSoloGroups(new Set<Speaker['group']>());
    setActiveSpeakers(isSoleSelection ? new Set<string>() : new Set<string>([label]));
  };

  const selectionLabel = createMemo(() => {
    const parts = [...soloGroups()].map((g) => g.toUpperCase()).concat([...activeSpeakers()]);
    if (parts.length === 0) return 'All';
    return `${parts.join('+')} ${speakerMode() === 'mute' ? 'Mute' : 'Solo'}`;
  });
  const [lufsEnabled, setLufsEnabled] = createSignal(true);
  const [targetPlatformId, setTargetPlatformId] = createSignal(targetPlatforms[0].id);
  const targetPlatform = createMemo(() => targetPlatforms.find((p) => p.id === targetPlatformId()) ?? targetPlatforms[0]);
  const lufsStatus = createMemo<TargetStatus>(() => {
    const tolerance = targetPlatform().tolerance ?? 1;
    const diff = Math.abs(currentIntegratedLufs - targetPlatform().target);
    if (diff <= tolerance) return 'pass';
    if (diff <= tolerance + 2) return 'warn';
    return 'fail';
  });
  const truePeakStatus = createMemo<TargetStatus>(() => {
    const headroom = targetPlatform().truePeak - currentTruePeak;
    if (headroom >= 0) return 'pass';
    if (headroom >= -0.5) return 'warn';
    return 'fail';
  });
  const [ppmEnabled, setPpmEnabled] = createSignal(true);
  const [dragStart, setDragStart] = createSignal<number | null>(null);
  const [dragNow, setDragNow] = createSignal<number | null>(null);
  const [isDraggingTimeline, setIsDraggingTimeline] = createSignal(false);
  const [isResizingNotes, setIsResizingNotes] = createSignal(false);

  let timelineEl: HTMLDivElement | undefined;
  let roomPlaneEl: HTMLDivElement | undefined;
  const [gridScale, setGridScale] = createSignal(1);
  const BASE_ROOM_W = 560;

  const panelWidth = createMemo(() => (notesCollapsed() ? '52px' : '25%'));
  const workspaceGrid = createMemo(() => `minmax(0, 1fr) 10px ${panelWidth()}`);

  const displayRange = createMemo(() => {
    const start = dragStart();
    const current = dragNow();
    if (start !== null && current !== null) {
      return {
        start: Math.min(start, current),
        end: Math.max(start, current),
      };
    }
    return lockedRange();
  });

  const selectedRangeLabel = createMemo(
    () => `${formatTime(displayRange().start)} - ${formatTime(displayRange().end)}`
  );

  let playTimer: ReturnType<typeof setInterval> | undefined;
  createEffect(() => {
    if (isPlaying()) {
      if (playTimer) return;
      playTimer = setInterval(() => {
        setPlayheadTime((t) => {
          const next = t + 0.1;
          const range = lockedRange();
          if (loopEnabled() && range.end > range.start) {
            return next >= range.end ? range.start : next;
          }
          if (next >= durationSeconds) {
            setIsPlaying(false);
            return durationSeconds;
          }
          return next;
        });
      }, 100);
    } else if (playTimer) {
      clearInterval(playTimer);
      playTimer = undefined;
    }
  });
  onCleanup(() => {
    if (playTimer) clearInterval(playTimer);
  });

  const togglePlay = () => setIsPlaying((playing) => !playing);
  const stopPlayback = () => {
    setIsPlaying(false);
    setPlayheadTime(0);
  };
  const toggleLoop = () => setLoopEnabled((enabled) => !enabled);
  const nudgePlayhead = (deltaSeconds: number) => {
    setPlayheadTime((time) => Math.max(0, Math.min(durationSeconds, time + deltaSeconds)));
  };

  const startEditingNote = (note: Note) => {
    setNotes((current) => [note, ...current]);
    setEditingNoteId(note.id);
    setSelectedNoteId(note.id);
  };

  const addPointNoteAtPlayhead = () => {
    const time = playheadTime();
    startEditingNote({ id: nextNoteId(), rangeStart: time, rangeEnd: time, body: '', status: 'open', kind: 'point', severity: 'minor' });
  };

  const addRangeNoteDraft = () => {
    const range = displayRange();
    if (range.end <= range.start) return;
    startEditingNote({ id: nextNoteId(), rangeStart: range.start, rangeEnd: range.end, body: '', status: 'open', kind: 'range', severity: 'minor' });
  };

  const updateNoteBody = (id: number, body: string) => {
    setNotes((current) => current.map((note) => (note.id === id ? { ...note, body } : note)));
  };

  const toggleSeverity = (id: number) => {
    setNotes((current) => current.map((note) => (note.id === id ? { ...note, severity: note.severity === 'critical' ? 'minor' : 'critical' } : note)));
  };

  const nextStatus: Record<Note['status'], Note['status']> = { open: 'checking', checking: 'done', done: 'open' };
  const cycleStatus = (id: number) => {
    setNotes((current) => current.map((note) => (note.id === id ? { ...note, status: nextStatus[note.status] } : note)));
  };

  const deleteNote = (id: number) => {
    setNotes((current) => current.filter((note) => note.id !== id));
    setEditingNoteId((current) => (current === id ? null : current));
    setSelectedNoteId((current) => (current === id ? null : current));
  };

  const selectNote = (note: Note) => {
    setSelectedNoteId(note.id);
    setLockedRange({ start: note.rangeStart, end: note.rangeEnd });
  };

  const exportNotesCsv = () => {
    const rows: string[][] = [['Time', 'Kind', 'Severity', 'Status', 'Note']];
    const general = generalNote().trim();
    if (general) {
      rows.push(['General', 'general', '-', '-', general]);
    }
    filteredSortedNotes().forEach((note) => {
      const time = note.kind === 'point' ? formatTime(note.rangeStart) : `${formatTime(note.rangeStart)} - ${formatTime(note.rangeEnd)}`;
      rows.push([time, note.kind, note.severity, note.status, note.body]);
    });
    const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
    downloadTextFile(`${safeFileName(trackTitle())}-notes.csv`, csv, 'text/csv;charset=utf-8');
  };

  const exportComplianceReport = () => {
    const platform = targetPlatform();
    const lufsDiff = Math.abs(currentIntegratedLufs - platform.target);
    const peakHeadroom = platform.truePeak - currentTruePeak;
    const lines = [
      'Pik Pro Player - Loudness Compliance Report',
      `Generated: ${new Date().toLocaleString()}`,
      `Track: ${trackTitle()}`,
      '',
      `Target Platform: ${platform.label}${platform.note ? ` (${platform.note})` : ''}`,
      `Target Loudness: ${platform.target} LKFS (tolerance +/-${platform.tolerance ?? 1} LU)`,
      `Max True Peak: ${platform.truePeak} dBTP`,
      '',
      `Measured Integrated LUFS: ${currentIntegratedLufs} LUFS -> ${statusLabel[lufsStatus()].toUpperCase()} (diff ${lufsDiff.toFixed(1)} LU vs target)`,
      `Measured True Peak: ${currentTruePeak} dBTP -> ${statusLabel[truePeakStatus()].toUpperCase()} (headroom ${peakHeadroom.toFixed(1)} dB vs limit)`,
    ];
    downloadTextFile(`${safeFileName(trackTitle())}-loudness-report.txt`, lines.join('\n'), 'text/plain;charset=utf-8');
  };

  createEffect(() => {
    const id = selectedNoteId();
    if (id === null) return;
    document.querySelector(`[data-note-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  onMount(() => {
    const onGlobalKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        addPointNoteAtPlayhead();
        return;
      }
      if (event.key === ' ' || event.code === 'Space') {
        if (isControlTarget(event.target)) return;
        event.preventDefault();
        togglePlay();
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (isControlTarget(event.target)) return;
        event.preventDefault();
        const step = event.shiftKey ? PLAYHEAD_SCRUB_SECONDS : PLAYHEAD_NUDGE_SECONDS;
        nudgePlayhead(event.key === 'ArrowLeft' ? -step : step);
        return;
      }
      if (event.key === 'Enter') {
        if (isControlTarget(event.target)) return;
        const range = lockedRange();
        if (selectedNoteId() === null && range.end > range.start) {
          event.preventDefault();
          addRangeNoteDraft();
        }
      }
    };
    window.addEventListener('keydown', onGlobalKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onGlobalKeyDown));
  });

  const timeFromPointer = (clientX: number) => {
    if (!timelineEl) return 0;
    const rect = timelineEl.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return percent * durationSeconds;
  };

  const onTimelineDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const time = timeFromPointer(event.clientX);
    const range = lockedRange();
    if (selectedNoteId() === null && range.end > range.start && time >= range.start && time <= range.end) {
      addRangeNoteDraft();
      return;
    }
    setSelectedNoteId(null);
    setPlayheadTime(time);
    setDragStart(time);
    setDragNow(time);
    setLockedRange({ start: time, end: time });
    setIsDraggingTimeline(true);
    timelineEl?.setPointerCapture(event.pointerId);
  };

  const onTimelineMove = (event: PointerEvent) => {
    if (!isDraggingTimeline()) return;
    const current = timeFromPointer(event.clientX);
    const start = dragStart() ?? current;
    setDragNow(current);
    setLockedRange({
      start: Math.min(start, current),
      end: Math.max(start, current),
    });
  };

  const onTimelineUp = (event: PointerEvent) => {
    if (!isDraggingTimeline()) return;
    onTimelineMove(event);
    setIsDraggingTimeline(false);
    setDragStart(null);
    setDragNow(null);
  };

  const onResizeDown = (event: PointerEvent) => {
    if (notesCollapsed()) return;
    event.preventDefault();
    setIsResizingNotes(true);
    window.addEventListener('pointermove', onResizeMove);
    window.addEventListener('pointerup', onResizeUp, { once: true });
  };

  const onResizeMove = (event: PointerEvent) => {
    const width = window.innerWidth;
    const next = ((width - event.clientX) / width) * 100;
    setNotesWidth(Math.max(24, Math.min(42, next)));
  };

  const onResizeUp = () => {
    setIsResizingNotes(false);
    window.removeEventListener('pointermove', onResizeMove);
  };

  onCleanup(() => {
    window.removeEventListener('pointermove', onResizeMove);
  });

  onMount(() => {
    if (!roomPlaneEl) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setGridScale(Math.min(1, w / BASE_ROOM_W));
    });
    ro.observe(roomPlaneEl);
    onCleanup(() => ro.disconnect());
  });

  return (
    <main class="review-app" style={{ '--ui-zoom': `${zoom() / 100}` }}>
      <div class="scaled-app">
      <header class="topbar">
        <div class="topbar-title">
          <p class="eyebrow">Pik Pro Player</p>
          <div class="title-row">
            <h1>{trackTitle()}</h1>
            <div class="transport-bar">
              <button type="button" class="transport-btn is-stop" onClick={stopPlayback} aria-label="Stop">■</button>
              <button
                type="button"
                class="transport-btn is-play"
                classList={{ 'is-active': isPlaying() }}
                onClick={togglePlay}
                aria-label={isPlaying() ? 'Pause' : 'Play'}
              >
                {isPlaying() ? '❚❚' : '▶'}
              </button>
              <button
                type="button"
                class="transport-btn is-loop"
                classList={{ 'is-active': loopEnabled() }}
                onClick={toggleLoop}
                aria-label="Loop"
              >
                🔁
              </button>
              <span class="transport-time">{formatTime(playheadTime())}</span>
            </div>
          </div>
        </div>
        <div class="topbar-controls">
          <label class="zoom-control">
            <span>Zoom</span>
            <select value={zoom()} onChange={(event) => {
              const z = Number(event.currentTarget.value);
              setZoom(z);
              getCurrentWindow().setSize(new LogicalSize(
                Math.round(BASE_W * z / 100),
                Math.round(BASE_H * z / 100),
              ));
            }}>
              <For each={zoomOptions}>{(option) => <option value={option}>{option}%</option>}</For>
            </select>
          </label>
          <div class="topbar-meta">
            <span>Dolby 7.1.4 draft</span>
            <strong>{selectedRangeLabel()}</strong>
          </div>
        </div>
      </header>

      <section class="workspace" style={{ 'grid-template-columns': workspaceGrid() }}>
        <section class="speaker-stage" aria-label="Speaker room and timeline">
          <div class="room-wrap">
            <section class="analysis-panel" aria-label="Metering and loudness">
              <div class="analysis-heading">
                <div>
                  <span>Metering</span>
                  <strong>Loudness</strong>
                </div>
                <button
                  type="button"
                  classList={{ 'is-enabled': lufsEnabled() }}
                  onClick={() => setLufsEnabled((enabled) => !enabled)}
                >
                  LUFS
                </button>
              </div>
              <div class="loudness-readout" classList={{ 'is-disabled': !lufsEnabled() }}>
                <div class="loudness-readout-head">
                  <span>Integrated</span>
                  <span
                    class="status-pill"
                    classList={{ 'is-pass': lufsStatus() === 'pass', 'is-warn': lufsStatus() === 'warn', 'is-fail': lufsStatus() === 'fail' }}
                  >
                    {statusLabel[lufsStatus()]}
                  </span>
                </div>
                <strong>{lufsEnabled() ? `${currentIntegratedLufs} LUFS` : '--'}</strong>
              </div>
              <div class="loudness-stats" classList={{ 'is-disabled': !lufsEnabled() }}>
                <div>
                  <span>Range</span>
                  <strong>{lufsEnabled() ? '7.6 LU' : '--'}</strong>
                </div>
                <div>
                  <span>Short</span>
                  <strong>{lufsEnabled() ? '-12.8' : '--'}</strong>
                </div>
                <div classList={{ 'is-warn': lufsEnabled() && truePeakStatus() === 'warn', 'is-fail': lufsEnabled() && truePeakStatus() === 'fail' }}>
                  <span>True Peak</span>
                  <strong>{lufsEnabled() ? `${currentTruePeak}` : '--'}</strong>
                </div>
              </div>
              <div class="loudness-bar-card" classList={{ 'is-disabled': !lufsEnabled() }}>
                <div class="loudness-bar-head">
                  <span>LUFS Bar</span>
                  <select
                    class="target-select"
                    value={targetPlatformId()}
                    onChange={(event) => setTargetPlatformId(event.currentTarget.value)}
                  >
                    <For each={targetPlatforms}>{(platform) => <option value={platform.id}>{platform.label}</option>}</For>
                  </select>
                </div>
                <div class="target-spec-row">
                  <div class="target-spec-note">
                    Max True Peak {targetPlatform().truePeak} dBTP{targetPlatform().note ? ` · ${targetPlatform().note}` : ''}
                  </div>
                  <button type="button" class="export-link" onClick={exportComplianceReport}>Export Report</button>
                </div>
                <div class="loudness-scale">
                  <div class="loudness-track" />
                  <div
                    class="loudness-current"
                    classList={{ 'is-warn': lufsStatus() === 'warn', 'is-fail': lufsStatus() === 'fail' }}
                    style={{ left: lufsEnabled() ? loudnessPosition(currentIntegratedLufs) : '0%' }}
                  />
                  <div class="loudness-target" style={{ left: loudnessPosition(targetPlatform().target) }} />
                  <For each={loudnessTicks}>
                    {(tick) => (
                      <span class="loudness-tick" classList={{ 'is-target': tick !== '-inf' && Number(tick) === targetPlatform().target }} style={{ left: tick === '-inf' ? '0%' : loudnessPosition(Number(tick)) }}>
                        {tick}
                      </span>
                    )}
                  </For>
                </div>
                <div class="loudness-max-stats">
                  <div>
                    <span>Short Term Max</span>
                    <strong>{lufsEnabled() ? '-10.9' : '--'}</strong>
                  </div>
                  <div>
                    <span>Momentary Max</span>
                    <strong>{lufsEnabled() ? '-9.8' : '--'}</strong>
                  </div>
                </div>
              </div>
              <div class="meter-list" classList={{ 'is-disabled': !ppmEnabled() }}>
                <div class="meter-head">
                  <div>
                    <span>PPM</span>
                    <strong>dB Scale</strong>
                  </div>
                  <button
                    type="button"
                    classList={{ 'is-enabled': ppmEnabled() }}
                    onClick={() => setPpmEnabled((enabled) => !enabled)}
                  >
                    PPM
                  </button>
                </div>
                <div class="ppm-grid">
                  <div class="ppm-scale-row">
                    <span class="ppm-scale-spacer" />
                    <div class="ppm-scale-ticks">
                      <For each={ppmTicks}>{(tick) => <span>{tick}</span>}</For>
                    </div>
                  </div>
                  <div class="ppm-meters">
                    <For each={meterRows}>
                      {(meter) => (
                        <div class="ppm-channel">
                          <span>{meter.label}</span>
                          <div class="ppm-slot">
                            <i style={{ width: ppmEnabled() ? `${meter.value}%` : '0%' }} />
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </div>
            </section>

            <section class="speaker-view" aria-label="Top-down speaker view">
              <div class="speaker-control-bar">
                <div class="control-row-top">
                  <div class="speaker-room-title">
                    <span>Speaker Room</span>
                    <strong>Top Monitoring View</strong>
                  </div>
                  <div class="mode-toggle">
                    <button
                      type="button"
                      classList={{ 'is-mode-active': speakerMode() === 'solo' }}
                      onClick={() => setSpeakerMode('solo')}
                    >Solo</button>
                    <button
                      type="button"
                      classList={{ 'is-mode-mute': speakerMode() === 'mute' }}
                      onClick={() => setSpeakerMode('mute')}
                    >Mute</button>
                  </div>
                </div>
                <div class="group-pills">
                  <For each={[
                    { id: 'front' as const, label: 'Front' },
                    { id: 'side' as const, label: 'Side' },
                    { id: 'rear' as const, label: 'Rear' },
                    { id: 'top' as const, label: 'Top' },
                    { id: 'lfe' as const, label: 'LFE' },
                  ]}>
                    {(group) => (
                      <button
                        type="button"
                        classList={{
                          'is-solo': soloGroups().has(group.id) && speakerMode() === 'solo',
                          'is-mute': soloGroups().has(group.id) && speakerMode() === 'mute',
                        }}
                        onClick={(e) => toggleGroup(group.id, e.shiftKey)}
                      >
                        {group.label}
                      </button>
                    )}
                  </For>
                  <button type="button" class="clear-pill" onClick={() => { setLockedRange({ start: 0, end: 0 }); setSelectedNoteId(null); setSoloGroups(new Set<Speaker['group']>()); setActiveSpeakers(new Set<string>()); }}>
                    Clear
                  </button>
                </div>
              </div>
              <div class="speaker-view-title">
                <span>Speaker View</span>
                <strong classList={{ 'is-mute-label': (soloGroups().size > 0 || activeSpeakers().size > 0) && speakerMode() === 'mute' }}>{selectionLabel()}</strong>
              </div>
              <div class="room-plane" ref={roomPlaneEl}>
                <div class="screen-line">SCREEN</div>
                <div class="speaker-grid" style={{ transform: `scaleX(${gridScale()})`, 'transform-origin': 'center top' }}>
                  <div class="listener-dot">
                    <span />
                  </div>
                  <For each={speakers}>
                    {(speaker) => {
                      const isActive = () => activeSpeakers().has(speaker.label) || soloGroups().has(speaker.group);
                      return (
                        <button
                          type="button"
                          class="speaker-button"
                          classList={{
                            'is-front': speaker.group === 'front',
                            'is-side': speaker.group === 'side',
                            'is-rear': speaker.group === 'rear',
                            'is-height': speaker.group === 'top',
                            'is-lfe': speaker.group === 'lfe',
                            'is-active': isActive() && speakerMode() === 'solo',
                            'is-muted': isActive() && speakerMode() === 'mute',
                          }}
                          style={{ 'grid-area': speaker.area }}
                          onClick={(e) => toggleSpeaker(speaker.label, e.shiftKey)}
                          aria-pressed={isActive()}
                        >
                          {speaker.label}
                        </button>
                      );
                    }}
                  </For>
                </div>
              </div>
            </section>
          </div>

          <div class="timeline-card">
            <div class="timeline-head">
              <div>
                <span>Locked Range</span>
                <strong>{selectedRangeLabel()}</strong>
              </div>
              <div class="timeline-hotkeys">
                <span><kbd>Space</kbd> Play/Pause</span>
                <span><kbd>←/→</kbd> Scrub</span>
                <span><kbd>N</kbd> Note at playhead</span>
                <span><kbd>Enter</kbd> Range note</span>
                <span>Drag = select range</span>
              </div>
            </div>
            <div
              ref={timelineEl}
              class="timeline-track"
              onPointerDown={onTimelineDown}
              onPointerMove={onTimelineMove}
              onPointerUp={onTimelineUp}
              onPointerCancel={onTimelineUp}
            >
              <For each={filteredSortedNotes()}>
                {(note) => (
                  <div
                    class="note-range"
                    classList={{
                      'is-point': note.kind === 'point',
                      'is-selected': selectedNoteId() === note.id,
                      'is-critical': note.severity === 'critical',
                    }}
                    style={{
                      left: `${(note.rangeStart / durationSeconds) * 100}%`,
                      width: note.kind === 'point' ? undefined : `${Math.max(0.7, ((note.rangeEnd - note.rangeStart) / durationSeconds) * 100)}%`,
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectNote(note);
                    }}
                    title={note.body || 'Empty note'}
                  >
                    <button
                      type="button"
                      class="note-range-delete"
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteNote(note.id);
                      }}
                      aria-label="Delete note"
                    >
                      ×
                    </button>
                  </div>
                )}
              </For>
              <div
                class="locked-range"
                style={{
                  left: `${(displayRange().start / durationSeconds) * 100}%`,
                  width: `${Math.max(0.35, ((displayRange().end - displayRange().start) / durationSeconds) * 100)}%`,
                }}
              />
              <div class="playhead" style={{ left: `${(playheadTime() / durationSeconds) * 100}%` }} />
            </div>
            <div class="timeline-ticks">
              <For each={[0, 43, 86, 129, 172, 214]}>
                {(tick) => <span>{formatTime(tick)}</span>}
              </For>
            </div>
          </div>
        </section>

        <button
          type="button"
          class="panel-resizer"
          classList={{ 'is-disabled': true }}
          onPointerDown={(event) => event.preventDefault()}
          aria-label="Notes panel divider"
        />

        <aside class="notes-panel" classList={{ 'is-collapsed': notesCollapsed() }}>
          <button
            type="button"
            class="collapse-button"
            onClick={() => setNotesCollapsed((collapsed) => !collapsed)}
            aria-label={notesCollapsed() ? 'Expand notes panel' : 'Collapse notes panel'}
          >
            {notesCollapsed() ? '<' : '>'}
          </button>

          {!notesCollapsed() && (
            <div class="notes-content">
              <div class="notes-heading">
                <div>
                  <span>Notes Panel</span>
                  <strong>Time Range Notes</strong>
                </div>
                <div class="notes-heading-meta">
                  <small>{filteredSortedNotes().length} / {notes().length} notes</small>
                  <button type="button" class="export-link" onClick={exportNotesCsv}>Export CSV</button>
                </div>
              </div>

              <div class="general-note-card">
                <span>General Note</span>
                <textarea
                  value={generalNote()}
                  onInput={(event) => setGeneralNote(event.currentTarget.value)}
                  placeholder="Overall mix impressions, loudness concerns, delivery reminders..."
                />
              </div>

              <div class="locked-card">
                <span>Current locked timecode</span>
                <strong>{selectedRangeLabel()}</strong>
              </div>

              <button
                type="button"
                class="primary-action"
                disabled={displayRange().end <= displayRange().start || selectedNoteId() !== null}
                onClick={addRangeNoteDraft}
              >
                Add Range Note
              </button>
              <p class="note-hint">Press <kbd>N</kbd> anytime to drop a note at the playhead.</p>

              <div class="note-filter-bar">
                <input
                  type="text"
                  class="note-search-input"
                  value={noteSearch()}
                  onInput={(event) => setNoteSearch(event.currentTarget.value)}
                  placeholder="Search notes..."
                />
                <select
                  value={statusFilter()}
                  onChange={(event) => setStatusFilter(event.currentTarget.value as 'all' | 'open' | 'checking' | 'done')}
                >
                  <option value="all">All Status</option>
                  <option value="open">Open</option>
                  <option value="checking">Checking</option>
                  <option value="done">Done</option>
                </select>
                <select
                  value={severityFilter()}
                  onChange={(event) => setSeverityFilter(event.currentTarget.value as 'all' | 'critical' | 'minor')}
                >
                  <option value="all">All Severity</option>
                  <option value="critical">Critical</option>
                  <option value="minor">Minor</option>
                </select>
              </div>

              <div class="note-list">
                <For each={filteredSortedNotes()}>
                  {(note) => (
                    <article
                      class="note-item"
                      classList={{
                        'is-point': note.kind === 'point',
                        'is-selected': selectedNoteId() === note.id,
                        'is-critical': note.severity === 'critical',
                      }}
                      data-note-id={note.id}
                    >
                      <div>
                        <strong onClick={() => selectNote(note)}>
                          {note.kind === 'point' ? formatTime(note.rangeStart) : `${formatTime(note.rangeStart)} - ${formatTime(note.rangeEnd)}`}
                        </strong>
                        <div class="note-item-actions">
                          <button
                            type="button"
                            class="severity-pill"
                            classList={{ 'is-critical': note.severity === 'critical' }}
                            onClick={() => toggleSeverity(note.id)}
                          >
                            {note.severity === 'critical' ? 'Critical' : 'Minor'}
                          </button>
                          <button
                            type="button"
                            class="status-pill-toggle"
                            classList={{ 'is-checking': note.status === 'checking', 'is-done': note.status === 'done' }}
                            onClick={() => cycleStatus(note.id)}
                            aria-label="Cycle note status"
                          >
                            {note.status}
                          </button>
                          <button
                            type="button"
                            class="note-delete"
                            onClick={() => deleteNote(note.id)}
                            aria-label="Delete note"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      {editingNoteId() === note.id ? (
                        <textarea
                          class="note-item-editor"
                          ref={(el) => {
                            el.value = note.body;
                            el.focus();
                          }}
                          onBlur={(event) => {
                            updateNoteBody(note.id, event.currentTarget.value);
                            setEditingNoteId(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                              event.preventDefault();
                              updateNoteBody(note.id, event.currentTarget.value);
                              setEditingNoteId(null);
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              setEditingNoteId(null);
                            }
                          }}
                          placeholder="Type your note..."
                        />
                      ) : (
                        <p onClick={() => setEditingNoteId(note.id)}>{note.body || 'Click to add note text…'}</p>
                      )}
                    </article>
                  )}
                </For>
              </div>
            </div>
          )}
        </aside>
      </section>
      </div>
    </main>
  );
}

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element #root was not found.');
}

render(() => <App />, root);
