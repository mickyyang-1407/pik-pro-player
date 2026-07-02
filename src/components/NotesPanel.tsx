import { Accessor, For, Show } from 'solid-js';
import {
  Note,
  MixVersion,
  ReferenceTrack,
  mixVersions,
  defaultReferenceTrack,
  spectrumBands,
} from '../types';
import { formatTime } from '../utils';

type NotesPanelProps = {
  notesCollapsed: Accessor<boolean>;
  setNotesCollapsed: (updater: (collapsed: boolean) => boolean) => void;
  notes: Accessor<Note[]>;
  showAnalytics: Accessor<boolean>;
  setShowAnalytics: (updater: (v: boolean) => boolean) => void;
  exportNotesCsv: () => void;
  exportNotesJson: () => void;
  undoStack: Accessor<unknown[]>;
  redoStack: Accessor<unknown[]>;
  undo: () => void;
  redo: () => void;
  activeVersion: Accessor<MixVersion>;
  activeVersionId: Accessor<MixVersion['id']>;
  setActiveVersionId: (id: MixVersion['id']) => void;
  versionDelta: Accessor<{ lufs: number; truePeak: number; issues: number }>;
  compareVersion: Accessor<MixVersion>;
  referenceInputRef: (el: HTMLInputElement) => void;
  onReferenceLoadClick: () => void;
  referenceTrack: Accessor<ReferenceTrack>;
  onReferenceFileChange: (event: Event) => void;
  setReferenceTrack: (track: ReferenceTrack) => void;
  referenceCurvePoints: Accessor<string>;
  currentCurvePoints: Accessor<string>;
  playheadTime: Accessor<number>;
  playbackDuration: Accessor<number>;
  correlationValue: Accessor<number>;
  phaseOffset: Accessor<number>;
  generalNote: Accessor<string>;
  setGeneralNote: (value: string) => void;
  pushHistoryDebounced: () => void;
  handleAutoListKeyDown: (event: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) => void;
  selectedRangeLabel: Accessor<string>;
  displayRange: Accessor<{ start: number; end: number }>;
  selectedNoteId: Accessor<number | null>;
  addRangeNoteDraft: () => void;
  noteSearch: Accessor<string>;
  setNoteSearch: (value: string) => void;
  statusFilter: Accessor<'all' | 'open' | 'checking' | 'done'>;
  setStatusFilter: (value: 'all' | 'open' | 'checking' | 'done') => void;
  severityFilter: Accessor<'all' | 'critical' | 'minor'>;
  setSeverityFilter: (value: 'all' | 'critical' | 'minor') => void;
  filteredSortedNotes: Accessor<Note[]>;
  selectNote: (note: Note) => void;
  toggleSeverity: (id: number) => void;
  cycleStatus: (id: number) => void;
  deleteNote: (id: number) => void;
  editingNoteId: Accessor<number | null>;
  setEditingNoteId: (id: number | null) => void;
  updateNoteBody: (id: number, body: string) => void;
  shareSender: Accessor<string>;
  setShareSender: (value: string) => void;
  shareRecipient: Accessor<string>;
  setShareRecipient: (value: string) => void;
  isSharing: Accessor<boolean>;
  handleShareNotes: () => void;
  shareStatus: Accessor<string>;
};

