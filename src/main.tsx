import { For, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
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
};

const durationSeconds = 214;
const zoomOptions = [50, 75, 100, 125, 150];

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

const loudnessPosition = (value: number) => `${Math.max(0, Math.min(100, ((value + 60) / 60) * 100))}%`;

type TargetPlatform = { id: string; label: string; target: number; truePeak: number; note?: string };

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
  { id: 'atmos-music', label: 'Dolby Atmos Music (-18)', target: -18, truePeak: -1, note: 'Apple Music / Amazon Music / Tidal' },
  { id: 'atmos-netflix', label: 'Netflix Atmos (-27)', target: -27, truePeak: -2, note: 'dialogue-gated ±2 LU, BS.1770-1' },
];

const seedNotes: Note[] = [
  {
    id: 1,
    rangeStart: 38,
    rangeEnd: 58,
    body: 'Verse low-mid feels crowded. Try a tighter pocket around 180 Hz.',
    status: 'open',
  },
  {
    id: 2,
    rangeStart: 95,
    rangeEnd: 153,
    body: 'Chorus lift works. Check vocal edge after the downbeat.',
    status: 'checking',
  },
];

function formatTime(seconds: number) {
  const clamped = Math.max(0, Math.min(durationSeconds, seconds));
  const minutes = Math.floor(clamped / 60);
  const wholeSeconds = Math.floor(clamped % 60);
  return `${minutes.toString().padStart(2, '0')}:${wholeSeconds.toString().padStart(2, '0')}`;
}

