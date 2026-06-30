import { For, createMemo, createSignal, onCleanup } from 'solid-js';
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
  { label: 'L', group: 'front', area: 'left' },
  { label: 'C', group: 'front', area: 'center' },
  { label: 'R', group: 'front', area: 'right' },
  { label: 'LFE', group: 'lfe', area: 'lfe' },
  { label: 'Ls', group: 'side', area: 'leftSide' },
  { label: 'Rs', group: 'side', area: 'rightSide' },
  { label: 'Lrs', group: 'rear', area: 'leftRear' },
  { label: 'Rrs', group: 'rear', area: 'rightRear' },
  { label: 'Ltf', group: 'top', area: 'leftTopFront' },
  { label: 'Rtf', group: 'top', area: 'rightTopFront' },
  { label: 'Ltr', group: 'top', area: 'leftTopRear' },
  { label: 'Rtr', group: 'top', area: 'rightTopRear' },
];

const meterRows = [
  { label: 'L', value: 72 },
  { label: 'C', value: 78 },
  { label: 'R', value: 69 },
  { label: 'Ls', value: 42 },
  { label: 'Rs', value: 45 },
  { label: 'Top', value: 36 },
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
  const [activeSpeaker, setActiveSpeaker] = createSignal('C');
  const [soloGroups, setSoloGroups] = createSignal<Set<Speaker['group']>>(new Set());
  const [dragStart, setDragStart] = createSignal<number | null>(null);
  const [dragNow, setDragNow] = createSignal<number | null>(null);
  const [isDraggingTimeline, setIsDraggingTimeline] = createSignal(false);
  const [isResizingNotes, setIsResizingNotes] = createSignal(false);

  let timelineEl: HTMLDivElement | undefined;

  const panelWidth = createMemo(() => (notesCollapsed() ? '52px' : `${notesWidth()}%`));
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
          <div class="speaker-header">
            <div>
              <span>Speaker Room</span>
              <strong>Top Monitoring View</strong>
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
                    classList={{ 'is-solo': soloGroups().has(group.id) }}
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
                      setActiveSpeaker('');
                    }}
                  >
                    {group.label}
                  </button>
                )}
              </For>
              <button type="button" class="clear-pill" onClick={() => { setLockedRange({ start: 0, end: 0 }); setSoloGroups(new Set()); setActiveSpeaker(''); }}>
                Clear
              </button>
            </div>
          </div>

          <div class="room-wrap">
            <section class="analysis-panel" aria-label="Metering and loudness">
              <div class="analysis-heading">
                <span>Metering</span>
                <strong>Loudness</strong>
              </div>
              <div class="loudness-readout">
                <span>Integrated</span>
                <strong>-14.2 LUFS</strong>
              </div>
              <div class="loudness-stats">
                <div>
                  <span>Short</span>
                  <strong>-12.8</strong>
                </div>
                <div>
                  <span>True Peak</span>
                  <strong>-1.1</strong>
                </div>
              </div>
              <div class="meter-list">
                <For each={meterRows}>
                  {(meter) => (
                    <div class="meter-row">
                      <span>{meter.label}</span>
                      <div>
                        <i style={{ width: `${meter.value}%` }} />
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </section>

            <section class="speaker-view" aria-label="Top-down speaker view">
              <div class="speaker-view-title">
                <span>Speaker View</span>
                <strong>{soloGroups().size > 0 ? [...soloGroups()].map(g => g.toUpperCase()).join('+') + ' Solo' : activeSpeaker() || 'All'}</strong>
              </div>
              <div class="room-plane">
                <div class="screen-line">SCREEN</div>
                <div class="speaker-grid">
                  <div class="listener-dot">
                    <span />
                  </div>
                  <For each={speakers}>
                    {(speaker) => {
                      const isActive = () => activeSpeaker() === speaker.label || soloGroups().has(speaker.group);
                      return (
                        <button
                          type="button"
                          class="speaker-button"
                          classList={{
                            'is-height': speaker.group === 'top',
                            'is-lfe': speaker.group === 'lfe',
                            'is-active': isActive(),
                          }}
                          style={{ 'grid-area': speaker.area }}
                          onClick={() => {
                            setSoloGroups(new Set());
                            setActiveSpeaker((cur) => (cur === speaker.label ? '' : speaker.label));
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
          classList={{ 'is-dragging': isResizingNotes(), 'is-disabled': notesCollapsed() }}
          onPointerDown={onResizeDown}
          aria-label="Resize notes panel"
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