export function NotesPanel(props: NotesPanelProps) {
  return (
    <aside class="notes-panel" classList={{ 'is-collapsed': props.notesCollapsed() }}>
      <button
        type="button"
        class="collapse-button"
        onClick={() => props.setNotesCollapsed((collapsed) => !collapsed)}
        aria-label={props.notesCollapsed() ? 'Expand notes panel' : 'Collapse notes panel'}
      >
        {props.notesCollapsed() ? '◀' : '▶'}
      </button>

      {!props.notesCollapsed() && (
        <div class="notes-content">
          <div class="notes-heading">
            <div>
              <span>Notes Panel</span>
              <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
                <strong>Time Range Notes</strong>
                <Show when={props.notes().length > 0}>
                  <span class="note-count-badge">
                    {props.notes().length}
                  </span>
                </Show>
              </div>
            </div>
            <div class="notes-heading-meta">
              <div class="notes-heading-actions">
                <button type="button" class="ghost-btn" onClick={() => props.setShowAnalytics((v) => !v)}>
                  {props.showAnalytics() ? 'Hide Analytics' : 'Analytics'}
                </button>
                <button type="button" class="ghost-btn" onClick={props.exportNotesCsv}>CSV</button>
                <button type="button" class="ghost-btn" onClick={props.exportNotesJson}>JSON</button>
              </div>
              <div class="notes-heading-actions" style={{ 'margin-left': 'auto' }}>
                <button
                  type="button"
                  class="ghost-btn"
                  disabled={props.undoStack().length === 0}
                  onClick={props.undo}
                  title="Undo (⌘Z)"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3l-3 2.7"/></svg>
                </button>
                <button
                  type="button"
                  class="ghost-btn"
                  disabled={props.redoStack().length === 0}
                  onClick={props.redo}
                  title="Redo (⇧⌘Z)"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/></svg>
                </button>
              </div>
            </div>
          </div>

          {props.showAnalytics() && (
            <>
              <div class="version-compare-card">
                <div class="version-compare-head">
                  <div>
                    <span>Version Compare</span>
                    <strong>{props.activeVersion().title}</strong>
                  </div>
                  <div class="version-switcher" aria-label="Mix version switcher">
                    <For each={mixVersions}>
                      {(version) => (
                        <button
                          type="button"
                          classList={{ 'is-active': props.activeVersionId() === version.id }}
                          onClick={() => props.setActiveVersionId(version.id)}
                          aria-pressed={props.activeVersionId() === version.id}
                        >
                          {version.label}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
                <p>{props.activeVersion().note}</p>
                <div class="version-metrics">
                  <div>
                    <span>LUFS</span>
                    <strong>{props.activeVersion().integratedLufs}</strong>
                    <small classList={{ 'is-better': props.versionDelta().lufs < 0, 'is-worse': props.versionDelta().lufs > 0 }}>
                      {props.versionDelta().lufs >= 0 ? '+' : ''}{props.versionDelta().lufs.toFixed(1)} vs {props.compareVersion().label}
                    </small>
                  </div>
                  <div>
                    <span>True Peak</span>
                    <strong>{props.activeVersion().truePeak}</strong>
                    <small classList={{ 'is-better': props.versionDelta().truePeak < 0, 'is-worse': props.versionDelta().truePeak > 0 }}>
                      {props.versionDelta().truePeak >= 0 ? '+' : ''}{props.versionDelta().truePeak.toFixed(1)} dB
                    </small>
                  </div>
                  <div>
                    <span>Open Issues</span>
                    <strong>{props.activeVersion().openIssues}</strong>
                    <small classList={{ 'is-better': props.versionDelta().issues < 0, 'is-worse': props.versionDelta().issues > 0 }}>
                      {props.versionDelta().issues >= 0 ? '+' : ''}{props.versionDelta().issues}
                    </small>
                  </div>
                </div>
                <div class="version-foot">
                  <span>Updated {props.activeVersion().updatedAt}</span>
                  <span>Compare against {props.compareVersion().label}</span>
                </div>
              </div>

              <div class="reference-card">
                <div class="reference-head">
                  <div>
                    <span>Reference Track</span>
                    <strong>{props.referenceTrack().name}</strong>
                  </div>
                  <div class="reference-actions">
                    <input
                      ref={(el) => props.referenceInputRef(el)}
                      class="reference-file-input"
                      type="file"
                      accept="audio/*,.wav,.aif,.aiff,.mp3,.m4a"
                      onChange={props.onReferenceFileChange}
                    />
                    <button type="button" onClick={props.onReferenceLoadClick}>Load</button>
                    <button type="button" onClick={() => props.setReferenceTrack(defaultReferenceTrack)}>Reset</button>
                  </div>
                </div>
                <div class="reference-meta">
                  <span>{props.referenceTrack().source === 'file' ? 'File selected' : 'Mock reference'}</span>
                  <span>{props.referenceTrack().integratedLufs} LUFS</span>
                  <span>{props.referenceTrack().truePeak} dBTP</span>
                </div>
                <svg class="reference-graph" viewBox="0 0 220 68" preserveAspectRatio="none" aria-label="Loudness over time graph">
                  <line x1="0" y1="20" x2="220" y2="20" />
                  <line x1="0" y1="44" x2="220" y2="44" />
                  <polyline class="is-reference" points={props.referenceCurvePoints()} />
                  <polyline class="is-current" points={props.currentCurvePoints()} />
                  <line
                    class="is-playhead"
                    x1={(props.playheadTime() / props.playbackDuration()) * 220}
                    x2={(props.playheadTime() / props.playbackDuration()) * 220}
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
                  <strong class="phase-score">{props.correlationValue().toFixed(2)}</strong>
                </div>
                <div class="phase-meter">
                  <span>-1</span>
                  <div>
                    <i style={{ left: `${((props.correlationValue() + 1) / 2) * 100}%` }} />
                  </div>
                  <span>+1</span>
                </div>
                <div class="phase-meta">
                  <span>Correlation</span>
                  <strong>{props.phaseOffset()}° phase offset</strong>
                </div>
                <div class="spectrum-bars" aria-label="Spectrum analyzer preview">
                  <For each={spectrumBands}>
                    {(band) => (
                      <div>
                        <i style={{ height: `${props.activeVersionId() === 'b' ? Math.max(18, band.value - 6) : band.value}%` }} />
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
              value={props.generalNote()}
              onInput={(event) => { props.pushHistoryDebounced(); props.setGeneralNote(event.currentTarget.value); }}
              onKeyDown={(event) => {
                props.handleAutoListKeyDown(event);
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
            <strong>{props.selectedRangeLabel()}</strong>
          </div>

          <button
            type="button"
            class="primary-action"
            disabled={props.displayRange().end <= props.displayRange().start || props.selectedNoteId() !== null}
            onClick={props.addRangeNoteDraft}
          >
            Add Range Note
          </button>
          <div class="note-filter-bar">
            <input
              type="text"
              class="note-search-input"
              value={props.noteSearch()}
              onInput={(event) => props.setNoteSearch(event.currentTarget.value)}
              placeholder="Search notes..."
            />
            <select
              value={props.statusFilter()}
              onChange={(event) => props.setStatusFilter(event.currentTarget.value as 'all' | 'open' | 'checking' | 'done')}
            >
              <option value="all">All Status</option>
              <option value="open">Open</option>
              <option value="checking">Checking</option>
              <option value="done">Done</option>
            </select>
            <select
              value={props.severityFilter()}
              onChange={(event) => props.setSeverityFilter(event.currentTarget.value as 'all' | 'critical' | 'minor')}
            >
              <option value="all">All Severity</option>
              <option value="critical">Critical</option>
              <option value="minor">Minor</option>
            </select>
          </div>

          <div class="note-list">
            <For each={props.filteredSortedNotes()}>
              {(note) => (
                <article
                  class="note-item"
                  classList={{
                    'is-point': note.kind === 'point',
                    'is-selected': props.selectedNoteId() === note.id,
                    'is-critical': note.severity === 'critical',
                  }}
                  data-note-id={note.id}
                >
                  <div>
                    <strong onClick={() => props.selectNote(note)}>
                      {note.kind === 'point' ? formatTime(note.rangeStart) : `${formatTime(note.rangeStart)} - ${formatTime(note.rangeEnd)}`}
                    </strong>
                    <div class="note-item-actions">
                      <button
                        type="button"
                        class="severity-pill"
                        classList={{ 'is-critical': note.severity === 'critical' }}
                        onClick={() => props.toggleSeverity(note.id)}
                      >
                        {note.severity === 'critical' ? 'Critical' : 'Minor'}
                      </button>
                      <button
                        type="button"
                        class="status-pill-toggle"
                        classList={{ 'is-checking': note.status === 'checking', 'is-done': note.status === 'done' }}
                        onClick={() => props.cycleStatus(note.id)}
                        aria-label="Cycle note status"
                      >
                        {note.status}
                      </button>
                      <button
                        type="button"
                        class="note-delete"
                        onClick={() => props.deleteNote(note.id)}
                        aria-label="Delete note"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  {props.editingNoteId() === note.id ? (
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
                        props.updateNoteBody(note.id, event.currentTarget.value);
                        props.setEditingNoteId(null);
                      }}
                      onKeyDown={(event) => {
                        props.handleAutoListKeyDown(event);
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          props.updateNoteBody(note.id, event.currentTarget.value);
                          props.setEditingNoteId(null);
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          props.setEditingNoteId(null);
                        }
                      }}
                      placeholder="Type your note..."
                    />
                  ) : (
                    <p onClick={() => props.setEditingNoteId(note.id)}>{note.body || 'Click to add note text…'}</p>
                  )}
                </article>
              )}
            </For>
          </div>
          <div class="share-notes-card">
            <span>Send Notes via Email</span>
            <div class="share-notes-form" style="flex-direction: column;">
              <input
                type="email"
                class="share-email-input"
                placeholder="Your Email (Sender)"
                value={props.shareSender()}
                onInput={(e) => props.setShareSender(e.currentTarget.value)}
              />
              <div style="display: flex; gap: 8px;">
                <input
                  type="email"
                  class="share-email-input"
                  placeholder="Engineer Email (Recipient)"
                  value={props.shareRecipient()}
                  onInput={(e) => props.setShareRecipient(e.currentTarget.value)}
                />
                <button
                  type="button"
                  class="primary-action"
                  onClick={props.handleShareNotes}
                  disabled={props.isSharing() || !props.shareRecipient() || !props.shareSender()}
                >
                  {props.isSharing() ? 'Sending...' : 'Send'}
                </button>
              </div>
            </div>
            {props.shareStatus() && <p class="share-status-message" classList={{ 'is-error': props.shareStatus().startsWith('Error') }}>{props.shareStatus()}</p>}
          </div>
        </div>
      )}
    </aside>
  );
}
