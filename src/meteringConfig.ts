export type TargetStatus = 'pass' | 'warn' | 'fail';

export const statusLabel: Record<TargetStatus, string> = { pass: 'Pass', warn: 'Warn', fail: 'Fail' };

export const loudnessTicks = ['-inf', '-54', '-45', '-36', '-16', '-9', '-6', '-3', '0'];
export const ppmTicks = ['-inf', '-54', '-45', '-36', '-27', '-24', '-18', '-9', '-6', '-1'];

// dB values behind ppmTicks; ticks render evenly spaced, so dB→% is piecewise-linear between them
export const ppmTickDb = [-60, -54, -45, -36, -27, -24, -18, -9, -6, -1];

export const ppmPercentFromDb = (db: number) => {
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

export const loudnessPosition = (value: number) => `${Math.max(0, Math.min(100, ((value + 60) / 60) * 100))}%`;

export type TargetPlatform = { id: string; label: string; target: number; truePeak: number; tolerance?: number; note?: string };

// Stereo/broadcast targets: widely published industry norms (Spotify/YouTube -14, Apple Sound Check -16,
// Amazon Music -14/-2dBTP, EBU R128 -23, ATSC A/85 -24).
// Atmos entries verified 2026-07-01 against official sources:
//   - Dolby Atmos Music (Apple Music / Amazon Music / Tidal): -18 LKFS, -1 dBTP
//     https://www.dolby.com/siteassets/dolby-creator-lab/dolby-atmos-music-accelerator/dolby-atmos-music-delivery-playbook-1.pdf
//   - Netflix Dolby Atmos Home Mix: -27 LKFS +/-2 LU dialogue-gated (ITU-R BS.1770-1), -2 dBFS true peak
//     https://partnerhelp.netflixstudios.com/hc/en-us/articles/115001539991-Netflix-Dolby-Atmos-Home-Mix-Deliverable-Requirements-v2-3
export const targetPlatforms: TargetPlatform[] = [
  { id: 'apple', label: 'Apple Music (-16)', target: -16, truePeak: -1 },
  { id: 'spotify', label: 'Spotify (-14)', target: -14, truePeak: -1 },
  { id: 'youtube', label: 'YouTube (-14)', target: -14, truePeak: -1 },
  { id: 'amazon', label: 'Amazon Music (-14)', target: -14, truePeak: -2 },
  { id: 'ebu', label: 'EBU R128 (-23)', target: -23, truePeak: -1 },
  { id: 'atsc', label: 'ATSC A/85 (-24)', target: -24, truePeak: -2 },
  { id: 'atmos-music', label: 'Atmos Music (-18)', target: -18, truePeak: -1, note: 'Apple / Amazon / Tidal' },
  { id: 'atmos-netflix', label: 'Netflix Atmos (-27)', target: -27, truePeak: -2, tolerance: 2, note: 'dialogue-gated ±2 LU, BS.1770-1' },
];
