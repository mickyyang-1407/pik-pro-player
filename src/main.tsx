import { ErrorBoundary, For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
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

const MOCK_DURATION_SECONDS = 214;
const PLAYHEAD_NUDGE_SECONDS = 1;
const PLAYHEAD_SCRUB_SECONDS = 5;
const zoomOptions = [75, 100, 125, 150];

type TargetStatus = 'pass' | 'warn' | 'fail';

const statusLabel: Record<TargetStatus, string> = { pass: 'Pass', warn: 'Warn', fail: 'Fail' };

type MixVersion = {
  id: 'a' | 'b';
  label: string;
  title: string;
  note: string;
  integratedLufs: number;
  truePeak: number;
  openIssues: number;
  updatedAt: string;
};

type ReferenceTrack = {
  name: string;
  source: 'mock' | 'file';
  integratedLufs: number;
  truePeak: number;
};

type LoudnessPoint = {
  time: number;
  value: number;
};

type SpectrumBand = {
  label: string;
  value: number;
};

type PositionPayload = {
  position: number;
  duration: number;
};

type TauriFile = File & {
  path?: string;
};

const isTauriRuntime = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

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

// Backend buffer/meter channel order (matches atmos_wrapper.m labels12) — differs from `speakers` display order
const channelOrder = ['L', 'R', 'C', 'LFE', 'Ls', 'Rs', 'Lrs', 'Rrs', 'Ltf', 'Rtf', 'Ltr', 'Rtr'];

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

// dB values behind ppmTicks; ticks render evenly spaced, so dB→% is piecewise-linear between them
const ppmTickDb = [-60, -54, -45, -36, -27, -24, -18, -9, -6, -1];

const ppmPercentFromDb = (db: number) => {
  const last = ppmTickDb.length - 1;
  if (db <= ppmTickDb[0]) return 0;
  if (db >= ppmTickDb[last]) return 100;
  for (let i = 0; i < last; i++) {
    if (db <= ppmTickDb[i + 1]) {
      const t = (db - ppmTickDb[i]) / (ppmTickDb[i + 1] - ppmTickDb[i]);
      return ((i + t) / last) * 100;
    }
  }
  return 100;
};

const linearToDb = (value: number) => (value > 0 ? 20 * Math.log10(value) : -Infinity);
const roundTo = (value: number, digits: number) => {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

type MeterChannel = { label: string; rms: number; peak: number };

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

const mixVersions: MixVersion[] = [
  {
    id: 'a',
    label: 'A',
    title: 'Current Mix',
    note: 'Wider chorus image, vocal edge still checking.',
    integratedLufs: -14.2,
    truePeak: -1.1,
    openIssues: 2,
    updatedAt: 'Today 18:10',
  },
  {
    id: 'b',
    label: 'B',
    title: 'Revision 02',
    note: 'Tighter low-mid and safer true peak headroom.',
    integratedLufs: -15.4,
    truePeak: -1.8,
    openIssues: 1,
    updatedAt: 'Today 19:35',
  },
];

const defaultReferenceTrack: ReferenceTrack = {
  name: 'Reference Track',
  source: 'mock',
  integratedLufs: -15.8,
  truePeak: -1.4,
};

const currentLoudnessCurve: LoudnessPoint[] = [
  { time: 0, value: -22 },
  { time: 24, value: -18 },
  { time: 52, value: -16.8 },
  { time: 86, value: -14.4 },
  { time: 121, value: -13.2 },
  { time: 153, value: -15.1 },
  { time: 181, value: -12.6 },
  { time: 214, value: -16.4 },
];

const referenceLoudnessCurve: LoudnessPoint[] = [
  { time: 0, value: -23 },
  { time: 24, value: -19.2 },
  { time: 52, value: -17.4 },
  { time: 86, value: -15.9 },
  { time: 121, value: -14.6 },
  { time: 153, value: -15.7 },
  { time: 181, value: -14.1 },
  { time: 214, value: -16.9 },
];

const spectrumBands: SpectrumBand[] = [
  { label: '40', value: 42 },
  { label: '80', value: 58 },
  { label: '160', value: 72 },
  { label: '315', value: 64 },
  { label: '630', value: 48 },
  { label: '1.2k', value: 54 },
  { label: '2.5k', value: 61 },
  { label: '5k', value: 46 },
  { label: '10k', value: 38 },
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
  const clamped = Math.max(0, seconds);
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

function fileTitleFromPath(path: string) {
  return path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || 'Loaded Audio';
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

function loudnessPolyline(points: LoudnessPoint[], valueOffset = 0) {
  return points
    .map((point) => {
      const x = (point.time / MOCK_DURATION_SECONDS) * 220;
      const y = ((Math.max(-30, Math.min(-10, point.value + valueOffset)) + 30) / 20) * 58;
      return `${x.toFixed(1)},${(64 - y).toFixed(1)}`;
    })
    .join(' ');
}

function App() {
  const [notesWidth, setNotesWidth] = createSignal(30);
  const [notesCollapsed, setNotesCollapsed] = createSignal(false);
  const [showAnalytics, setShowAnalytics] = createSignal(false);
  const [lockedRange, setLockedRange] = createSignal({ start: 95, end: 153 });
  const [notes, setNotes] = createSignal(seedNotes);
  const sortedNotes = createMemo(() => [...notes()].sort((a, b) => {
    if (a.rangeStart === b.rangeStart) {
      return (b.rangeEnd - b.rangeStart) - (a.rangeEnd - a.rangeStart);
    }
    return a.rangeStart - b.rangeStart;
  }));
  const [generalNote, setGeneralNote] = createSignal('');
  const [editingNoteId, setEditingNoteId] = createSignal<number | null>(null);
  const [selectedNoteId, setSelectedNoteId] = createSignal<number | null>(null);
  const [noteSearch, setNoteSearch] = createSignal('');
  const [statusFilter, setStatusFilter] = createSignal<'all' | 'open' | 'checking' | 'done'>('all');
  const [severityFilter, setSeverityFilter] = createSignal<'all' | 'critical' | 'minor'>('all');
  const [linkTimelineEdit, setLinkTimelineEdit] = createSignal(false);
  const [lastPointNoteId, setLastPointNoteId] = createSignal<number | null>(null);
  const [activeVersionId, setActiveVersionId] = createSignal<MixVersion['id']>('a');
  const [referenceTrack, setReferenceTrack] = createSignal<ReferenceTrack>(defaultReferenceTrack);
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
  const [trackTitle, setTrackTitle] = createSignal('No File Loaded');
  const [trackDuration, setTrackDuration] = createSignal(MOCK_DURATION_SECONDS);
  const [hasLoadedAudio, setHasLoadedAudio] = createSignal(false);
  const [loadStatus, setLoadStatus] = createSignal('Mock clock ready');
  const [loadedFilePath, setLoadedFilePath] = createSignal<string | null>(null);
  const playbackDuration = createMemo(() => Math.max(0.1, trackDuration()));
  const activeVersion = createMemo(() => mixVersions.find((version) => version.id === activeVersionId()) ?? mixVersions[0]);
  const compareVersion = createMemo(() => mixVersions.find((version) => version.id !== activeVersionId()) ?? mixVersions[1]);

  // ── E4: Real LUFS / True Peak via ebur128 backend ─────────────────────────
  type LufsSnapshotDto = {
    available: boolean;
    sample_rate: number;
    channels: number;
    integrated: number | null;
    short_term: number | null;
    momentary: number | null;
    loudness_range: number | null;
    short_term_max: number | null;
    momentary_max: number | null;
    true_peak_db: number | null;
    true_peak_per_channel: number[];
    sample_peak_db: number | null;
  };

  const [liveLufs, setLiveLufs] = createSignal<LufsSnapshotDto | null>(null);
  const selectedIntegratedLufs = createMemo(() => {
    const live = liveLufs();
    if (live && live.integrated !== null) return roundTo(live.integrated, 1);
    return activeVersion().integratedLufs;
  });
  const selectedTruePeak = createMemo(() => {
    const live = liveLufs();
    if (live && live.true_peak_db !== null) return roundTo(live.true_peak_db, 1);
    return activeVersion().truePeak;
  });
  const selectedShortTerm = createMemo(() => {
    const live = liveLufs();
    if (live && live.short_term !== null) return roundTo(live.short_term, 1);
    return null;
  });
  const selectedLoudnessRange = createMemo(() => {
    const live = liveLufs();
    if (live && live.loudness_range !== null) return roundTo(live.loudness_range, 1);
    return null;
  });
  const selectedShortTermMax = createMemo(() => {
    const live = liveLufs();
    if (live && live.short_term_max !== null) return roundTo(live.short_term_max, 1);
    return null;
  });
  const selectedMomentaryMax = createMemo(() => {
    const live = liveLufs();
    if (live && live.momentary_max !== null) return roundTo(live.momentary_max, 1);
    return null;
  });
  const currentCurveOffset = createMemo(() => selectedIntegratedLufs() - mixVersions[0].integratedLufs);
  const currentCurvePoints = createMemo(() => loudnessPolyline(currentLoudnessCurve, currentCurveOffset()));
  const referenceCurvePoints = createMemo(() => loudnessPolyline(referenceLoudnessCurve));
  const correlationValue = createMemo(() => (activeVersionId() === 'b' ? 0.91 : 0.78));
  const phaseOffset = createMemo(() => (activeVersionId() === 'b' ? -4 : -12));
  const versionDelta = createMemo(() => ({
    lufs: activeVersion().integratedLufs - compareVersion().integratedLufs,
    truePeak: activeVersion().truePeak - compareVersion().truePeak,
    issues: activeVersion().openIssues - compareVersion().openIssues,
  }));
  const [isPlaying, setIsPlaying] = createSignal(false);
  const [playheadTime, setPlayheadTime] = createSignal(0);
  const [loopEnabled, setLoopEnabled] = createSignal(false);
  const [activeSpeakers, setActiveSpeakers] = createSignal<Set<string>>(new Set());
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
  const channelMuteMask = createMemo(() => {
    const selected = new Set<string>();
    for (const speaker of speakers) {
      if (activeSpeakers().has(speaker.label) || soloGroups().has(speaker.group)) selected.add(speaker.label);
    }
    if (selected.size === 0) return 0;
    let mask = 0;
    channelOrder.forEach((label, index) => {
      const shouldMute = speakerMode() === 'solo' ? !selected.has(label) : selected.has(label);
      if (shouldMute) mask |= 1 << index;
    });
    return mask;
  });

  createEffect(() => {
    const mask = channelMuteMask();
    if (!isTauriRuntime() || !hasLoadedAudio()) return;
    void invoke('player_set_channel_mutes', { mask }).catch(() => {});
  });

  const [liveMeter, setLiveMeter] = createSignal<MeterChannel[] | null>(null);

  // Poll real vDSP meter data while a file is loaded; mock rows remain until the first real frame arrives
  createEffect(() => {
    if (!isTauriRuntime() || !hasLoadedAudio() || !ppmEnabled()) return;
    const timer = setInterval(async () => {
      try {
        const json = await invoke<string | null>('player_meter_json');
        if (!json) return;
        const parsed = JSON.parse(json) as { available?: boolean; channels?: MeterChannel[] };
        if (parsed.available && Array.isArray(parsed.channels)) setLiveMeter(parsed.channels);
      } catch {
        // player may be mid-reload; skip this frame
      }
    }, 100);
    onCleanup(() => clearInterval(timer));
  });

  const displayMeterRows = createMemo(() => {
    const live = liveMeter();
    if (!live) return meterRows;
    const byLabel = new Map(live.map((channel) => [channel.label, channel]));
    return channelOrder.map((label) => {
      const channel = byLabel.get(label);
      return { label, value: channel ? ppmPercentFromDb(linearToDb(channel.peak)) : 0 };
    });
  });

  // ── E4: Real LUFS / True Peak via ebur128 backend ─────────────────────────
  // Types and signal moved up

  createEffect(() => {
    if (!isTauriRuntime() || !hasLoadedAudio()) return;
    const timer = setInterval(async () => {
      try {
        const snap = await invoke<LufsSnapshotDto>('player_lufs_snapshot');
        if (snap && snap.available) setLiveLufs(snap);
      } catch {
        // player may be mid-reload; skip this frame
      }
    }, 250);
    onCleanup(() => clearInterval(timer));
  });

  // Reset the analyser on every new load — mock defaults are shown until first real values arrive.
  createEffect(() => {
    if (!isTauriRuntime()) return;
    const loaded = hasLoadedAudio();
    if (!loaded) {
      setLiveLufs(null);
      return;
    }
    setLiveLufs(null);
    void invoke('player_reset_lufs').catch(() => {});
  });

  const [lufsEnabled, setLufsEnabled] = createSignal(true);
  const [targetPlatformId, setTargetPlatformId] = createSignal(targetPlatforms[0].id);
  const targetPlatform = createMemo(() => targetPlatforms.find((p) => p.id === targetPlatformId()) ?? targetPlatforms[0]);
  const lufsStatus = createMemo<TargetStatus>(() => {
    const tolerance = targetPlatform().tolerance ?? 1;
    const diff = Math.abs(selectedIntegratedLufs() - targetPlatform().target);
    if (diff <= tolerance) return 'pass';
    if (diff <= tolerance + 2) return 'warn';
    return 'fail';
  });
  const truePeakStatus = createMemo<TargetStatus>(() => {
    const headroom = targetPlatform().truePeak - selectedTruePeak();
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
  let audioInputEl: HTMLInputElement | undefined;
  let referenceInputEl: HTMLInputElement | undefined;
  const [gridScale, setGridScale] = createSignal(1);
  const BASE_ROOM_W = 560;

  const panelWidth = createMemo(() => (notesCollapsed() ? '52px' : `${notesWidth()}%`));
  const workspaceGrid = createMemo(() => `minmax(0, 1fr) 2px ${panelWidth()}`);

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
  const timelineTicks = createMemo(() => {
    const duration = playbackDuration();
    return [0, 0.2, 0.4, 0.6, 0.8, 1].map((ratio) => Math.round(duration * ratio));
  });

  let playTimer: ReturnType<typeof setInterval> | undefined;
  createEffect(() => {
    if (isPlaying() && !hasLoadedAudio()) {
      if (playTimer) return;
      playTimer = setInterval(() => {
        setPlayheadTime((t) => {
          const next = t + 0.1;
          const range = lockedRange();
          if (loopEnabled() && range.end > range.start) {
            return next >= range.end ? range.start : next;
          }
          if (next >= playbackDuration()) {
            setIsPlaying(false);
            return playbackDuration();
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

  const seekTo = async (position: number) => {
    const next = Math.max(0, Math.min(playbackDuration(), position));
    setPlayheadTime(next);
    if (hasLoadedAudio()) {
      try {
        await invoke('player_seek', { position: next });
      } catch (error) {
        setLoadStatus(`Seek failed: ${String(error)}`);
      }
    }
  };

  const togglePlay = async () => {
    if (!hasLoadedAudio()) {
      setIsPlaying((playing) => !playing);
      return;
    }
    try {
      if (isPlaying()) {
        await invoke('player_pause');
        setIsPlaying(false);
      } else {
        if (playheadTime() >= playbackDuration() - 0.1) {
          await invoke('player_seek', { position: 0 });
          setPlayheadTime(0);
        }
        await invoke('player_play');
        setIsPlaying(true);
      }
    } catch (error) {
      setLoadStatus(`Playback failed: ${String(error)}`);
    }
  };

  const stopPlayback = async () => {
    setIsPlaying(false);
    if (hasLoadedAudio()) {
      try {
        await invoke('player_pause');
        await invoke('player_seek', { position: 0 });
      } catch (error) {
        setLoadStatus(`Stop failed: ${String(error)}`);
      }
    }
    setPlayheadTime(0);
  };
  const toggleLoop = () => setLoopEnabled((enabled) => !enabled);
  const nudgePlayhead = (deltaSeconds: number) => {
    void seekTo(playheadTime() + deltaSeconds);
  };

  const loadAudioPath = async (path: string) => {
    setLoadStatus('Loading audio...');
    try {
      const position = await invoke<PositionPayload>('player_load', { path });
      setHasLoadedAudio(true);
      setLoadedFilePath(path);
      setTrackTitle(fileTitleFromPath(path));
      setTrackDuration(position.duration > 0 ? position.duration : MOCK_DURATION_SECONDS);
      setPlayheadTime(position.position);
      setIsPlaying(false);
      setLoadStatus('Loaded through AVFoundation');
      void invoke('player_set_channel_mutes', { mask: channelMuteMask() }).catch(() => {});
      void loadNotesForFile(path);
      void loadWaveformForFile(path);
    } catch (error) {
      setHasLoadedAudio(false);
      setLoadedFilePath(null);
      setLoadStatus(`Load failed: ${String(error)}`);
    }
  };

  const onLoadAudioClick = async () => {
    if (!isTauriRuntime()) {
      audioInputEl?.click();
      return;
    }
    const path = await open({
      multiple: false,
      filters: [{ name: 'Audio', extensions: ['wav', 'aif', 'aiff', 'mp3', 'm4a', 'mp4'] }]
    });
    if (path && typeof path === 'string') {
      void loadAudioPath(path);
    }
  };

  const onAudioFileChange = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] as TauriFile | undefined;
    if (!file) return;
    if (!file.path) {
      setTrackTitle(file.name.replace(/\.[^.]+$/, '') || file.name);
      setLoadStatus('Chrome preview can read the name only. Open this in the Tauri app for full path playback.');
      input.value = '';
      return;
    }
    void loadAudioPath(file.path);
    input.value = '';
  };

  // ── Undo/Redo for notes + general note (coarse-grained snapshots, max 10) ──
  type NotesSnapshot = { notes: Note[]; generalNote: string };
  const [undoStack, setUndoStack] = createSignal<NotesSnapshot[]>([]);
  const [redoStack, setRedoStack] = createSignal<NotesSnapshot[]>([]);
  const UNDO_LIMIT = 10;

  const cloneSnapshot = (): NotesSnapshot => ({
    notes: notes().map((n) => ({ ...n })),
    generalNote: generalNote(),
  });  let suppressHistory = false;
  const pushHistory = () => {
    if (suppressHistory) return;
    const snap = cloneSnapshot();
    setUndoStack((s) => {
      const next = [...s, snap];
      if (next.length > UNDO_LIMIT) next.shift();
      return next;
    });
    setRedoStack([]);
  };

  // Debounce so a burst of keystrokes only produces one history entry.
  let historyDebounce: ReturnType<typeof setTimeout> | null = null;
  const pushHistoryDebounced = () => {
    if (historyDebounce) clearTimeout(historyDebounce);
    historyDebounce = setTimeout(() => {
      historyDebounce = null;
      pushHistory();
    }, 500);
  };

  // Apply a snapshot to the current signals AND re-persist to DB (delete removed rows, upsert kept ones).
  const applySnapshot = async (target: NotesSnapshot) => {
    const path = loadedFilePath();
    const before = cloneSnapshot();
    suppressHistory = true;
    try {
      setNotes(target.notes.map((n) => ({ ...n })));
      setGeneralNote(target.generalNote);

      if (!path || !isTauriRuntime()) return;

      // Sync DB: delete rows removed from target, upsert rows in target.
      const beforeIds = new Set(before.notes.map((n) => n.id));
      const targetIds = new Set(target.notes.map((n) => n.id));
      for (const id of beforeIds) {
        if (!targetIds.has(id) && persistedNoteIds.has(id)) {
          persistedNoteIds.delete(id);
          await invoke('notes_delete', { id }).catch(() => {});
        }
      }
      for (const n of target.notes) {
        if (persistedNoteIds.has(n.id)) {
          await invoke('notes_update', { id: n.id, note: noteToInput(n) }).catch(() => {});
        } else {
          const created = await invoke<NoteRecordDto>('notes_add', { path, note: noteToInput(n) }).catch(() => null);
          if (created) {
            const dbNote = dtoToNote(created);
            setNotes((current) => current.map((x) => (x.id === n.id ? dbNote : x)));
            persistedNoteIds.add(dbNote.id);
          }
        }
      }
      await invoke('notes_set_general', { path, general: target.generalNote }).catch(() => {});
    } finally {
      suppressHistory = false;
    }
  };

  const undo = () => {
    const stack = undoStack();
    if (stack.length === 0) return;
    const prev = stack[stack.length - 1];
    setUndoStack(stack.slice(0, -1));
    setRedoStack((r) => [...r, cloneSnapshot()]);
    void applySnapshot(prev);
  };

  const redo = () => {
    const stack = redoStack();
    if (stack.length === 0) return;
    const next = stack[stack.length - 1];
    setRedoStack(stack.slice(0, -1));
    setUndoStack((u) => {
      const nu = [...u, cloneSnapshot()];
      if (nu.length > UNDO_LIMIT) nu.shift();
      return nu;
    });
    void applySnapshot(next);
  };

  const startEditingNote = (note: Note) => {
    pushHistory();
    setNotes((current) => [note, ...current]);
    setEditingNoteId(note.id);
    setSelectedNoteId(note.id);
  };


  // ── E5: SQLite notes persistence ──────────────────────────────────────────
  type NoteRecordDto = {
    id: number;
    filePath: string;
    rangeStart: number;
    rangeEnd: number;
    body: string;
    status: 'open' | 'checking' | 'done';
    kind: 'point' | 'range';
    severity: 'critical' | 'minor';
    createdAt: string;
    updatedAt: string;
  };
  type FileNotesPayloadDto = {
    generalNote: string;
    notes: NoteRecordDto[];
  };

  const dtoToNote = (r: NoteRecordDto): Note => ({
    id: r.id,
    rangeStart: r.rangeStart,
    rangeEnd: r.rangeEnd,
    body: r.body,
    status: r.status,
    kind: r.kind,
    severity: r.severity,
  });

  const noteToInput = (note: Note) => ({
    rangeStart: note.rangeStart,
    rangeEnd: note.rangeEnd,
    body: note.body,
    status: note.status,
    kind: note.kind,
    severity: note.severity,
  });

  // Map front-end temp ids -> DB row ids (both stored in `Note.id` after resolution).
  // A note that's been persisted has id > 0 and matches the DB row id.
  // Draft/unsaved notes keep the local counter id from nextNoteId().
  const persistedNoteIds = new Set<number>();

  const loadNotesForFile = async (path: string) => {
    if (!isTauriRuntime()) return;
    try {
      const payload = await invoke<FileNotesPayloadDto>('notes_get_for_file', { path });
      const loaded = payload.notes.map(dtoToNote);
      persistedNoteIds.clear();
      loaded.forEach((n) => persistedNoteIds.add(n.id));
      setNotes(loaded);
      setGeneralNote(payload.generalNote ?? '');
      setEditingNoteId(null);
      setSelectedNoteId(null);
      void invoke('notes_touch_file', { path }).catch(() => {});
    } catch {
      // fresh DB or transient failure — keep the current in-memory notes
    }
  };

  // ── E6: Waveform overview ─────────────────────────────────────────────────
  const [waveformPeaks, setWaveformPeaks] = createSignal<number[] | null>(null);
  const WAVEFORM_BINS = 800; // ~1 bin per 3-4 px on a 1200-1500 px timeline

  const loadWaveformForFile = async (path: string) => {
    if (!isTauriRuntime()) return;
    setWaveformPeaks(null);
    try {
      const peaks = await invoke<number[]>('player_waveform', { path, numBins: WAVEFORM_BINS });
      if (peaks && peaks.length > 0) setWaveformPeaks(peaks);
    } catch {
      // waveform is decorative; ignore failure
    }
  };

  const waveformPath = createMemo(() => {
    const peaks = waveformPeaks();
    if (!peaks || peaks.length === 0) return '';
    // Build a symmetric peak envelope (mirrored top/bottom) around y=50 in a 100-high viewBox.
    const top: string[] = [];
    const bottom: string[] = [];
    for (let i = 0; i < peaks.length; i++) {
      const h = Math.max(0, Math.min(1, peaks[i])) * 48; // leave 2px headroom top/bottom
      top.push(`${i} ${50 - h}`);
      bottom.push(`${i} ${50 + h}`);
    }
    // Path: M topLeft L top... L bottomLast L bottom... Z
    return `M ${top[0]} L ${top.slice(1).join(' L ')} L ${bottom[bottom.length - 1]} L ${bottom.slice(0, -1).reverse().join(' L ')} Z`;
  });

  // Persist a note when the user finishes editing (body change committed or status/severity/kind toggled).
  // Draft notes have negative-space ids from nextNoteId(); on first save the local id is replaced by the DB id.
  const persistNote = async (note: Note): Promise<Note> => {
    const path = loadedFilePath();
    if (!path || !isTauriRuntime()) return note;
    try {
      if (persistedNoteIds.has(note.id)) {
        await invoke('notes_update', { id: note.id, note: noteToInput(note) });
        return note;
      }
      const created = await invoke<NoteRecordDto>('notes_add', { path, note: noteToInput(note) });
      const dbNote = dtoToNote(created);
      // Replace the transient id with the DB id in the notes signal.
      setNotes((current) => current.map((n) => (n.id === note.id ? dbNote : n)));
      setEditingNoteId((current) => (current === note.id ? dbNote.id : current));
      setSelectedNoteId((current) => (current === note.id ? dbNote.id : current));
      setLastPointNoteId((current) => (current === note.id ? dbNote.id : current));
      persistedNoteIds.add(dbNote.id);
      return dbNote;
    } catch {
      return note;
    }
  };

  const persistNoteById = (id: number) => {
    const n = notes().find((x) => x.id === id);
    if (n) void persistNote(n);
  };

  // Debounced version for high-frequency mutations (body typing).
  const bodyPersistTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const persistNoteByIdDebounced = (id: number) => {
    const existing = bodyPersistTimers.get(id);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      bodyPersistTimers.delete(id);
      persistNoteById(id);
    }, 350);
    bodyPersistTimers.set(id, t);
  };

  const persistDeleteNote = (id: number) => {
    if (!isTauriRuntime()) return;
    // Cancel any pending debounced write for this note.
    const existing = bodyPersistTimers.get(id);
    if (existing) {
      clearTimeout(existing);
      bodyPersistTimers.delete(id);
    }
    if (!persistedNoteIds.has(id)) return;
    persistedNoteIds.delete(id);
    void invoke('notes_delete', { id }).catch(() => {});
  };

  // Debounced general-note auto-save.
  let generalNoteTimer: ReturnType<typeof setTimeout> | null = null;
  createEffect(() => {
    const text = generalNote();
    const path = loadedFilePath();
    if (!path || !isTauriRuntime()) return;
    if (generalNoteTimer) clearTimeout(generalNoteTimer);
    generalNoteTimer = setTimeout(() => {
      void invoke('notes_set_general', { path, general: text }).catch(() => {});
    }, 400);
  });

  const addPointNoteAtPlayhead = () => {
    const time = playheadTime();
    const id = nextNoteId();
    setLastPointNoteId(id);
    setLockedRange({ start: time, end: time });
    setDragStart(time);
    startEditingNote({ id, rangeStart: time, rangeEnd: time, body: '', status: 'open', kind: 'point', severity: 'minor' });
  };

  const addRangeNoteDraft = () => {
    const range = displayRange();
    if (range.end <= range.start) return;
    startEditingNote({ id: nextNoteId(), rangeStart: range.start, rangeEnd: range.end, body: '', status: 'open', kind: 'range', severity: 'minor' });
  };

  const handleAutoListKeyDown = (event: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) => {
    if (event.key === 'Enter' && event.shiftKey) {
      const target = event.currentTarget;
      const value = target.value;
      const cursor = target.selectionStart;
      
      const textBeforeCursor = value.substring(0, cursor);
      const lines = textBeforeCursor.split('\n');
      const currentLine = lines[lines.length - 1];
      
      const match = currentLine.match(/^(\s*)([0-9]+\.|[-*])\s(.*)$/);
      if (match) {
        event.preventDefault();
        const prefix = match[1];
        const marker = match[2];
        const content = match[3];
        
        let nextMarker = marker;
        if (/^[0-9]+\.$/.test(marker)) {
          const num = parseInt(marker.slice(0, -1), 10);
          nextMarker = `${num + 1}.`;
        }
        
        if (content.trim() === '') {
          const textBeforeLine = textBeforeCursor.substring(0, textBeforeCursor.length - currentLine.length);
          const newText = textBeforeLine + '\n' + value.substring(target.selectionEnd);
          target.value = newText;
          target.selectionStart = target.selectionEnd = textBeforeLine.length + 1;
          target.dispatchEvent(new Event('input', { bubbles: true }));
          return;
        }

        const insertText = `\n${prefix}${nextMarker} `;
        const newText = textBeforeCursor + insertText + value.substring(target.selectionEnd);
        target.value = newText;
        target.selectionStart = target.selectionEnd = cursor + insertText.length;
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  };

  const updateNoteBody = (id: number, body: string) => {
    pushHistoryDebounced();
    setNotes((current) => current.map((note) => (note.id === id ? { ...note, body } : note)));
    persistNoteByIdDebounced(id);
  };

  const toggleSeverity = (id: number) => {
    pushHistory();
    setNotes((current) => current.map((note) => (note.id === id ? { ...note, severity: note.severity === 'critical' ? 'minor' : 'critical' } : note)));
    persistNoteById(id);
  };

  const nextStatus: Record<Note['status'], Note['status']> = { open: 'checking', checking: 'done', done: 'open' };
  const cycleStatus = (id: number) => {
    pushHistory();
    setNotes((current) => current.map((note) => (note.id === id ? { ...note, status: nextStatus[note.status] } : note)));
    persistNoteById(id);
  };

  const deleteNote = (id: number) => {
    pushHistory();
    setNotes((current) => current.filter((note) => note.id !== id));
    setEditingNoteId((current) => (current === id ? null : current));
    setSelectedNoteId((current) => {
      if (current === id) {
        setLockedRange({ start: playheadTime(), end: playheadTime() });
        return null;
      }
      return current;
    });
    persistDeleteNote(id);
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

  // Structured JSON export — designed for downstream Google Apps Script / email delivery.
  // Contains file metadata, loudness measurements, general note, and every timeline note.
  const exportNotesJson = () => {
    const live = liveLufs();
    const platform = targetPlatform();
    const payload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      file: {
        title: trackTitle(),
        path: loadedFilePath() ?? null,
        durationSec: trackDuration(),
      },
      loudness: {
        integratedLufs: live?.integrated ?? null,
        shortTermLufs: live?.short_term ?? null,
        shortTermMax: live?.short_term_max ?? null,
        momentaryMax: live?.momentary_max ?? null,
        loudnessRange: live?.loudness_range ?? null,
        truePeakDb: live?.true_peak_db ?? null,
        truePeakPerChannel: live?.true_peak_per_channel ?? [],
        sampleRate: live?.sample_rate ?? null,
        channels: live?.channels ?? null,
      },
      target: {
        id: platform.id,
        label: platform.label,
        targetLufs: platform.target,
        tolerance: platform.tolerance ?? 1,
        maxTruePeakDb: platform.truePeak,
        status: {
          lufs: lufsStatus(),
          truePeak: truePeakStatus(),
        },
      },
      generalNote: generalNote(),
      notes: sortedNotes().map((n) => ({
        id: n.id,
        kind: n.kind,
        severity: n.severity,
        status: n.status,
        rangeStartSec: n.rangeStart,
        rangeEndSec: n.rangeEnd,
        rangeStartTimecode: formatTime(n.rangeStart),
        rangeEndTimecode: formatTime(n.rangeEnd),
        body: n.body,
      })),
    };
    downloadTextFile(
      `${safeFileName(trackTitle())}-notes.json`,
      JSON.stringify(payload, null, 2),
      'application/json;charset=utf-8',
    );
  };

  const exportComplianceReport = () => {
    const platform = targetPlatform();
    const lufsDiff = Math.abs(selectedIntegratedLufs() - platform.target);
    const peakHeadroom = platform.truePeak - selectedTruePeak();
    const lines = [
      'Pik Pro Player - Loudness Compliance Report',
      `Generated: ${new Date().toLocaleString()}`,
      `Track: ${trackTitle()}`,
      `Version: ${activeVersion().label} - ${activeVersion().title}`,
      '',
      `Target Platform: ${platform.label}${platform.note ? ` (${platform.note})` : ''}`,
      `Target Loudness: ${platform.target} LKFS (tolerance +/-${platform.tolerance ?? 1} LU)`,
      `Max True Peak: ${platform.truePeak} dBTP`,
      '',
      `Measured Integrated LUFS: ${selectedIntegratedLufs()} LUFS -> ${statusLabel[lufsStatus()].toUpperCase()} (diff ${lufsDiff.toFixed(1)} LU vs target)`,
      `Measured True Peak: ${selectedTruePeak()} dBTP -> ${statusLabel[truePeakStatus()].toUpperCase()} (headroom ${peakHeadroom.toFixed(1)} dB vs limit)`,
    ];
    downloadTextFile(`${safeFileName(trackTitle())}-loudness-report.txt`, lines.join('\n'), 'text/plain;charset=utf-8');
  };

  const onReferenceFileChange = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    setReferenceTrack({
      name: file.name,
      source: 'file',
      integratedLufs: defaultReferenceTrack.integratedLufs,
      truePeak: defaultReferenceTrack.truePeak,
    });
    input.value = '';
  };

  createEffect(() => {
    const id = selectedNoteId();
    if (id === null) return;
    document.querySelector(`[data-note-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  onMount(() => {
    const unlisteners: Array<() => void> = [];
    if (isTauriRuntime()) {
      listen<PositionPayload>('av:position', (event) => {
        const { position, duration } = event.payload;
        const nextDuration = duration > 0 ? duration : playbackDuration();
        setTrackDuration(nextDuration);
        const range = lockedRange();
        if (loopEnabled() && linkTimelineEdit() && range.end > range.start && position >= range.end) {
          void seekTo(range.start);
          return;
        }
        setPlayheadTime(Math.max(0, Math.min(nextDuration, position)));
      }).then((unlisten) => unlisteners.push(unlisten));
      listen('av:playing', () => setIsPlaying(true)).then((unlisten) => unlisteners.push(unlisten));
      listen('av:paused', () => setIsPlaying(false)).then((unlisten) => unlisteners.push(unlisten));
      listen('av:ended', () => {
        setIsPlaying(false);
        if (loopEnabled()) {
          void seekTo(lockedRange().start);
        } else {
          void seekTo(0);
        }
      }).then((unlisten) => unlisteners.push(unlisten));
    }

    const onGlobalKeyDown = (event: KeyboardEvent) => {
      // Cmd/Ctrl-Z / Cmd/Ctrl-Shift-Z for undo/redo — allow even when typing in the general-note textarea
      const mod = event.metaKey || event.ctrlKey;
      if (mod && (event.key === 'z' || event.key === 'Z')) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (isTypingTarget(event.target)) return;
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        addPointNoteAtPlayhead();
        return;
      }
      if (event.key === ' ' || event.code === 'Space') {
        if (isControlTarget(event.target)) return;
        event.preventDefault();
        void togglePlay();
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (isControlTarget(event.target)) return;
        event.preventDefault();
        const step = event.shiftKey ? PLAYHEAD_SCRUB_SECONDS : PLAYHEAD_NUDGE_SECONDS;
        nudgePlayhead(event.key === 'ArrowLeft' ? -step : step);
        return;
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        if (isTypingTarget(event.target)) return;
        const id = selectedNoteId();
        if (id !== null) {
          event.preventDefault();
          deleteNote(id);
        }
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
    onCleanup(() => {
      window.removeEventListener('keydown', onGlobalKeyDown);
      unlisteners.forEach((unlisten) => unlisten());
    });
  });

  const timeFromPointer = (clientX: number) => {
    if (!timelineEl) return 0;
    const rect = timelineEl.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return percent * playbackDuration();
  };

  const onTimelineDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const time = timeFromPointer(event.clientX);

    if (event.shiftKey) {
      const origin = dragStart() ?? lockedRange().start;
      const newStart = Math.min(origin, time);
      const newEnd = Math.max(origin, time);
      setLockedRange({ start: newStart, end: newEnd });

      const id = lastPointNoteId();
      if (id !== null) {
        pushHistory();
        setNotes((current) => current.map((note) => {
          if (note.id === id && note.kind === 'point' && note.rangeStart === origin) {
            return { ...note, kind: 'range', rangeStart: newStart, rangeEnd: newEnd };
          }
          return note;
        }));
        persistNoteById(id);
      }
        
      setDragStart(origin);
      setDragNow(time);
      setIsDraggingTimeline(true);
      timelineEl?.setPointerCapture(event.pointerId);
      return;
    }

    const range = lockedRange();
    if (selectedNoteId() === null && range.end > range.start && time >= range.start && time <= range.end) {
      addRangeNoteDraft();
      return;
    }
    setSelectedNoteId(null);
    if (linkTimelineEdit()) {
      void seekTo(time);
    }
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

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          if (redoStack().length > 0) redo();
        } else {
          e.preventDefault();
          if (undoStack().length > 0) undo();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => window.removeEventListener('keydown', handleKeyDown));
  });

  return (
    <ErrorBoundary fallback={(err) => (
      <div style={{ padding: '20px', background: 'red', color: 'white', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999 }}>
        <h2>SolidJS Error Boundary Caught an Error!</h2>
        <p>{err.toString()}</p>
      </div>
    )}>
      <main class="review-app">
        <div class="scaled-app">
        <header class="topbar">
          <div class="topbar-title">
            <p class="eyebrow">Pik Pro Player</p>
            <div class="title-row">
              <div class="topbar-title-wrap">
                <h1>{trackTitle()}</h1>
              </div>
              <div class="transport-bar">
                <input
                ref={audioInputEl}
                class="transport-file-input"
                type="file"
                accept="audio/*,.wav,.aif,.aiff,.mp3,.m4a,.mp4"
                onChange={onAudioFileChange}
              />
              <button type="button" class="transport-btn is-load" onClick={onLoadAudioClick} aria-label="Load audio file">
                Load
              </button>
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
              <div class="topbar-meta">
                <span>{activeVersion().title}</span>
                <strong>{activeVersion().label} · {selectedRangeLabel()}</strong>
              </div>
              <span class="transport-status">{loadStatus()}</span>
            </div>
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
                <strong>{lufsEnabled() ? `${selectedIntegratedLufs()} LUFS` : '--'}</strong>
              </div>
              <div class="loudness-stats" classList={{ 'is-disabled': !lufsEnabled() }}>
                <div>
                  <span>Range</span>
                  <strong>{lufsEnabled() ? (selectedLoudnessRange() !== null ? `${selectedLoudnessRange()} LU` : '— LU') : '--'}</strong>
                </div>
                <div>
                  <span>Short</span>
                  <strong>{lufsEnabled() ? (selectedShortTerm() !== null ? `${selectedShortTerm()}` : '—') : '--'}</strong>
                </div>
                <div classList={{ 'is-warn': lufsEnabled() && truePeakStatus() === 'warn', 'is-fail': lufsEnabled() && truePeakStatus() === 'fail' }}>
                  <span>True Peak</span>
                  <strong>{lufsEnabled() ? `${selectedTruePeak()}` : '--'}</strong>
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
                    style={{ left: lufsEnabled() ? loudnessPosition(selectedIntegratedLufs()) : '0%' }}
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
                    <strong>{lufsEnabled() ? (selectedShortTermMax() !== null ? `${selectedShortTermMax()}` : '—') : '--'}</strong>
                  </div>
                  <div>
                    <span>Momentary Max</span>
                    <strong>{lufsEnabled() ? (selectedMomentaryMax() !== null ? `${selectedMomentaryMax()}` : '—') : '--'}</strong>
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
                    <For each={displayMeterRows()}>
                      {(meter) => (
                        <div class="ppm-channel">
                          <span>{meter.label}</span>
                          <div class="ppm-slot">
                            <i style={{ transform: `scaleX(${ppmEnabled() ? meter.value / 100 : 0})` }} />
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
              <button
                type="button"
                class="timeline-toggle-btn"
                classList={{ 'is-active': linkTimelineEdit() }}
                onClick={() => setLinkTimelineEdit(!linkTimelineEdit())}
              >
                <span class="toggle-indicator"></span>
                Link Edit to Playhead
              </button>
              <div class="timeline-hotkeys">
                Space: Play/Pause &middot; ←/→: Scrub &middot; N: Point Note &middot; Shift+Click: Expand &middot; Drag: Select Range &middot; Enter: Range Note
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
              <Show when={waveformPeaks()}>
                {(peaks) => (
                  <svg class="waveform-bg" preserveAspectRatio="none" viewBox={`0 0 ${peaks().length - 1} 100`}>
                    <path d={waveformPath()} />
                  </svg>
                )}
              </Show>
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
                      left: `${(note.rangeStart / playbackDuration()) * 100}%`,
                      width: note.kind === 'point' ? undefined : `${Math.max(0.7, ((note.rangeEnd - note.rangeStart) / playbackDuration()) * 100)}%`,
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
                      onPointerDown={(event) => {
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
                  left: `${(displayRange().start / playbackDuration()) * 100}%`,
                  width: `${Math.max(0.35, ((displayRange().end - displayRange().start) / playbackDuration()) * 100)}%`,
                }}
              />
              <div class="playhead" style={{ left: `${(playheadTime() / playbackDuration()) * 100}%` }} />
            </div>
            <div class="timeline-ticks">
              <For each={timelineTicks()}>
                {(tick) => <span>{formatTime(tick)}</span>}
              </For>
            </div>
          </div>
        </section>

        <button
          type="button"
          class="panel-resizer"
          onPointerDown={onResizeDown}
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
                  <button type="button" class="export-link" onClick={() => setShowAnalytics((v) => !v)}>
                    {showAnalytics() ? 'Hide Analytics' : 'Show Analytics'}
                  </button>
                  <button type="button" class="export-link" onClick={exportNotesCsv}>Export CSV</button>
                  <button type="button" class="export-link" onClick={exportNotesJson}>Export JSON</button>
                  <button
                    type="button"
                    class="export-link"
                    style={{ padding: "2px 6px" }}
                    disabled={undoStack().length === 0}
                    onClick={undo}
                    title="Undo (⌘Z)"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3l-3 2.7"/></svg>
                  </button>
                  <button
                    type="button"
                    class="export-link"
                    style={{ padding: "2px 6px" }}
                    disabled={redoStack().length === 0}
                    onClick={redo}
                    title="Redo (⌘⇧Z)"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/></svg>
                  </button>
                </div>
              </div>

              {showAnalytics() && (
                <>
                  <div class="version-compare-card">
                    <div class="version-compare-head">
                      <div>
                        <span>Version Compare</span>
                        <strong>{activeVersion().title}</strong>
                      </div>
                      <div class="version-switcher" aria-label="Mix version switcher">
                        <For each={mixVersions}>
                          {(version) => (
                            <button
                              type="button"
                              classList={{ 'is-active': activeVersionId() === version.id }}
                              onClick={() => setActiveVersionId(version.id)}
                              aria-pressed={activeVersionId() === version.id}
                            >
                              {version.label}
                            </button>
                          )}
                        </For>
                      </div>
                    </div>
                    <p>{activeVersion().note}</p>
                    <div class="version-metrics">
                      <div>
                        <span>LUFS</span>
                        <strong>{activeVersion().integratedLufs}</strong>
                        <small classList={{ 'is-better': versionDelta().lufs < 0, 'is-worse': versionDelta().lufs > 0 }}>
                          {versionDelta().lufs >= 0 ? '+' : ''}{versionDelta().lufs.toFixed(1)} vs {compareVersion().label}
                        </small>
                      </div>
                      <div>
                        <span>True Peak</span>
                        <strong>{activeVersion().truePeak}</strong>
                        <small classList={{ 'is-better': versionDelta().truePeak < 0, 'is-worse': versionDelta().truePeak > 0 }}>
                          {versionDelta().truePeak >= 0 ? '+' : ''}{versionDelta().truePeak.toFixed(1)} dB
                        </small>
                      </div>
                      <div>
                        <span>Open Issues</span>
                        <strong>{activeVersion().openIssues}</strong>
                        <small classList={{ 'is-better': versionDelta().issues < 0, 'is-worse': versionDelta().issues > 0 }}>
                          {versionDelta().issues >= 0 ? '+' : ''}{versionDelta().issues}
                        </small>
                      </div>
                    </div>
                    <div class="version-foot">
                      <span>Updated {activeVersion().updatedAt}</span>
                      <span>Compare against {compareVersion().label}</span>
                    </div>
                  </div>

                  <div class="reference-card">
                    <div class="reference-head">
                      <div>
                        <span>Reference Track</span>
                        <strong>{referenceTrack().name}</strong>
                      </div>
                      <div class="reference-actions">
                        <input
                          ref={referenceInputEl}
                          class="reference-file-input"
                          type="file"
                          accept="audio/*,.wav,.aif,.aiff,.mp3,.m4a"
                          onChange={onReferenceFileChange}
                        />
                        <button type="button" onClick={() => referenceInputEl?.click()}>Load</button>
                        <button type="button" onClick={() => setReferenceTrack(defaultReferenceTrack)}>Reset</button>
                      </div>
                    </div>
                    <div class="reference-meta">
                      <span>{referenceTrack().source === 'file' ? 'File selected' : 'Mock reference'}</span>
                      <span>{referenceTrack().integratedLufs} LUFS</span>
                      <span>{referenceTrack().truePeak} dBTP</span>
                    </div>
                    <svg class="reference-graph" viewBox="0 0 220 68" preserveAspectRatio="none" aria-label="Loudness over time graph">
                      <line x1="0" y1="20" x2="220" y2="20" />
                      <line x1="0" y1="44" x2="220" y2="44" />
                      <polyline class="is-reference" points={referenceCurvePoints()} />
                      <polyline class="is-current" points={currentCurvePoints()} />
                      <line
                        class="is-playhead"
                        x1={(playheadTime() / playbackDuration()) * 220}
                        x2={(playheadTime() / playbackDuration()) * 220}
                        y1="4"
                        y2="64"
                      />
                    </svg>
                    <div class="reference-legend">
                      <span><i class="is-current" />Active mix</span>
                      <span><i class="is-reference" />Reference</span>
                    </div>
                  </div>

                  <div class="phase-card">
                    <div class="phase-head">
                      <div>
                        <span>Phase / Spectrum</span>
                        <strong>Mix Integrity</strong>
                      </div>
                      <strong class="phase-score">{correlationValue().toFixed(2)}</strong>
                    </div>
                    <div class="phase-meter">
                      <span>-1</span>
                      <div>
                        <i style={{ left: `${((correlationValue() + 1) / 2) * 100}%` }} />
                      </div>
                      <span>+1</span>
                    </div>
                    <div class="phase-meta">
                      <span>Correlation</span>
                      <strong>{phaseOffset()}° phase offset</strong>
                    </div>
                    <div class="spectrum-bars" aria-label="Spectrum analyzer preview">
                      <For each={spectrumBands}>
                        {(band) => (
                          <div>
                            <i style={{ height: `${activeVersionId() === 'b' ? Math.max(18, band.value - 6) : band.value}%` }} />
                            <span>{band.label}</span>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </>
              )}

              <div class="general-note-card">
                <span>General Note</span>
                <textarea
                  value={generalNote()}
                  onInput={(event) => { pushHistoryDebounced(); setGeneralNote(event.currentTarget.value); }}
                  onKeyDown={(event) => {
                    handleAutoListKeyDown(event);
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
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
                            setTimeout(() => {
                              el.focus();
                              el.setSelectionRange(el.value.length, el.value.length);
                            }, 10);
                          }}
                          onBlur={(event) => {
                            updateNoteBody(note.id, event.currentTarget.value);
                            setEditingNoteId(null);
                          }}
                          onKeyDown={(event) => {
                            handleAutoListKeyDown(event);
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

window.addEventListener('error', (e) => {
  const errDiv = document.createElement('div');
  errDiv.style.cssText = 'position:fixed;top:0;left:0;z-index:9999;background:red;color:white;padding:20px;font-size:16px;overflow:auto;max-height:100vh;width:100vw;';
  errDiv.innerHTML = `<strong>Error:</strong> ${e.message}<br/><pre>${e.error?.stack}</pre>`;
  document.body.appendChild(errDiv);
});

window.addEventListener('unhandledrejection', (e) => {
  const errDiv = document.createElement('div');
  errDiv.style.cssText = 'position:fixed;top:0;left:0;z-index:9999;background:orange;color:white;padding:20px;font-size:16px;overflow:auto;max-height:100vh;width:100vw;';
  errDiv.innerHTML = `<strong>Unhandled Promise Rejection:</strong> ${e.reason}`;
  document.body.appendChild(errDiv);
});

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element #root was not found.');
}

render(() => <App />, root);