function App() {
  const [notesWidth, setNotesWidth] = createSignal(30);
  const [zoom, setZoom] = createSignal(100);
  const [notesCollapsed, setNotesCollapsed] = createSignal(false);
  const [lockedRange, setLockedRange] = createSignal({ start: 95, end: 153 });
  const [draft, setDraft] = createSignal('');
  const [notes, setNotes] = createSignal(seedNotes);
  const [activeSpeakers, setActiveSpeakers] = createSignal<Set<string>>(new Set(['C']));
  const [soloGroups, setSoloGroups] = createSignal<Set<Speaker['group']>>(new Set());
  const [speakerMode, setSpeakerMode] = createSignal<'solo' | 'mute'>('solo');
  const [lufsEnabled, setLufsEnabled] = createSignal(true);
  const [targetPlatformId, setTargetPlatformId] = createSignal(targetPlatforms[0].id);
  const targetPlatform = createMemo(() => targetPlatforms.find((p) => p.id === targetPlatformId()) ?? targetPlatforms[0]);
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

  const timeFromPointer = (clientX: number) => {
    if (!timelineEl) return 0;
    const rect = timelineEl.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return percent * durationSeconds;
  };

  const onTimelineDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const time = timeFromPointer(event.clientX);
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

  const addNote = () => {
    const text = draft().trim();
    if (!text) return;
    const range = lockedRange();
    setNotes((current) => [
      {
        id: Date.now(),
        rangeStart: range.start,
        rangeEnd: range.end,
        body: text,
        status: 'open',
      },
      ...current,
    ]);
    setDraft('');
  };

  return (
    <main class="review-app" style={{ '--ui-zoom': `${zoom() / 100}` }}>
      <div class="scaled-app">
      <header class="topbar">
        <div>
          <p class="eyebrow">Pik Pro Player</p>
          <h1>Mix Review Workspace</h1>
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
                <div>
                  <span>Integrated</span>
                  <strong>{lufsEnabled() ? '-14.2 LUFS' : '--'}</strong>
                </div>
                <div>
                  <span>Range</span>
                  <strong>{lufsEnabled() ? '7.6 LU' : '--'}</strong>
                </div>
              </div>
              <div class="loudness-stats" classList={{ 'is-disabled': !lufsEnabled() }}>
                <div>
                  <span>Short</span>
                  <strong>{lufsEnabled() ? '-12.8' : '--'}</strong>
                </div>
                <div>
                  <span>True Peak</span>
                  <strong>{lufsEnabled() ? '-1.1' : '--'}</strong>
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
                <div class="target-spec-note">
                  Max True Peak {targetPlatform().truePeak} dBTP{targetPlatform().note ? ` · ${targetPlatform().note}` : ''}
                </div>
                <div class="loudness-scale">
                  <div class="loudness-track" />
                  <div class="loudness-current" style={{ left: lufsEnabled() ? loudnessPosition(-14.2) : '0%' }} />
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
                    <strong>12 Channels</strong>
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
                        onClick={(e) => {
                          setSoloGroups((prev) => {
                            const next = new Set(prev);
                            if (e.shiftKey) {
                              if (next.has(group.id)) next.delete(group.id);
                              else next.add(group.id);
                            } else {
                              if (next.size === 1 && next.has(group.id)) next.clear();
                              else { next.clear(); next.add(group.id); }
                            }
                            return next;
                          });
                          setActiveSpeakers(new Set<string>());
                        }}
                      >
                        {group.label}
                      </button>
                    )}
                  </For>
                  <button type="button" class="clear-pill" onClick={() => { setLockedRange({ start: 0, end: 0 }); setSoloGroups(new Set<Speaker['group']>()); setActiveSpeakers(new Set<string>()); }}>
                    Clear
                  </button>
                </div>
              </div>
              <div class="speaker-view-title">
                <span>Speaker View</span>
                <strong classList={{ 'is-mute-label': (soloGroups().size > 0 || activeSpeakers().size > 0) && speakerMode() === 'mute' }}>{soloGroups().size > 0 ? [...soloGroups()].map(g => g.toUpperCase()).join('+') + ` ${speakerMode() === 'mute' ? 'Mute' : 'Solo'}` : activeSpeakers().size > 0 ? [...activeSpeakers()].join('+') + ` ${speakerMode() === 'mute' ? 'Mute' : 'Solo'}` : 'All'}</strong>
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
                          onClick={(e) => {
                            setSoloGroups(new Set<Speaker['group']>());
                            setActiveSpeakers((prev) => {
                              const next = new Set(prev);
                              if (e.shiftKey) {
                                if (next.has(speaker.label)) next.delete(speaker.label);
                                else next.add(speaker.label);
                              } else {
                                if (next.size === 1 && next.has(speaker.label)) next.clear();
                                else { next.clear(); next.add(speaker.label); }
                              }
                              return next;
                            });
                          }}
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
            </div>
            <div
              ref={timelineEl}
              class="timeline-track"
              onPointerDown={onTimelineDown}
              onPointerMove={onTimelineMove}
              onPointerUp={onTimelineUp}
              onPointerCancel={onTimelineUp}
            >
              <For each={notes()}>
                {(note) => (
                  <div
                    class="note-range"
                    style={{
                      left: `${(note.rangeStart / durationSeconds) * 100}%`,
                      width: `${Math.max(0.7, ((note.rangeEnd - note.rangeStart) / durationSeconds) * 100)}%`,
                    }}
                  />
                )}
              </For>
              <div
                class="locked-range"
                style={{
                  left: `${(displayRange().start / durationSeconds) * 100}%`,
                  width: `${Math.max(0.35, ((displayRange().end - displayRange().start) / durationSeconds) * 100)}%`,
                }}
              />
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
                <small>{notes().length} notes</small>
              </div>

              <div class="locked-card">
                <span>Current locked timecode</span>
                <strong>{selectedRangeLabel()}</strong>
              </div>

              <label class="note-editor">
                <span>New note</span>
                <textarea
                  value={draft()}
                  onInput={(event) => setDraft(event.currentTarget.value)}
                  placeholder="Write the note for the selected time range..."
                />
              </label>
              <button type="button" class="primary-action" onClick={addNote}>
                Add Range Note
              </button>

              <div class="note-list">
                <For each={notes()}>
                  {(note) => (
                    <article
                      class="note-item"
                      onClick={() => setLockedRange({ start: note.rangeStart, end: note.rangeEnd })}
                    >
                      <div>
                        <strong>{`${formatTime(note.rangeStart)} - ${formatTime(note.rangeEnd)}`}</strong>
                        <span>{note.status}</span>
                      </div>
                      <p>{note.body}</p>
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
