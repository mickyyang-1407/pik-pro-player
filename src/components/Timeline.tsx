import { Accessor, For, Show } from 'solid-js';
import { formatTime } from '../utils';

type Note = {
  id: number;
  rangeStart: number;
  rangeEnd: number;
  body: string;
  status: 'open' | 'checking' | 'done';
  kind: 'point' | 'range';
  severity: 'critical' | 'minor';
};

type TimelineProps = {
  selectedRangeLabel: Accessor<string>;
  linkTimelineEdit: Accessor<boolean>;
  setLinkTimelineEdit: (value: boolean) => void;
  onTimelineDown: (event: PointerEvent) => void;
  onTimelineMove: (event: PointerEvent) => void;
  onTimelineUp: (event: PointerEvent) => void;
  timelineRef: (el: HTMLDivElement) => void;
  waveformPeaks: Accessor<number[] | null>;
  waveformPath: Accessor<string>;
  filteredSortedNotes: Accessor<Note[]>;
  selectedNoteId: Accessor<number | null>;
  selectNote: (note: Note) => void;
  deleteNote: (id: number) => void;
  playbackDuration: Accessor<number>;
  displayRange: Accessor<{ start: number; end: number }>;
  playheadTime: Accessor<number>;
  timelineTicks: Accessor<number[]>;
};

export function Timeline(props: TimelineProps) {
  return (
    <>
      <div class="timeline-card">
        <div class="timeline-head">
          <div style={{ display: 'flex', 'align-items': 'center', gap: '16px' }}>
            <div class="timeline-range-badge">
              <span>Locked Range</span>
              <strong>{props.selectedRangeLabel()}</strong>
            </div>
            <button
              type="button"
              class="timeline-toggle-btn"
              classList={{ 'is-active': props.linkTimelineEdit() }}
              onClick={() => props.setLinkTimelineEdit(!props.linkTimelineEdit())}
            >
              <span class="toggle-indicator"></span>
              Link Edit to Playhead
            </button>
          </div>
        </div>
        <div
          ref={(el) => props.timelineRef(el)}
          class="timeline-track"
          onPointerDown={props.onTimelineDown}
          onPointerMove={props.onTimelineMove}
          onPointerUp={props.onTimelineUp}
          onPointerCancel={props.onTimelineUp}
        >
          <Show when={props.waveformPeaks()}>
            {(peaks) => (
              <svg class="waveform-bg" preserveAspectRatio="none" viewBox={`0 0 ${peaks().length - 1} 100`}>
                <path d={props.waveformPath()} />
              </svg>
            )}
          </Show>
          <For each={props.filteredSortedNotes()}>
            {(note) => (
              <div
                class="note-range"
                classList={{
                  'is-point': note.kind === 'point',
                  'is-selected': props.selectedNoteId() === note.id,
                  'is-critical': note.severity === 'critical',
                }}
                style={{
                  left: `${(note.rangeStart / props.playbackDuration()) * 100}%`,
                  width: note.kind === 'point' ? undefined : `${Math.max(0.7, ((note.rangeEnd - note.rangeStart) / props.playbackDuration()) * 100)}%`,
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  props.selectNote(note);
                }}
                title={note.body || 'Empty note'}
              >
                <button
                  type="button"
                  class="note-range-delete"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    props.deleteNote(note.id);
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
              left: `${(props.displayRange().start / props.playbackDuration()) * 100}%`,
              width: `${Math.max(0.35, ((props.displayRange().end - props.displayRange().start) / props.playbackDuration()) * 100)}%`,
            }}
          />
          <div class="playhead" style={{ left: `${(props.playheadTime() / props.playbackDuration()) * 100}%` }} />
        </div>
        <div class="timeline-ticks">
          <For each={props.timelineTicks()}>
            {(tick) => <span>{formatTime(tick)}</span>}
          </For>
        </div>
      </div>
      
      <div class="timeline-hotkeys">
        <span><kbd>Space</kbd> Play / Pause</span>
        <span><kbd>←</kbd> / <kbd>→</kbd> Scrub</span>
        <span><kbd>N</kbd> Point Note</span>
        <span><kbd>Shift</kbd> + Click Expand</span>
        <span>Drag Select Range</span>
        <span><kbd>Enter</kbd> Range Note</span>
      </div>
    </>
  );
}
