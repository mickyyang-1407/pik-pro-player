import { Accessor, For, createSignal, onCleanup, onMount } from 'solid-js';
import { Speaker, speakers } from '../speakerConfig';

type SpeakerRoomProps = {
  speakerMode: Accessor<'solo' | 'mute'>;
  setSpeakerMode: (mode: 'solo' | 'mute') => void;
  soloGroups: Accessor<Set<Speaker['group']>>;
  activeSpeakers: Accessor<Set<string>>;
  toggleGroup: (groupId: Speaker['group'], shift: boolean) => void;
  toggleSpeaker: (label: string, shift: boolean) => void;
  selectionLabel: Accessor<string>;
  onClear: () => void;
};

export function SpeakerRoom(props: SpeakerRoomProps) {
  let roomPlaneEl: HTMLDivElement | undefined;
  const [gridScale, setGridScale] = createSignal(1);
  const BASE_ROOM_W = 420;

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
              classList={{ 'is-mode-active': props.speakerMode() === 'solo' }}
              onClick={() => props.setSpeakerMode('solo')}
            >Solo</button>
            <button
              type="button"
              classList={{ 'is-mode-mute': props.speakerMode() === 'mute' }}
              onClick={() => props.setSpeakerMode('mute')}
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
                  'is-solo': props.soloGroups().has(group.id) && props.speakerMode() === 'solo',
                  'is-mute': props.soloGroups().has(group.id) && props.speakerMode() === 'mute',
                }}
                onClick={(e) => props.toggleGroup(group.id, e.shiftKey)}
              >
                {group.label}
              </button>
            )}
          </For>
          <button type="button" class="clear-pill" onClick={() => props.onClear()}>
            Clear
          </button>
        </div>
      </div>
      <div class="speaker-view-title">
        <span>Speaker View</span>
        <strong classList={{ 'is-mute-label': (props.soloGroups().size > 0 || props.activeSpeakers().size > 0) && props.speakerMode() === 'mute' }}>{props.selectionLabel()}</strong>
      </div>
      <div class="room-plane" ref={roomPlaneEl}>
        <div class="screen-line">SCREEN</div>
        <div class="speaker-grid" style={{ transform: `scaleX(${gridScale()})`, 'transform-origin': 'center top' }}>
          <div class="listener-dot">
            <span />
          </div>
          <For each={speakers}>
            {(speaker) => {
              const isActive = () => props.activeSpeakers().has(speaker.label) || props.soloGroups().has(speaker.group);
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
                    'is-active': isActive() && props.speakerMode() === 'solo',
                    'is-muted': isActive() && props.speakerMode() === 'mute',
                  }}
                  style={{ 'grid-area': speaker.area }}
                  onClick={(e) => props.toggleSpeaker(speaker.label, e.shiftKey)}
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
  );
}
