export type Note = {
  id: number;
  rangeStart: number;
  rangeEnd: number;
  body: string;
  status: 'open' | 'checking' | 'done';
  kind: 'point' | 'range';
  severity: 'critical' | 'minor';
};

export type MixVersion = {
  id: 'a' | 'b';
  label: string;
  title: string;
  note: string;
  integratedLufs: number;
  truePeak: number;
  openIssues: number;
  updatedAt: string;
};

export type ReferenceTrack = {
  name: string;
  source: 'mock' | 'file';
  integratedLufs: number;
  truePeak: number;
};

export type SpectrumBand = {
  label: string;
  value: number;
};

export const mixVersions: MixVersion[] = [
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

export const defaultReferenceTrack: ReferenceTrack = {
  name: 'Reference Track',
  source: 'mock',
  integratedLufs: -15.8,
  truePeak: -1.4,
};

export const spectrumBands: SpectrumBand[] = [
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
