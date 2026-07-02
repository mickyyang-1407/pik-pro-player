import { Accessor, For } from 'solid-js';
import {
  TargetPlatform,
  TargetStatus,
  loudnessPosition,
  loudnessTicks,
  ppmTicks,
  statusLabel,
  targetPlatforms,
} from '../meteringConfig';

type LoudnessPanelProps = {
  lufsEnabled: Accessor<boolean>;
  setLufsEnabled: (updater: (enabled: boolean) => boolean) => void;
  ppmEnabled: Accessor<boolean>;
  setPpmEnabled: (updater: (enabled: boolean) => boolean) => void;
  lufsStatus: Accessor<TargetStatus>;
  truePeakStatus: Accessor<TargetStatus>;
  selectedIntegratedLufs: Accessor<number>;
  selectedLoudnessRange: Accessor<number | null>;
  selectedShortTerm: Accessor<number | null>;
  selectedTruePeak: Accessor<number>;
  selectedShortTermMax: Accessor<number | null>;
  selectedMomentaryMax: Accessor<number | null>;
  targetPlatformId: Accessor<string>;
  setTargetPlatformId: (id: string) => void;
  targetPlatform: Accessor<TargetPlatform>;
  displayMeterRows: Accessor<{ label: string; value: number }[]>;
  onExportReport: () => void;
};

export function LoudnessPanel(props: LoudnessPanelProps) {
  return (
    <section class="analysis-panel" aria-label="Metering and loudness">
      <div class="analysis-heading">
        <div>
          <span>Metering</span>
          <strong>Loudness</strong>
        </div>
        <button
          type="button"
          classList={{ 'is-enabled': props.lufsEnabled() }}
          onClick={() => props.setLufsEnabled((enabled) => !enabled)}
        >
          LUFS
        </button>
      </div>
      <div class="loudness-readout" classList={{ 'is-disabled': !props.lufsEnabled() }}>
        <div class="loudness-readout-head">
          <span>Integrated</span>
          <span
            class="status-pill"
            classList={{ 'is-pass': props.lufsStatus() === 'pass', 'is-warn': props.lufsStatus() === 'warn', 'is-fail': props.lufsStatus() === 'fail' }}
          >
            {statusLabel[props.lufsStatus()]}
          </span>
        </div>
        <strong>{props.lufsEnabled() ? `${props.selectedIntegratedLufs()} LUFS` : '--'}</strong>
      </div>
      <div class="loudness-stats" classList={{ 'is-disabled': !props.lufsEnabled() }}>
        <div>
          <span>Range</span>
          <strong>{props.lufsEnabled() ? (props.selectedLoudnessRange() !== null ? `${props.selectedLoudnessRange()} LU` : '— LU') : '--'}</strong>
        </div>
        <div>
          <span>Short</span>
          <strong>{props.lufsEnabled() ? (props.selectedShortTerm() !== null ? `${props.selectedShortTerm()}` : '—') : '--'}</strong>
        </div>
        <div classList={{ 'is-warn': props.lufsEnabled() && props.truePeakStatus() === 'warn', 'is-fail': props.lufsEnabled() && props.truePeakStatus() === 'fail' }}>
          <span>True Peak</span>
          <strong>{props.lufsEnabled() ? `${props.selectedTruePeak()}` : '--'}</strong>
        </div>
      </div>
      <div class="loudness-bar-card" classList={{ 'is-disabled': !props.lufsEnabled() }}>
        <div class="loudness-bar-head">
          <span>LUFS Bar</span>
          <select
            class="target-select"
            value={props.targetPlatformId()}
            onChange={(event) => props.setTargetPlatformId(event.currentTarget.value)}
          >
            <For each={targetPlatforms}>{(platform) => <option value={platform.id}>{platform.label}</option>}</For>
          </select>
        </div>
        <div class="target-spec-row">
          <div class="target-spec-note">
            Max True Peak {props.targetPlatform().truePeak} dBTP{props.targetPlatform().note ? ` · ${props.targetPlatform().note}` : ''}
          </div>
          <button type="button" class="export-link" onClick={props.onExportReport}>Export Report</button>
        </div>
        <div class="loudness-scale">
          <div class="loudness-track" />
          <div
            class="loudness-current"
            classList={{ 'is-warn': props.lufsStatus() === 'warn', 'is-fail': props.lufsStatus() === 'fail' }}
            style={{ left: props.lufsEnabled() ? loudnessPosition(props.selectedIntegratedLufs()) : '0%' }}
          />
          <div class="loudness-target" style={{ left: loudnessPosition(props.targetPlatform().target) }} />
          <For each={loudnessTicks}>
            {(tick) => (
              <span class="loudness-tick" classList={{ 'is-target': tick !== '-inf' && Number(tick) === props.targetPlatform().target }} style={{ left: tick === '-inf' ? '0%' : loudnessPosition(Number(tick)) }}>
                {tick}
              </span>
            )}
          </For>
        </div>
        <div class="loudness-max-stats">
          <div>
            <span>Short Term Max</span>
            <strong>{props.lufsEnabled() ? (props.selectedShortTermMax() !== null ? `${props.selectedShortTermMax()}` : '—') : '--'}</strong>
          </div>
          <div>
            <span>Momentary Max</span>
            <strong>{props.lufsEnabled() ? (props.selectedMomentaryMax() !== null ? `${props.selectedMomentaryMax()}` : '—') : '--'}</strong>
          </div>
        </div>
      </div>
      <div class="meter-list" classList={{ 'is-disabled': !props.ppmEnabled() }}>
        <div class="meter-head">
          <div>
            <span>PPM</span>
            <strong>dB Scale</strong>
          </div>
          <button
            type="button"
            classList={{ 'is-enabled': props.ppmEnabled() }}
            onClick={() => props.setPpmEnabled((enabled) => !enabled)}
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
            <For each={props.displayMeterRows()}>
              {(meter) => (
                <div class="ppm-channel">
                  <span>{meter.label}</span>
                  <div class="ppm-slot">
                    <i style={{ transform: `scaleX(${props.ppmEnabled() ? meter.value / 100 : 0})` }} />
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </section>
  );
}
