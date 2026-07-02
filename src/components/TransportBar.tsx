import { Accessor, Show } from 'solid-js';
import { formatTime } from '../utils';

type SeekHandlers = {
  onPointerDown: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerCancel?: (event: PointerEvent) => void;
  onPointerLeave?: (event: PointerEvent) => void;
};

type TransportBarProps = {
  trackTitle: Accessor<string>;
  isPlaying: Accessor<boolean>;
  loopEnabled: Accessor<boolean>;
  playheadTime: Accessor<number>;
  loadStatus: Accessor<string>;
  loadStatusVisible: Accessor<boolean>;
  appTheme: Accessor<string>;
  setAppTheme: (theme: string) => void;
  activeVersion: Accessor<{ title: string; label: string }>;
  onLoadAudioClick: () => void;
  onAudioFileChange: (event: Event) => void;
  togglePlay: () => void;
  toggleLoop: () => void;
  resetWindowSize: () => void;
  seekBack: SeekHandlers;
  seekForward: SeekHandlers;
  audioInputRef: (el: HTMLInputElement) => void;
};

export function TransportBar(props: TransportBarProps) {
  return (
    <header class="topbar">
      <div class="topbar-left">
        <p class="eyebrow">Pik Pro Player</p>
        <div class="title-row">
          <div class="topbar-title-wrap">
            <h1>{props.trackTitle()}</h1>
          </div>
          <input
            ref={(el) => props.audioInputRef(el)}
            class="transport-file-input"
            type="file"
            accept="audio/*,.wav,.aif,.aiff,.mp3,.m4a,.mp4"
            onChange={props.onAudioFileChange}
          />
          <button type="button" class="transport-btn is-load" onClick={props.onLoadAudioClick} aria-label="Load audio file">
            Load
          </button>
          <button type="button" class="ghost-btn is-default-size" onClick={props.resetWindowSize} aria-label="Reset Window Size">
            Default Size
          </button>
        </div>
      </div>

      <div class="transport-pill">
        <button
          type="button"
          class="transport-btn is-seek is-seek-back"
          onPointerDown={props.seekBack.onPointerDown}
          onPointerUp={props.seekBack.onPointerUp}
          onPointerCancel={props.seekBack.onPointerCancel}
          onPointerLeave={props.seekBack.onPointerLeave}
          aria-label="Seek back (click -10s, double-click to start, hold to rewind)"
        >
          ⏪
        </button>
        <button
          type="button"
          class="transport-btn is-play"
          classList={{ 'is-active': props.isPlaying() }}
          onClick={props.togglePlay}
          aria-label={props.isPlaying() ? 'Pause' : 'Play'}
        >
          {props.isPlaying() ? '❚❚' : '▶'}
        </button>
        <button
          type="button"
          class="transport-btn is-seek is-seek-fwd"
          onPointerDown={props.seekForward.onPointerDown}
          onPointerUp={props.seekForward.onPointerUp}
          onPointerCancel={props.seekForward.onPointerCancel}
          onPointerLeave={props.seekForward.onPointerLeave}
          aria-label="Seek forward (click +10s, hold to fast-forward)"
        >
          ⏩
        </button>
        <button
          type="button"
          class="transport-btn is-loop"
          classList={{ 'is-active': props.loopEnabled() }}
          onClick={props.toggleLoop}
          aria-label="Loop"
        >
          🔁
        </button>
        <span class="transport-time">{formatTime(props.playheadTime())}</span>
      </div>

      <div class="topbar-right">
        <div class="theme-pill">
          <span>Theme</span>
          <select
            value={props.appTheme()}
            onChange={(event) => props.setAppTheme(event.currentTarget.value)}
          >
            <option value="light">Light (Default)</option>
            <option value="dark">Dark Mode</option>
            <option value="spotify">Spotify Green</option>
            <option value="ableton">Ableton Grey</option>
            <option value="flstudio">FL Studio Orange</option>
          </select>
        </div>
        <Show when={props.loadStatusVisible()}>
          <span class="transport-status">{props.loadStatus()}</span>
        </Show>
        <div class="topbar-meta">
          <span>{props.activeVersion().title}</span>
          <strong>{props.activeVersion().label}</strong>
        </div>
      </div>
    </header>
  );
}
