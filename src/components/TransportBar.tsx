import { Accessor } from 'solid-js';
import { formatTime } from '../utils';

type TransportBarProps = {
  trackTitle: Accessor<string>;
  isPlaying: Accessor<boolean>;
  loopEnabled: Accessor<boolean>;
  playheadTime: Accessor<number>;
  loadStatus: Accessor<string>;
  appTheme: Accessor<string>;
  setAppTheme: (theme: string) => void;
  activeVersion: Accessor<{ title: string; label: string }>;
  onLoadAudioClick: () => void;
  onAudioFileChange: (event: Event) => void;
  stopPlayback: () => void;
  togglePlay: () => void;
  toggleLoop: () => void;
  resetWindowSize: () => void;
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
        </div>
      </div>

      <div class="transport-bar">
        <button type="button" class="transport-btn is-stop" onClick={props.stopPlayback} aria-label="Stop">■</button>
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
        <div class="zoom-control" style="flex-direction: row; align-items: center; gap: 8px;">
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
        <button type="button" class="ghost-btn" onClick={props.resetWindowSize} aria-label="Reset Window Size">
          Default Size
        </button>
        <span class="transport-status">{props.loadStatus()}</span>
        <div class="topbar-meta">
          <span>{props.activeVersion().title}</span>
          <strong>{props.activeVersion().label}</strong>
        </div>
      </div>
    </header>
  );
}
